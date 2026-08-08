# Protocol

This page records the versioned wire contract between the browser, the Worker, and Rust. The authoritative definitions live in `rust/crates/tessera-protocol` and the matching validators in `src/worker`. Anything described here is a compatibility commitment: a change to a magic value, layout, code, or required field is a protocol version change and must follow the compatibility policy at the end of this page.

## Version and identity

- `PROTOCOL_VERSION = 1` is a `u16` written at a fixed offset in every message.
- Every message starts with an eight-byte magic string. A mismatch fails closed before any field is trusted.

| Message                       | Magic      |
| ----------------------------- | ---------- |
| Command batch                 | `TSCMD001` |
| Command response              | `TSRSP001` |
| Render snapshot               | `TSRND001` |
| Render memory descriptor      | `TSDES001` |
| Reliable event batch          | `TSEVT001` |
| Placement validation response | `TSPLC001` |

All integers are little-endian. Unknown required versions, flags, opcodes, and lengths are rejected before allocation, rendering, or mutation.

## Limits

| Bound                             | Value  |
| --------------------------------- | ------ |
| Maximum command batch bytes       | 1 MiB  |
| Maximum command records per batch | 4096   |
| Maximum render snapshot payload   | 16 MiB |
| Maximum event batch bytes         | 1 MiB  |
| Maximum event records per batch   | 1024   |

These are transport bounds, not capacity promises. A record that would exceed the remaining batch bytes is rejected as an invalid record length.

## Command batch

Fixed 28-byte header (`COMMAND_HEADER_LEN`) followed by TLV records:

| Offset | Length | Field                     |
| ------ | ------ | ------------------------- |
| 0      | 8      | magic                     |
| 8      | 2      | protocol version          |
| 10     | 2      | flags (must be zero)      |
| 12     | 8      | batch sequence (`u64`)    |
| 20     | 4      | record count (`u32`)      |
| 24     | 4      | total byte length (`u32`) |

Each record starts with a fixed 8-byte header:

| Offset | Length | Field                  |
| ------ | ------ | ---------------------- |
| 0      | 2      | opcode (`u16`)         |
| 2      | 2      | flags (must be zero)   |
| 4      | 4      | payload length (`u32`) |

Command opcodes:

| Opcode | Meaning                                     |
| ------ | ------------------------------------------- |
| 1      | spawn an object at an integer grid position |
| 2      | spawn with the seeded random spawn helper   |
| 3      | move an existing entity                     |
| 4      | remove an existing entity                   |

The live Worker submits monotonic batch sequences. Invalid or duplicate commands consume their client sequence, produce deterministic rejection events, and do not mutate state.

## Command response

Fixed 64-byte success response (`RESPONSE_LEN`):

| Offset | Length | Field                                        |
| ------ | ------ | -------------------------------------------- |
| 0      | 8      | magic                                        |
| 8      | 2      | protocol version                             |
| 10     | 2      | flags (must be zero)                         |
| 12     | 8      | batch sequence (`u64`)                       |
| 20     | 8      | authoritative tick after advancement (`u64`) |
| 28     | 32     | canonical BLAKE3 state hash                  |

## Placement validation response

Fixed 40-byte response (`PLACEMENT_RESPONSE_LEN`):

| Offset | Length | Field                            |
| ------ | ------ | -------------------------------- |
| 0      | 8      | magic                            |
| 8      | 2      | protocol version                 |
| 10     | 2      | flags (must be zero)             |
| 12     | 4      | total byte length (`u32`)        |
| 16     | 4      | object type handle (`u32`)       |
| 20     | 4      | grid `x` (`i32`)                 |
| 24     | 4      | grid `z` (`i32`)                 |
| 28     | 4      | elevation millimetres (`i32`)    |
| 32     | 1      | clockwise quarter-turn `r0..r3`  |
| 33     | 1      | valid flag                       |
| 34     | 1      | rejection code (zero when valid) |
| 36     | 4      | occupied cell count (`u32`)      |

## Render snapshot

Fixed 64-byte header (`RENDER_HEADER_LEN`) followed by a region table and packed structure-of-arrays data:

