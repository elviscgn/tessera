/* tslint:disable */
/* eslint-disable */

/**
 * One authoritative simulation instance owned by a dedicated Worker.
 */
export class TesseraWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Acknowledges the highest contiguous event sequence consumed by the host.
     */
    ack_events(highest_contiguous: bigint): void;
    /**
     * Returns the adapter contract version used by the Worker readiness message.
     */
    adapter_version(): number;
    /**
     * Marks the instance closed. Disposal is idempotent.
     */
    dispose(): void;
    /**
     * Returns ordered event records after the requested sequence.
     */
    event_batch(after_sequence: bigint, max_events: number): Uint8Array;
    /**
     * Returns the highest event sequence currently retained by the simulation.
     */
    latest_event_sequence(): bigint;
    /**
     * Initializes one simulation from an exactly 32-byte seed.
     */
    constructor(seed: Uint8Array);
    /**
     * Registers one declarative object type before the first command is run.
     */
    register_object_type(id: string, footprint_offsets: Int32Array): number;
    /**
     * Builds the latest packed snapshot and returns a descriptor into Wasm memory.
     */
    render_snapshot_descriptor(): Uint8Array;
    /**
     * Decodes one binary command batch, schedules it, advances bounded exact ticks, and
     * returns a fixed-size binary response containing the canonical state hash.
     */
    run_command_batch(command_batch: Uint8Array, exact_ticks: number): Uint8Array;
    /**
     * Returns the current authoritative tick.
     */
    tick(): bigint;
    /**
     * Queries authoritative occupancy for a prospective placement without mutation.
     */
    validate_placement(object_type: number, x: number, z: number, elevation_mm: number, rotation: number): Uint8Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_tesserawasm_free: (a: number, b: number) => void;
    readonly tesserawasm_ack_events: (a: number, b: bigint) => [number, number];
    readonly tesserawasm_adapter_version: (a: number) => number;
    readonly tesserawasm_dispose: (a: number) => void;
    readonly tesserawasm_event_batch: (a: number, b: bigint, c: number) => [number, number, number, number];
    readonly tesserawasm_latest_event_sequence: (a: number) => bigint;
    readonly tesserawasm_new: (a: number, b: number) => [number, number, number];
    readonly tesserawasm_register_object_type: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly tesserawasm_render_snapshot_descriptor: (a: number) => [number, number, number, number];
    readonly tesserawasm_run_command_batch: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly tesserawasm_tick: (a: number) => bigint;
    readonly tesserawasm_validate_placement: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
export function init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
