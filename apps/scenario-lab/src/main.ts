const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('The Scenario Lab foundation mount is missing.');
}

const foundationWorker = new Worker(
  new URL('../../../src/worker/foundation.worker.ts', import.meta.url),
  { name: 'tessera-foundation', type: 'module' },
);

const dispose = (): void => {
  foundationWorker.terminate();
};

window.addEventListener('pagehide', dispose, { once: true });
app.textContent = 'Tessera foundation';
