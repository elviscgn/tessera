// Deterministic arena command wire encoding (M22 protocol-boundary layer).
//
// This mirrors `encode_arena_command`/`decode_arena_command` in
// rust/crates/tessera-arena/src/simulation.rs byte for byte. Fixed-point
// values cross as scaled raw integers: micro * MICROMETRE_SCALE (1024).

export const MICROMETRE_SCALE = 1024;

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

function scaled(micros: number): bigint {
  return BigInt(micros) * BigInt(MICROMETRE_SCALE);
}

function pushU16(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushU32(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function pushI64(bytes: number[], value: bigint): void {
  for (let index = 0; index < 8; index += 1) {
    bytes.push(Number((value >> BigInt(index * 8)) & 0xffn));
  }
}

/** Appends one encoded command to an accumulating byte list. */
export function pushEncodedArenaCommand(bytes: number[], command: ArenaCommand): void {
  switch (command.kind) {
    case 'place': {
      const payload = command.payload;
      bytes.push(1);
      pushU32(bytes, payload.body);
      pushI64(bytes, BigInt(payload.radiusMicros));
      pushI64(bytes, scaled(payload.xMicros));
      pushI64(bytes, scaled(payload.zMicros));
      bytes.push(payload.side, payload.ball ? 1 : 0);
      break;
    }
    case 'move': {
      const payload = command.payload;
      bytes.push(2);
      pushU32(bytes, payload.body);
      pushI64(bytes, scaled(payload.xMicros));
      pushI64(bytes, scaled(payload.zMicros));
      break;
    }
    case 'remove':
      bytes.push(3);
      pushU32(bytes, command.payload.body);
      break;
    case 'startTurn':
      bytes.push(4);
      bytes.push(command.payload.side);
      break;
    case 'aim': {
      const payload = command.payload;
      bytes.push(5);
      pushI64(bytes, scaled(payload.directionXMicros));
      pushI64(bytes, scaled(payload.directionZMicros));
      pushU16(bytes, payload.powerMilli);
      break;
    }
    case 'release':
      bytes.push(6);
      break;
    case 'power':
      bytes.push(7);
      bytes.push(command.payload.side);
      pushU32(bytes, command.payload.handle);
      break;
  }
}

/** Encodes a command batch into the exact byte stream the Rust adapter parses. */
export function encodeArenaBatch(commands: readonly ArenaCommand[]): Uint8Array {
  const bytes: number[] = [];
  for (const command of commands) {
    pushEncodedArenaCommand(bytes, command);
  }
  return Uint8Array.from(bytes);
}