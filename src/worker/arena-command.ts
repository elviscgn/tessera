// Semantic arena command records (M22 protocol boundary).
//
// The JSON form of these records is parsed by
// `parse_arena_commands_json` in rust/crates/tessera-wasm/src/arena.rs;
// all encoding and validation happens in Rust, so there is no host-side
// mirror of the wire format.

export interface ArenaPlacePayload {
  body: number;
  radiusMicros: number;
  xMicros: number;
  zMicros: number;
  side: number;
  ball: boolean;
}

export interface ArenaMovePayload {
  body: number;
  xMicros: number;
  zMicros: number;
}

export interface ArenaAimPayload {
  directionXMicros: number;
  directionZMicros: number;
  powerMilli: number;
}

export type ArenaCommand =
  | { kind: 'place'; payload: ArenaPlacePayload }
  | { kind: 'move'; payload: ArenaMovePayload }
  | { kind: 'remove'; payload: { body: number } }
  | { kind: 'startTurn'; payload: { side: number } }
  | { kind: 'aim'; payload: ArenaAimPayload }
  | { kind: 'release'; payload: Record<string, never> }
  | { kind: 'power'; payload: { side: number; handle: number } };
