/* tslint:disable */
/* eslint-disable */

/**
 * One authoritative simulation instance owned by a dedicated Worker.
 */
export class TesseraWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Returns the adapter contract version used by the Worker readiness message.
     */
    adapter_version(): number;
    /**
     * Marks the instance closed. Disposal is idempotent.
     */
    dispose(): void;
    /**
     * Initializes one simulation from an exactly 32-byte seed.
     */
    constructor(seed: Uint8Array);
    /**
     * Decodes one binary command batch, schedules it, advances bounded exact ticks, and
     * returns a fixed-size binary response containing the canonical state hash.
     */
    run_command_batch(command_batch: Uint8Array, exact_ticks: number): Uint8Array;
    /**
     * Returns the current authoritative tick.
     */
    tick(): bigint;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_tesserawasm_free: (a: number, b: number) => void;
    readonly tesserawasm_adapter_version: (a: number) => number;
    readonly tesserawasm_dispose: (a: number) => void;
    readonly tesserawasm_new: (a: number, b: number) => [number, number, number];
    readonly tesserawasm_run_command_batch: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly tesserawasm_tick: (a: number) => bigint;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
