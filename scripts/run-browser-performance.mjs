import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { PERFORMANCE_SCHEMA_VERSION, summarizeSamples, writeJson } from './performance-report.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = resolve(repositoryRoot, 'artifacts/performance/browser.json');
const defaultWorkload = {
  entities: 100,
  ticks: 100,
  samples: 5,
  warmup: 1,
  resetCycles: 5,
};

const optionValue = (argumentsList, name, fallback) => {
  const index = argumentsList.indexOf(name);
  return index < 0 ? fallback : argumentsList[index + 1];
};

const positiveOption = (argumentsList, name, fallback) => {
  const value = Number(optionValue(argumentsList, name, fallback));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(name + ' must be a positive integer');
  }
  return value;
};

const parseOptions = () => {
  const argumentsList = process.argv.slice(2);
  if (argumentsList[0] === '--') {
    argumentsList.shift();
  }
  const output = resolve(repositoryRoot, optionValue(argumentsList, '--output', defaultOutput));
  return {
    output,
    entities: positiveOption(argumentsList, '--entities', defaultWorkload.entities),
    ticks: positiveOption(argumentsList, '--ticks', defaultWorkload.ticks),
    samples: positiveOption(argumentsList, '--samples', defaultWorkload.samples),
    warmup: Number(optionValue(argumentsList, '--warmup', defaultWorkload.warmup)),
    resetCycles: positiveOption(argumentsList, '--reset-cycles', defaultWorkload.resetCycles),
    port: positiveOption(argumentsList, '--port', 5175),
  };
};

const serverResponds = async (url) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};

const waitForServer = async (server, url) => {
  let output = '';
  server.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  server.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error('Vite exited before becoming ready: ' + output);
    }
    if (await serverResponds(url)) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error('Vite did not become ready: ' + output);
};

const startServer = async (port) => {
  const server = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['dev', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: repositoryRoot,
      env: { ...process.env, DO_NOT_TRACK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    await waitForServer(server, 'http://127.0.0.1:' + port);
    return server;
  } catch (error) {
    server.kill('SIGTERM');
    throw error;
  }
};

const stopServer = async (server) => {
  if (server.exitCode !== null) {
    return;
  }
  server.kill('SIGTERM');
  await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      server.kill('SIGKILL');
      resolvePromise();
    }, 2_000);
    server.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
};

const readEnvironment = async (page) =>
  page.evaluate(() => {
    const readWebgl = () => {
      const canvas = globalThis.document.querySelector('#renderCanvas');
      if (canvas === null) {
        return { webglVersion: 'unavailable', webglRenderer: 'unavailable' };
      }
      const gl = canvas.getContext('webgl2');
      if (gl === null) {
        return { webglVersion: 'unavailable', webglRenderer: 'unavailable' };
      }
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const webglRenderer =
        debugInfo === null ? 'unavailable' : gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      return {
        webglVersion: gl.getParameter(gl.VERSION),
        webglRenderer,
      };
    };
    const usedJsHeapSize =
      'memory' in globalThis.performance
        ? (globalThis.performance.memory?.usedJSHeapSize ?? null)
        : null;
    return {
      userAgent: globalThis.navigator.userAgent,
      viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
      devicePixelRatio: globalThis.devicePixelRatio,
      ...readWebgl(),
      usedJsHeapSize,
    };
  });

