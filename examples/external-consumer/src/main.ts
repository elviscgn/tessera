import {
  createTesseraRuntime,
  type AssetManifest,
  type EntityId,
  type FoundationRuntime,
  type ObjectTypeDefinition,
  type PlacementTarget,
  type ScenarioDefinition,
} from '@tessera/runtime';
import { registerTesseraTestBridge } from '@tessera/runtime/testkit';

const canvas = document.querySelector<HTMLCanvasElement>('#renderCanvas');
const status = document.querySelector<HTMLOutputElement>('#status');
const saveBytes = document.querySelector<HTMLElement>('#saveBytes');
const restoredHash = document.querySelector<HTMLElement>('#restoredHash');
const replayCommands = document.querySelector<HTMLElement>('#replayCommands');
const testBridge = document.querySelector<HTMLElement>('#testBridge');

if (!canvas || !status || !saveBytes || !restoredHash || !replayCommands || !testBridge) {
  throw new Error('external consumer fixture markup is incomplete');
}

const scenario: ScenarioDefinition = { id: 'external-consumer' };
const objectTypes: readonly ObjectTypeDefinition[] = [
  {
    id: 'warehouse',
    footprint: [
      { dx: 0, dz: 0 },
      { dx: 1, dz: 0 },
    ],
  },
];
const assets: AssetManifest = {
  assets: [{ id: 'warehouse-placeholder', url: 'asset://warehouse-placeholder' }],
};

const seed = new Uint8Array(32).fill(0x2a);
const runtime: FoundationRuntime = createTesseraRuntime({
  canvas,
  seed,
  scenario,
  objectTypes,
  assetManifest: assets,
});
const unregisterTestBridge = registerTesseraTestBridge(runtime, {
  canvas,
  scenario,
  scenarios: [scenario],
  seedHex: '2a'.repeat(32),
  frameworkVersion: '0.0.0',
  gameId: 'external-consumer',
});

const setStatus = (value: string, state: string): void => {
  status.dataset.tesseraStatus = state;
  status.textContent = value;
};

const entityIdFrom = (slot: number, generation: number): EntityId => `${slot}:${generation}`;

const submitPlacement = async (
  bridge: typeof window.tesseraTest,
  target: PlacementTarget,
): Promise<void> => {
  if (bridge === undefined) {
    await runtime.placeObject(target, 1);
    return;
  }
  await bridge.placeObject(target, 1);
};

const runConsumerFlow = async (): Promise<void> => {
  await runtime.ready;
  setStatus('ready', 'ready');

  const target: PlacementTarget = {
    objectType: 'warehouse',
    x: 0,
    z: 0,
    elevationMm: 0,
    rotation: 0,
  };
  const bridge = window.tesseraTest;
  await submitPlacement(bridge, target);
  await runtime.waitForRenderedTick(1);

  const entity = runtime.renderInspection().entities[0];
  if (!entity) {
    throw new Error('external consumer did not receive a rendered entity');
  }

  const saved = await runtime.save();
  saveBytes.textContent = String(saved.byteLength);

  const manifest = bridge?.captureReproductionBundle();
  replayCommands.textContent = String(manifest?.commands.length ?? 0);
  testBridge.textContent = window.tesseraTest === undefined ? 'absent' : 'available';

  await runtime.removeEntity(entityIdFrom(entity.slot, entity.generation), 1);
  await runtime.waitForRenderedTick(2);
  const restored = await runtime.load(saved);
  restoredHash.textContent = restored.stateHashHex;
  setStatus('ready · saved, removed, restored', 'ready');
};

void runConsumerFlow().catch((error: unknown) => {
  setStatus(error instanceof Error ? error.message : String(error), 'fatal');
});

window.addEventListener('pagehide', () => {
  unregisterTestBridge();
  runtime.dispose();
});