| Offset | Length | Field                            |
| ------ | ------ | -------------------------------- |
| 0      | 8      | magic                            |
| 8      | 2      | protocol version                 |
| 10     | 2      | header length (`u16`)            |
| 12     | 4      | flags (`u32`)                    |
| 16     | 4      | total byte length (`u32`)        |
| 20     | 4      | world generation (`u32`)         |
| 24     | 8      | snapshot generation (`u64`)      |
| 32     | 8      | simulation tick (`u64`)          |
| 40     | 4      | entity count (`u32`)             |
| 44     | 4      | entity capacity (`u32`)          |
| 48     | 4      | source memory generation (`u32`) |
| 52     | 2      | region count (`u16`)             |
| 54     | 2      | region descriptor length (`u16`) |
| 56     | 4      | region-table offset (`u32`)      |

Each region descriptor is a fixed 32 bytes (`RENDER_REGION_DESCRIPTOR_LEN`):

| Offset | Length | Field                          |
| ------ | ------ | ------------------------------ |
| 0      | 2      | region kind (`u16`)            |
| 2      | 1      | scalar type                    |
| 3      | 1      | component count                |
| 4      | 4      | flags (`u32`)                  |
| 8      | 4      | byte offset (`u32`)            |
| 12     | 4      | element count (`u32`)          |
| 16     | 4      | meaningful byte length (`u32`) |
| 20     | 4      | allocated capacity (`u32`)     |

Region kinds:

| Kind | Region                                                |
| ---- | ----------------------------------------------------- |
| 1    | entity slot (`u32`)                                   |
| 2    | entity generation (`u32`)                             |
| 3    | position `(x, z, elevationMm)` (`i32 × 3`)            |
| 4    | rotation quaternion `(x, y, z, w)` (`f32 × 4`)        |
| 5    | scale `(x, y, z)` (`f32 × 3`)                         |
| 6    | visual type handle (`u32`)                            |
| 7    | renderer flags (`u32`)                                |
| 8    | animation state                                       |
| 9    | animation phase                                       |
| 10   | occupied grid cells `(x, z, elevationMm)` (`i32 × 3`) |

Scalar types: `u8 = 1`, `u16 = 2`, `u32 = 3`, `i32 = 4`, `f32 = 5`. Float regions carry presentation vectors only and can never mutate Rust state. Snapshot regions are latest-wins projection data: the Worker may drop an intermediate snapshot under buffer pressure, but never a command, tick, or authoritative event.

## Render memory descriptor

The Worker publishes a fixed 32-byte descriptor before the payload is read from Wasm memory:

| Offset | Length | Field                          |
| ------ | ------ | ------------------------------ |
| 0      | 8      | magic                          |
| 8      | 2      | protocol version               |
| 10     | 2      | descriptor length (`u16`)      |
| 12     | 4      | Wasm memory pointer (`u32`)    |
| 16     | 4      | meaningful byte length (`u32`) |
| 20     | 4      | capacity (`u32`)               |
| 24     | 8      | snapshot generation (`u64`)    |

Byte length must not exceed capacity. Wasm memory growth invalidates prior views, so the Worker compares the memory buffer identity and length on every descriptor read, recreates its views, and carries the resulting memory generation in the snapshot header.

## Reliable event batch

Fixed 48-byte header (`EVENT_HEADER_LEN`) followed by TLV records:

| Offset | Length | Field                                  |
| ------ | ------ | -------------------------------------- |
| 0      | 8      | magic                                  |
| 8      | 2      | protocol version                       |
| 10     | 2      | flags (must be zero)                   |
| 12     | 4      | total byte length (`u32`)              |
| 16     | 8      | first event sequence (`u64`)           |
| 24     | 8      | last event sequence (`u64`)            |
| 32     | 4      | record count (`u32`)                   |
| 36     | 4      | reserved (must be zero)                |
| 40     | 8      | producer acknowledgement floor (`u64`) |

Records use the same 8-byte header as commands. Event opcodes:

| Opcode | Event            |
| ------ | ---------------- |
| 1      | command accepted |
| 2      | command rejected |
| 3      | entity spawned   |
| 4      | entity moved     |
| 5      | entity removed   |

Event records carry a monotonically increasing `event_sequence`. A batch must be contiguous: `first_sequence` through `last_sequence` with no gaps. The main thread acknowledges the highest contiguous sequence it has consumed; a detected gap triggers retransmission and, if continuity cannot be restored, the runtime enters `event_stream_desynced` and requires an authoritative resynchronization. Events are never silently dropped.

## Engine-track extension (protocol v2)

