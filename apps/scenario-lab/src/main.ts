import { encodeSpawnCommandBatch, type WorkerResponse } from '../../../src/worker/bridge-protocol';

const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('The Scenario Lab foundation mount is missing.');
}

const foundationWorker = new Worker(
  new URL('../../../src/worker/foundation.worker.ts', import.meta.url),
  { name: 'tessera-foundation', type: 'module' },
);

const setStatus = (status: string, details: Record<string, string> = {}): void => {
  app.dataset.tesseraStatus = status;
  for (const [key, value] of Object.entries(details)) {
    app.dataset[`tessera${key[0]?.toUpperCase() ?? ''}${key.slice(1)}`] = value;
  }
  app.textContent = `Tessera ${status}${details.tick ? ` (tick ${details.tick})` : ''}`;
};

foundationWorker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
  const response = event.data;
  if (response.type === 'startup-ready') {
    setStatus('ready', { tick: String(response.tick) });
    const command = encodeSpawnCommandBatch({
      batchSequence: 1n,
      clientSequence: 1n,
      objectType: 1,
      x: 0,
      z: 0,
      elevationMm: 0,
      rotation: 0,
    });
    foundationWorker.postMessage({ type: 'command', requestId: 1, bytes: command, exactTicks: 1 }, [
      command,
    ]);
  } else if (response.type === 'command-result') {
    setStatus('probe-passed', {
      tick: String(response.tick),
      stateHash: response.stateHashHex,
    });
  } else {
    setStatus(response.type === 'fatal-error' ? 'fatal' : 'command-error', {
      errorCode: response.code,
    });
  }
});

foundationWorker.addEventListener('error', () => {
  setStatus('fatal', { errorCode: 'worker_error' });
});

setStatus('starting');
foundationWorker.postMessage({ type: 'initialize', seed: new Uint8Array(32).fill(7) });

const dispose = (): void => {
  foundationWorker.postMessage({ type: 'dispose' });
  foundationWorker.terminate();
};

window.addEventListener('pagehide', dispose, { once: true });
