/* tslint:disable */
/* eslint-disable */

/**
 * One authoritative arena simulation instance owned by a dedicated Worker.
 */
export class ArenaWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Advances exactly one tick.
     */
    advance_one_tick(): void;
    /**
     * Advances up to `MAX_ARENA_TICKS_PER_CALL` ticks.
     */
    advance_ticks(count: bigint): void;
    /**
     * Marks the instance closed. Disposal is idempotent.
     */
    dispose(): void;
    /**
     * Serializes and clears the event log.
     */
    drain_events(): string;
    /**
     * Whether the match is over.
     */
    is_complete(): boolean;
    /**
     * Creates an arena with the standard layout and a win target.
     */
    constructor(win_goals: number);
    /**
     * Creates an arena from explicit layout dimensions (millimetres).
     */
    static new_with_layout(width_mm: number, depth_mm: number, wall_mm: number, pocket_radius_mm: number, win_goals: number): ArenaWasm;
    /**
     * The current phase discriminant (0..3).
     */
    phase(): number;
    /**
     * The side in possession.
     */
    possession(): number;
    /**
     * The score as `[side0, side1]`.
     */
    score(): Uint32Array;
    /**
     * The canonical 64-character state hash.
     */
    state_hash_hex(): string;
    /**
     * Serializes the live bodies and match status as JSON.
     */
    state_snapshot(): string;
    /**
     * Submits a batch of encoded arena commands for the next tick.
     */
    submit_command_batch(bytes: Uint8Array): Uint8Array;
    /**
     * Submits a JSON array of semantic arena commands for the next tick.
     */
    submit_commands_json(json: string): Uint8Array;
    /**
     * The current tick.
     */
    tick(): bigint;
    /**
     * Checks a prospective placement without mutating state.
     */
    validate_placement(radius_micros: bigint, x_micros: bigint, z_micros: bigint): boolean;
}

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
     * Validates a save into temporary state and swaps it atomically on success.
     */
    load_state(bytes: Uint8Array, game_id: string, scenario_id: string, framework_version: string, protocol_version: number): void;
    /**
     * Initializes one simulation from an exactly 32-byte seed.
     */
    constructor(seed: Uint8Array);
    /**
     * Returns the next client sequence that will not be rejected as stale.
     */
    next_client_sequence(): bigint;
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
     * Serializes the current authoritative state without mutating it.
     */
    save_state(game_id: string, scenario_id: string, framework_version: string, protocol_version: number): Uint8Array;
    /**
     * Returns the current canonical state hash for a load response.
     */
    state_hash(): Uint8Array;
    /**
     * Returns the current authoritative tick.
     */
    tick(): bigint;
    /**
     * Queries authoritative occupancy for a prospective placement without mutation.
     */
    validate_placement(object_type: number, x: number, z: number, elevation_mm: number, rotation: number): Uint8Array;
    /**
     * Returns the current reset/world generation.
     */
    world_generation(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_arenawasm_free: (a: number, b: number) => void;
    readonly arenawasm_advance_one_tick: (a: number) => [number, number];
    readonly arenawasm_advance_ticks: (a: number, b: bigint) => [number, number];
    readonly arenawasm_dispose: (a: number) => void;
    readonly arenawasm_drain_events: (a: number) => [number, number];
    readonly arenawasm_is_complete: (a: number) => number;
    readonly arenawasm_new: (a: number) => [number, number, number];
    readonly arenawasm_new_with_layout: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly arenawasm_phase: (a: number) => number;
    readonly arenawasm_possession: (a: number) => number;
    readonly arenawasm_score: (a: number) => [number, number];
    readonly arenawasm_state_hash_hex: (a: number) => [number, number];
    readonly arenawasm_state_snapshot: (a: number) => [number, number];
    readonly arenawasm_submit_command_batch: (a: number, b: number, c: number) => [number, number, number, number];
    readonly arenawasm_submit_commands_json: (a: number, b: number, c: number) => [number, number, number, number];
    readonly arenawasm_tick: (a: number) => bigint;
    readonly arenawasm_validate_placement: (a: number, b: bigint, c: bigint, d: bigint) => number;
    readonly __wbg_tesserawasm_free: (a: number, b: number) => void;
    readonly tesserawasm_ack_events: (a: number, b: bigint) => [number, number];
    readonly tesserawasm_adapter_version: (a: number) => number;
    readonly tesserawasm_dispose: (a: number) => void;
    readonly tesserawasm_event_batch: (a: number, b: bigint, c: number) => [number, number, number, number];
    readonly tesserawasm_latest_event_sequence: (a: number) => bigint;
    readonly tesserawasm_load_state: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly tesserawasm_new: (a: number, b: number) => [number, number, number];
    readonly tesserawasm_next_client_sequence: (a: number) => bigint;
    readonly tesserawasm_register_object_type: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly tesserawasm_render_snapshot_descriptor: (a: number) => [number, number, number, number];
    readonly tesserawasm_run_command_batch: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly tesserawasm_save_state: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly tesserawasm_state_hash: (a: number) => [number, number];
    readonly tesserawasm_tick: (a: number) => bigint;
    readonly tesserawasm_validate_placement: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly tesserawasm_world_generation: (a: number) => number;
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
