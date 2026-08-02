import { createFoundationRuntime, type FoundationDiagnostics } from '../../../src/public/index';
import { encodeSpawnCommandBatch } from '../../../src/worker/bridge-protocol';

const canvas = document.querySelector<HTMLCanvasElement>('#renderCanvas');
const status = document.querySelector<HTMLOutputElement>('#status');
const telemetry = document.querySelector<HTMLElement>('#app');

if (!canvas || !status || !telemetry) {
  throw new Error('The Scenario Lab foundation mount is missing.');
}

const setStatus = (value: string, details: Record<string, string> = {}): void => {
  status.dataset.tesseraStatus = value;
  telemetry.dataset.tesseraStatus = value;
  for (const [key, detail] of Object.entries(details)) {
    status.dataset[`tessera${key[0]?.toUpperCase() ?? ''}${key.slice(1)}`] = detail;
    telemetry.dataset[`tessera${key[0]?.toUpperCase() ?? ''}${key.slice(1)}`] = detail;
  }
  status.textContent = `Tessera ${value}${details.tick ? ` (tick ${details.tick})` : ''}`;
};

const setDiagnostics = (diagnostics: FoundationDiagnostics): void => {
  for (const [key, value] of Object.entries(diagnostics.metrics ?? {})) {
    telemetry.dataset[`tesseraMetric${key[0]?.toUpperCase() ?? ''}${key.slice(1)}`] = String(value);
  }
  telemetry.dataset.tesseraEventSequence = String(
    diagnostics.eventStream.highestContiguousSequence,
  );
  telemetry.dataset.tesseraEventDesynced = String(diagnostics.eventStream.desynced);
  telemetry.dataset.tesseraSnapshotGeneration = String(diagnostics.lastSnapshotGeneration);
  telemetry.dataset.tesseraRenderTick = String(diagnostics.lastRenderTick);
  telemetry.dataset.tesseraRenderEntityCount = String(diagnostics.lastEntityCount);
  telemetry.dataset.tesseraRenderFrames = String(diagnostics.renderer.renderFrames);
  telemetry.dataset.tesseraRendererSnapshots = String(diagnostics.renderer.receivedSnapshots);
  if (diagnostics.lastStateHashHex !== undefined) {
    telemetry.dataset.tesseraStateHash = diagnostics.lastStateHashHex;
  }
  if (diagnostics.lastError !== undefined) {
    telemetry.dataset.tesseraErrorCode = diagnostics.lastError.code;
  }
};

let runtime: ReturnType<typeof createFoundationRuntime>;
try {
  runtime = createFoundationRuntime({ canvas });
  const unsubscribe = runtime.subscribeDiagnostics((diagnostics) => {
    setDiagnostics(diagnostics);
    if (diagnostics.state === 'fatal') {
      setStatus('fatal', { errorCode: diagnostics.lastError?.code ?? 'runtime_fatal' });
    }
  });

  void runtime.ready
    .then(async (ready) => {
      setStatus('ready', { tick: String(ready.tick) });
      const command = encodeSpawnCommandBatch({
        batchSequence: 1n,
        clientSequence: 1n,
        objectType: 1,
        x: 0,
        z: 0,
        elevationMm: 0,
        rotation: 0,
      });
      const response = await runtime.submitCommand(command, 1);
      setStatus('probe-passed', {
        tick: String(response.tick),
        stateHash: response.stateHashHex,
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('fatal', { errorCode: 'runtime_startup', errorMessage: message });
    });

  const dispose = (): void => {
    unsubscribe();
    runtime.dispose();
  };
  window.addEventListener('pagehide', dispose, { once: true });
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  setStatus('fatal', { errorCode: 'renderer_startup', errorMessage: message });
}