const runWorkload = async (page, workload) =>
  page.evaluate(async (configuration) => {
    const bridge = globalThis.tesseraTest;
    if (bridge === undefined) {
      throw new Error('window.tesseraTest is unavailable in the development performance run');
    }
    let memoryBufferHighWater = 0;
    const numberOrZero = (value) => (typeof value === 'number' ? value : 0);
    const rendererFor = (renderer) => ({
      visibleEntityCount: numberOrZero(renderer.visibleEntityCount),
      staleMappingCount: numberOrZero(renderer.staleMappingCount),
      staleSnapshotCount: numberOrZero(renderer.staleSnapshotCount),
      resetCount: numberOrZero(renderer.resetCount),
      disposed: renderer.disposed,
    });
    const snapshot = async () => {
      const metrics = await bridge.requestMetrics();
      memoryBufferHighWater = Math.max(memoryBufferHighWater, metrics.memoryBufferBytes);
      const diagnostics = bridge.diagnostics();
      return {
        state: diagnostics.state,
        simulationTick: diagnostics.simulationTick.toString(),
        renderTick: diagnostics.lastRenderTick.toString(),
        snapshotGeneration: diagnostics.lastSnapshotGeneration.toString(),
        stateHashHex: diagnostics.lastStateHashHex,
        eventDesynced: diagnostics.eventStream.desynced,
        renderer: rendererFor(diagnostics.renderer),
        metrics,
      };
    };
    const waitForBuffers = async () => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const metrics = await bridge.requestMetrics();
        if (metrics.inFlightRenderBuffers === 0) {
          return metrics;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      }
      throw new Error('render buffers did not return to the pool');
    };
    const populate = async () => {
      for (let index = 0; index < configuration.entities; index += 1) {
        await bridge.placeObject({
          objectType: 'foundation',
          x: index * 2,
          z: 0,
          elevationMm: 0,
          rotation: index % 4,
        });
      }
    };
    const advance = async () => {
      let remaining = configuration.ticks;
      while (remaining > 0) {
        const batch = Math.min(5, remaining);
        await bridge.step(batch);
        remaining -= batch;
      }
    };
    const resetCycles = async () => {
      for (let index = 0; index < configuration.resetCycles; index += 1) {
        await bridge.reset();
      }
    };

    bridge.pause();
    const totalStart = performance.now();
    await bridge.reset();
    const populateStart = performance.now();
    await populate();
    const populateMs = performance.now() - populateStart;
    const population = await snapshot();

    const tickStart = performance.now();
    await advance();
    const tickMs = performance.now() - tickStart;
    const tickState = await snapshot();

    const saveStart = performance.now();
    const bytes = await bridge.save();
    const saveMs = performance.now() - saveStart;
    const loadStart = performance.now();
    await bridge.load(bytes);
    const loadMs = performance.now() - loadStart;

    const cleanupStart = performance.now();
    await resetCycles();
    const cleanupMs = performance.now() - cleanupStart;
    const cleanupMetrics = await waitForBuffers();
    memoryBufferHighWater = Math.max(memoryBufferHighWater, cleanupMetrics.memoryBufferBytes);
    const cleanupState = await snapshot();

    return {
      populateMs,
      tickMs,
      saveMs,
      loadMs,
      cleanupMs,
      totalMs: performance.now() - totalStart,
      ticksPerSecond: configuration.ticks / Math.max(tickMs / 1_000, Number.EPSILON),
      saveBytes: bytes.byteLength,
      memoryBufferHighWater,
      population,
      tickState,
      cleanup: cleanupState,
      cleanupMetrics,
    };
  }, workload);

const structuralGates = (samples) => {
  const checks = samples.map((sample) => ({
    noStaleMappings:
      sample.cleanup.renderer.staleMappingCount === 0 &&
      sample.cleanup.renderer.staleSnapshotCount === 0,
    noEventDesync: sample.cleanup.eventDesynced === false,
    buffersReturned: sample.cleanupMetrics.inFlightRenderBuffers === 0,
    resetClearsEntities: sample.cleanup.renderer.visibleEntityCount === 0,
    metricsRecorded: sample.population.metrics.renderSnapshots > 0,
  }));
  return {
    checks,
    passed: checks.every((check) => Object.values(check).every(Boolean)),
  };
};

const performanceFields = [
  'populateMs',
  'tickMs',
  'saveMs',
  'loadMs',
  'cleanupMs',
  'totalMs',
  'ticksPerSecond',
];

const collectSamples = async (page, options) => {
  const samples = [];
  const iterations = options.warmup + options.samples;
  for (let index = 0; index < iterations; index += 1) {
    const sample = await runWorkload(page, options);
    if (index >= options.warmup) {
      samples.push(sample);
    }
  }
  return samples;
};

const buildReport = (browser, environment, options, samples) => {
  const gates = structuralGates(samples);
  return {
    schema: 'tessera.performance.browser',
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    runner: {
      browser: 'chromium',
      browserVersion: browser.version(),
      graphics: environment.webglRenderer,
    },
    environment,
    workload: {
      entities: options.entities,
      ticks: options.ticks,
      samples: options.samples,
      warmup: options.warmup,
      resetCycles: options.resetCycles,
      viewport: { width: 1280, height: 720 },
      devicePixelRatio: 1,
      camera: 'default scenario camera',
      seed: '07'.repeat(32),
    },
    samples,
    summary: summarizeSamples(samples, performanceFields),
    gates,
    notes: [
      'Timings are observations for trend comparison, not release budgets.',
      'Chromium runs use a fixed viewport, DPR, locale, timezone, and launch flags.',
      'Cleanup gates cover stale mappings, event synchronisation, transferable ownership, and reset clearing.',
    ],
  };
};

const run = async () => {
  const options = parseOptions();
  if (!Number.isSafeInteger(options.warmup) || options.warmup < 0) {
    throw new Error('--warmup must be a non-negative integer');
  }
  const server = await startServer(options.port);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--force-device-scale-factor=1'],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:' + options.port, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#status[data-tessera-status="probe-passed"]', {
      timeout: 45_000,
    });
    const environment = await readEnvironment(page);
    const samples = await collectSamples(page, options);
    const report = buildReport(browser, environment, options, samples);
    await writeJson(options.output, report);
    if (!report.gates.passed) {
      throw new Error('browser performance cleanup gates failed');
    }
    console.log('wrote browser performance report to ' + options.output);
  } finally {
    await browser?.close();
    await stopServer(server);
  }
};

run().catch((error) => {
  console.error('tessera browser performance: ' + (error?.message ?? error));
  process.exitCode = 1;
});
