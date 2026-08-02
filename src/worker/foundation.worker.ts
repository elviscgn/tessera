import init, { TesseraWasm } from './wasm/tessera_wasm.js';
import {
  bytesToHex,
  decodeCommandResponse,
  MAX_EXACT_TICKS_PER_CALL,
  parseWasmError,
  PROTOCOL_VERSION,
  type CommandRequest,
  type InitializeRequest,
  type WorkerRequest,
  type WorkerResponse,
} from './bridge-protocol';

/**
 * The dedicated simulation Worker owns the Wasm instance and the control-plane
 * protocol. The web-target wasm-bindgen module is initialized explicitly here;
 * no bundler-target auto-initialization is relied upon.
 */

const workerScope = self as DedicatedWorkerGlobalScope;
let simulation: TesseraWasm | undefined;
let startupInProgress = false;
let fatal = false;

const post = (message: WorkerResponse, transfer: Transferable[] = []): void => {
  workerScope.postMessage(message, transfer);
};

const handleInitialize = async (request: InitializeRequest): Promise<void> => {
  if (simulation || startupInProgress || fatal) {
    post({
      type: 'fatal-error',
      phase: 'startup',
      code: fatal ? 'worker_fatal' : 'already_initialized',
      message: fatal
        ? 'the Worker is in a fatal state and requires restart'
        : 'the Worker has already been initialized',
    });
    return;
  }
  startupInProgress = true;
  try {
    if (request.seed.byteLength !== 32) {
      throw new Error('tessera:startup:invalid_seed:seed must be 32 bytes');
    }
    await init();
    simulation = new TesseraWasm(new Uint8Array(request.seed));
    post({
      type: 'startup-ready',
      protocolVersion: PROTOCOL_VERSION,
      adapterVersion: simulation.adapter_version(),
      tick: toSafeNumber(simulation.tick(), 'startup tick'),
    });
  } catch (error: unknown) {
    fatal = true;
    const failure = parseWasmError(error);
    post({
      type: 'fatal-error',
      phase: 'startup',
      code: failure.code,
      message: failure.message,
    });
  } finally {
    startupInProgress = false;
  }
};

const handleCommand = (request: CommandRequest): void => {
  if (!simulation || fatal) {
    post({
      type: 'command-error',
      phase: 'command',
      code: fatal ? 'worker_fatal' : 'not_ready',
      message: fatal
        ? 'the Worker is in a fatal state and requires restart'
        : 'the Worker has not completed startup',
      requestId: request.requestId,
    });
    return;
  }
  if (
    !Number.isInteger(request.exactTicks) ||
    request.exactTicks < 0 ||
    request.exactTicks > MAX_EXACT_TICKS_PER_CALL
  ) {
    post({
      type: 'command-error',
      phase: 'command',
      code: 'tick_bound_exceeded',
      message: 'exact tick count must be an integer between 0 and 5',
      requestId: request.requestId,
    });
    return;
  }
  try {
    const responseBytes = simulation.run_command_batch(
      new Uint8Array(request.bytes),
      request.exactTicks,
    );
    const response = decodeCommandResponse(responseBytes);
    const responseBuffer = responseBytes.slice().buffer;
    post(
      {
        type: 'command-result',
        requestId: request.requestId,
        batchSequence: toSafeNumber(response.batchSequence, 'batch sequence'),
        tick: toSafeNumber(response.tick, 'tick'),
        stateHashHex: bytesToHex(response.stateHash),
        response: responseBuffer,
      },
      [responseBuffer],
    );
  } catch (error: unknown) {
    const failure = parseWasmError(error);
    if (failure.type === 'fatal-error') {
      fatal = true;
      simulation.free();
      simulation = undefined;
    }
    post({
      type: failure.type,
      phase: failure.type === 'fatal-error' ? 'fatal' : 'command',
      code: failure.code,
      message: failure.message,
      requestId: request.requestId,
    });
  }
};

const handleDispose = (): void => {
  if (simulation) {
    simulation.dispose();
    simulation.free();
    simulation = undefined;
  }
  fatal = true;
  workerScope.close();
};

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'initialize') {
    void handleInitialize(request);
  } else if (request.type === 'command') {
    handleCommand(request);
  } else if (request.type === 'dispose') {
    handleDispose();
  } else {
    post({
      type: 'fatal-error',
      phase: 'fatal',
      code: 'unknown_request',
      message: 'the Worker received an unknown request',
    });
  }
});

const toSafeNumber = (value: bigint, label: string): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds JavaScript safe integer range`);
  }
  return Number(value);
};
