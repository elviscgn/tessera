import {
  encodeSpawnCommandBatch,
  type BoundaryMetrics,
  type WorkerResponse,
} from '../../../src/worker/bridge-protocol';
import { decodeEventBatch, decodeRenderSnapshot } from '../../../src/worker/data-protocol';
import { ReliableEventReceiver } from '../../../src/worker/reliable-events';

const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('The Scenario Lab foundation mount is missing.');
}

const foundationWorker = new Worker(
  new URL('../../../src/worker/foundation.worker.ts', import.meta.url),
  { name: 'tessera-foundation', type: 'module' },
);
const eventReceiver = new ReliableEventReceiver();

const setMetrics = (metrics: BoundaryMetrics): void => {
  for (const [key, value] of Object.entries(metrics)) {
    app.dataset[`tesseraMetric${key[0]?.toUpperCase() ?? ''}${key.slice(1)}`] = String(value);
  }
};

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
    setMetrics(response.metrics);
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
    setMetrics(response.metrics);
    setStatus('probe-passed', {
      tick: String(response.tick),
      stateHash: response.stateHashHex,
    });
  } else if (response.type === 'event-batch') {
    setMetrics(response.metrics);
    const metadata = decodeEventBatch(response.bytes);
    const result = eventReceiver.accept(metadata);
    if (result.type === 'gap') {
      const afterSequence = eventReceiver.requestResync();
      foundationWorker.postMessage({
        type: 'request-events',
        afterSequence,
        resync: true,
      });
    } else if (result.type === 'accepted') {
      foundationWorker.postMessage({
        type: 'ack-events',
        highestContiguousSequence: result.highestContiguousSequence,
      });
    }
    const streamMetrics = eventReceiver.metrics();
    app.dataset.tesseraEventSequence = String(streamMetrics.highestContiguousSequence);
    app.dataset.tesseraEventDesynced = String(streamMetrics.desynced);
  } else if (response.type === 'render-snapshot') {
    setMetrics(response.metrics);
    const snapshot = decodeRenderSnapshot(new Uint8Array(response.buffer, 0, response.byteLength));
    app.dataset.tesseraSnapshotGeneration = String(snapshot.snapshotGeneration);
    app.dataset.tesseraRenderTick = String(snapshot.simulationTick);
    app.dataset.tesseraRenderRegions = String(snapshot.regions.length);
    foundationWorker.postMessage(
      { type: 'return-render-buffer', bufferId: response.bufferId, buffer: response.buffer },
      [response.buffer],
    );
  } else if (response.type === 'metrics') {
    setMetrics(response.metrics);
  } else {
    if (response.metrics) {
      setMetrics(response.metrics);
    }
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