The v0.1 protocol remains valid for grid-first consumers. A continuous-arena consumer negotiates protocol version 2 and an explicit capability set before sending arena data. A v2 peer must fail closed when it does not understand an authoritative capability; it may ignore an optional presentation capability only when the descriptor marks it optional.

### Arena command wire encoding (implemented)

The engine-track binary command encoding `encode_arena_command`/`decode_arena_command` in `rust/crates/tessera-arena` is mirrored byte-for-byte by `src/worker/arena-encoding.ts`. Each command starts with a discriminant byte; fixed-point fields are little-endian signed 64-bit raw values (micrometres scaled by 1024) followed by fixed-size payloads:

| Discriminant | Command   | Payload                                                          |
| ------------ | --------- | ---------------------------------------------------------------- |
| 1            | place     | body `u32`, radius `i64`, x `i64`, z `i64`, side `u8`, ball `u8` |
| 2            | move      | body `u32`, x `i64`, z `i64`                                     |
| 3            | remove    | body `u32`                                                       |
| 4            | startTurn | side `u8`                                                        |
| 5            | aim       | direction-x `i64`, direction-z `i64`, power-milli `u16`          |
| 6            | release   | —                                                                |
| 7            | power     | side `u8`, handle `u32`                                          |

The native encoding is the same encoding that feeds the canonical state hash (versioned `TESSERA_ARENA_STATE` bytes hashed with BLAKE3), so a Wasm session and a native engine produce identical hashes for identical command sequences — verified by the pinned parity hash in `tests/unit/arena-wasm-parity.test.ts`.

Arena commands are semantic records, not input streams:

- formation edit with selected entity handles and validated target positions;
- ready/cancel and turn ownership changes;
- aim-and-release with quantized direction, power, and selected actor;
- power activation with a consumer-defined power handle.

The command carries the same client sequence and assigned-tick rules as v1. Pointer samples, animation frames, and collision contacts never become commands. Reliable v2 events add phase/turn transitions, shot accepted or rejected, shot resolved, goal scored, power-play changes, timeout, and match completion. Event sequence, retransmission, acknowledgement, and resynchronization rules do not change.

V2 render descriptors may add optional structure-of-arrays regions for fixed-point continuous position, linear velocity, angular state, collider/visibility flags, team or owner handle, and presentation timeline state. Authoritative fixed-point values use signed 64-bit micrometre units; arithmetic and canonical hashes use the Rust-defined encoding, not Babylon matrices or JavaScript numbers. Match phase and score are authoritative events and snapshot metadata, so a renderer can rebuild after a dropped frame or replay seek.

## Structured error codes

Errors are reported as stable codes rather than browser-specific exceptions:

| Code | Meaning                                         |
| ---- | ----------------------------------------------- |
| 1    | input shorter than a required header or field   |
| 2    | unrecognized magic                              |
| 3    | unsupported protocol version                    |
| 4    | declared total length does not match input      |
| 5    | record count outside the accepted bound         |
| 6    | record length exceeds the remaining batch bytes |
| 7    | unsupported required flags                      |
| 8    | unsupported opcode                              |
| 9    | invalid payload length or field                 |
| 10   | invalid seed or tick bound                      |
| 11   | simulation rejected the operation               |
| 12   | event records are not contiguous or ordered     |
| 13   | invalid render region descriptor                |
| 14   | invalid render memory descriptor                |

## Save format

Saves are deliberately separate from the per-frame protocol. A save is a versioned UTF-8 JSON DTO generated by Rust containing the seed, registry metadata, arena slots, occupancy index, pending commands, event log, replay records, and the current tick. The envelope carries schema version, framework version, game/scenario identity, protocol version, and a BLAKE3 checksum over the DTO with its checksum field empty. Schema version 1 is the only supported document today; the migration boundary is explicit and a pure migration step will be added only when a second schema exists.

## Compatibility policy

- Every change to a magic, header layout, record layout, opcode, region kind, scalar type, or required field is a protocol version change requiring a new `PROTOCOL_VERSION`.
- Unknown required versions fail closed: a caller must not guess, reinterpret, or skip an unknown required field.
- Golden fixtures and native/Wasm/browser contract tests must be updated together with the version, and the native-versus-Wasm parity suite must pass at every checkpoint.
- Rendering-only additions may remain behind optional region flags only when the new protocol version defines the omission explicitly.
- A future `SharedArrayBuffer` transport is a separate protocol concern and requires its own versioned publication scheme with an automatic fallback to the transferable path.
