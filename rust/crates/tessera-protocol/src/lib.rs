#![forbid(unsafe_code)]

//! Browser-independent command and response codecs for the Rust/Wasm boundary.

use tessera_core::{Command, CommandEnvelope, EntityId, GridPosition, QuarterTurn};

/// Version of the command/response wire contract.
pub const PROTOCOL_VERSION: u16 = 1;
/// Eight-byte command batch magic.
pub const COMMAND_MAGIC: [u8; 8] = *b"TSCMD001";
/// Eight-byte command response magic.
pub const RESPONSE_MAGIC: [u8; 8] = *b"TSRSP001";
/// Fixed command batch header length.
pub const COMMAND_HEADER_LEN: usize = 28;
/// Fixed record header length.
pub const RECORD_HEADER_LEN: usize = 8;
/// Fixed successful response length.
pub const RESPONSE_LEN: usize = 64;
/// Maximum accepted command batch length before any record allocation.
pub const MAX_BATCH_BYTES: usize = 1024 * 1024;
/// Maximum accepted record count before any record allocation.
pub const MAX_RECORD_COUNT: u32 = 4096;

const OPCODE_SPAWN: u16 = 1;
const OPCODE_SPAWN_RANDOM: u16 = 2;
const OPCODE_MOVE: u16 = 3;
const OPCODE_REMOVE: u16 = 4;

/// A decoded command batch with its transport sequence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandBatch {
    /// Monotonic transport sequence assigned by the caller.
    pub batch_sequence: u64,
    /// Commands in their submitted batch order.
    pub commands: Vec<CommandEnvelope>,
}

/// The successful result returned after a command batch and exact tick run.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CommandResponse {
    /// Transport sequence copied from the submitted batch.
    pub batch_sequence: u64,
    /// Authoritative simulation tick after bounded advancement.
    pub tick: u64,
    /// Canonical BLAKE3 state hash after advancement.
    pub state_hash: [u8; 32],
}

/// Stable protocol failure categories. The numeric codes are part of the wire contract.
#[repr(u16)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolErrorCode {
    /// The input is shorter than a required fixed header or field.
    Truncated = 1,
    /// The magic value is not recognized.
    InvalidMagic = 2,
    /// The protocol version is not supported.
    UnsupportedVersion = 3,
    /// The declared total length does not match the input.
    InvalidTotalLength = 4,
    /// The record count is outside the accepted bound.
    InvalidRecordCount = 5,
    /// A record length would exceed the remaining batch bytes.
    InvalidRecordLength = 6,
    /// A required record flag is not supported.
    UnsupportedFlags = 7,
    /// The record opcode is not supported.
    UnknownOpcode = 8,
    /// A command payload has the wrong fixed length or invalid field.
    InvalidPayload = 9,
    /// A caller supplied an invalid seed or tick bound.
    InvalidArgument = 10,
    /// The underlying simulation rejected the operation.
    Simulation = 11,
}

/// A structured protocol failure without browser-specific error types.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProtocolError {
    /// Stable machine-readable code.
    pub code: ProtocolErrorCode,
    /// Byte offset at which validation failed when applicable.
    pub offset: u32,
}

impl ProtocolError {
    const fn new(code: ProtocolErrorCode, offset: usize) -> Self {
        let offset = if offset > u32::MAX as usize {
            u32::MAX
        } else {
            offset as u32
        };
        Self { code, offset }
    }
}

impl std::fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "protocol error {:?} at byte {}",
            self.code, self.offset
        )
    }
}

impl std::error::Error for ProtocolError {}

/// Encodes a command batch as a versioned little-endian TLV stream.
pub fn encode_command_batch(batch: &CommandBatch) -> Result<Vec<u8>, ProtocolError> {
    let record_count = u32::try_from(batch.commands.len())
        .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidRecordCount, 20))?;
    if record_count > MAX_RECORD_COUNT {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidRecordCount,
            20,
        ));
    }

    let mut records = Vec::new();
    for envelope in &batch.commands {
        let (opcode, payload) = encode_command(envelope)?;
        let payload_len = u32::try_from(payload.len())
            .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidPayload, records.len()))?;
        records.extend_from_slice(&opcode.to_le_bytes());
        records.extend_from_slice(&0_u16.to_le_bytes());
        records.extend_from_slice(&payload_len.to_le_bytes());
        records.extend_from_slice(&payload);
    }

    let total_length = COMMAND_HEADER_LEN
        .checked_add(records.len())
        .ok_or(ProtocolError::new(
            ProtocolErrorCode::InvalidTotalLength,
            24,
        ))?;
    if total_length > MAX_BATCH_BYTES {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidTotalLength,
            24,
        ));
    }

    let total_length_u32 = u32::try_from(total_length)
        .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidTotalLength, 24))?;
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend_from_slice(&COMMAND_MAGIC);
    bytes.extend_from_slice(&PROTOCOL_VERSION.to_le_bytes());
    bytes.extend_from_slice(&0_u16.to_le_bytes());
    bytes.extend_from_slice(&batch.batch_sequence.to_le_bytes());
    bytes.extend_from_slice(&record_count.to_le_bytes());
    bytes.extend_from_slice(&total_length_u32.to_le_bytes());
    bytes.extend_from_slice(&records);
    Ok(bytes)
}

/// Decodes and validates a command batch before returning any command allocation.
pub fn decode_command_batch(bytes: &[u8]) -> Result<CommandBatch, ProtocolError> {
    if bytes.len() < COMMAND_HEADER_LEN {
        return Err(ProtocolError::new(
            ProtocolErrorCode::Truncated,
            bytes.len(),
        ));
    }
    if bytes.len() > MAX_BATCH_BYTES {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidTotalLength,
            24,
        ));
    }
    if bytes[..8] != COMMAND_MAGIC {
        return Err(ProtocolError::new(ProtocolErrorCode::InvalidMagic, 0));
    }
    let version = read_u16(bytes, 8)?;
    if version != PROTOCOL_VERSION {
        return Err(ProtocolError::new(ProtocolErrorCode::UnsupportedVersion, 8));
    }
    let flags = read_u16(bytes, 10)?;
    if flags != 0 {
        return Err(ProtocolError::new(ProtocolErrorCode::UnsupportedFlags, 10));
    }
    let batch_sequence = read_u64(bytes, 12)?;
    let record_count = read_u32(bytes, 20)?;
    if record_count > MAX_RECORD_COUNT {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidRecordCount,
            20,
        ));
    }
    let total_length = usize::try_from(read_u32(bytes, 24)?)
        .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidTotalLength, 24))?;
    if total_length != bytes.len() || total_length < COMMAND_HEADER_LEN {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidTotalLength,
            24,
        ));
    }

    // Validate every record, opcode, and payload before allocating the decoded command vector.
    let mut offset = COMMAND_HEADER_LEN;
    for _ in 0..record_count {
        let (opcode, payload_start, payload_end) = record_bounds(bytes, total_length, offset)?;
        decode_command(opcode, &bytes[payload_start..payload_end], payload_start)?;
        offset = payload_end;
    }
    if offset != total_length {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidTotalLength,
            offset,
        ));
    }

    let mut commands = Vec::with_capacity(record_count as usize);
    offset = COMMAND_HEADER_LEN;
    for _ in 0..record_count {
        let (opcode, payload_start, payload_end) = record_bounds(bytes, total_length, offset)?;
        commands.push(decode_command(
            opcode,
            &bytes[payload_start..payload_end],
            payload_start,
        )?);
        offset = payload_end;
    }
    Ok(CommandBatch {
        batch_sequence,
        commands,
    })
}

fn record_bounds(
    bytes: &[u8],
    total_length: usize,
    offset: usize,
) -> Result<(u16, usize, usize), ProtocolError> {
    if total_length - offset < RECORD_HEADER_LEN {
        return Err(ProtocolError::new(ProtocolErrorCode::Truncated, offset));
    }
    let opcode = read_u16(bytes, offset)?;
    let flags = read_u16(bytes, offset + 2)?;
    if flags != 0 {
        return Err(ProtocolError::new(
            ProtocolErrorCode::UnsupportedFlags,
            offset + 2,
        ));
    }
    let payload_length = usize::try_from(read_u32(bytes, offset + 4)?)
        .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidRecordLength, offset + 4))?;
    let payload_start = offset + RECORD_HEADER_LEN;
    let payload_end = payload_start
        .checked_add(payload_length)
        .ok_or(ProtocolError::new(
            ProtocolErrorCode::InvalidRecordLength,
            offset + 4,
        ))?;
    if payload_end > total_length {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidRecordLength,
            offset + 4,
        ));
    }
    Ok((opcode, payload_start, payload_end))
}

/// Encodes a successful fixed-size command response.
pub fn encode_command_response(response: CommandResponse) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(RESPONSE_LEN);
    bytes.extend_from_slice(&RESPONSE_MAGIC);
    bytes.extend_from_slice(&PROTOCOL_VERSION.to_le_bytes());
    bytes.extend_from_slice(&0_u16.to_le_bytes());
    bytes.extend_from_slice(&response.batch_sequence.to_le_bytes());
    bytes.extend_from_slice(&response.tick.to_le_bytes());
    bytes.extend_from_slice(&response.state_hash);
    bytes.extend_from_slice(&(RESPONSE_LEN as u32).to_le_bytes());
    bytes
}

fn encode_command(envelope: &CommandEnvelope) -> Result<(u16, Vec<u8>), ProtocolError> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&envelope.client_sequence.to_le_bytes());
    match &envelope.command {
        Command::Spawn {
            object_type,
            position,
            rotation,
        } => {
            payload.extend_from_slice(&object_type.to_le_bytes());
            encode_position(&mut payload, *position, *rotation);
            Ok((OPCODE_SPAWN, payload))
        }
        Command::SpawnRandom { object_type } => {
            payload.extend_from_slice(&object_type.to_le_bytes());
            Ok((OPCODE_SPAWN_RANDOM, payload))
        }
        Command::Move {
            entity,
            position,
            rotation,
        } => {
            payload.extend_from_slice(&entity.slot().to_le_bytes());
            payload.extend_from_slice(&entity.generation().to_le_bytes());
            encode_position(&mut payload, *position, *rotation);
            Ok((OPCODE_MOVE, payload))
        }
        Command::Remove { entity } => {
            payload.extend_from_slice(&entity.slot().to_le_bytes());
            payload.extend_from_slice(&entity.generation().to_le_bytes());
            Ok((OPCODE_REMOVE, payload))
        }
    }
}

fn decode_command(
    opcode: u16,
    payload: &[u8],
    offset: usize,
) -> Result<CommandEnvelope, ProtocolError> {
    let client_sequence = read_u64(payload, 0)
        .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidPayload, offset))?;
    let command = match opcode {
        OPCODE_SPAWN => {
            if payload.len() != 25 {
                return Err(ProtocolError::new(
                    ProtocolErrorCode::InvalidPayload,
                    offset,
                ));
            }
            let object_type = read_u32(payload, 8)
                .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidPayload, offset + 8))?;
            let (position, rotation) = decode_position(payload, 12, offset)?;
            Command::Spawn {
                object_type,
                position,
                rotation,
            }
        }
        OPCODE_SPAWN_RANDOM => {
            if payload.len() != 12 {
                return Err(ProtocolError::new(
                    ProtocolErrorCode::InvalidPayload,
                    offset,
                ));
            }
            Command::SpawnRandom {
                object_type: read_u32(payload, 8).map_err(|_| {
                    ProtocolError::new(ProtocolErrorCode::InvalidPayload, offset + 8)
                })?,
            }
        }
        OPCODE_MOVE => {
            if payload.len() != 33 {
                return Err(ProtocolError::new(
                    ProtocolErrorCode::InvalidPayload,
                    offset,
                ));
            }
            let slot = read_u32(payload, 8)
                .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidPayload, offset + 8))?;
            let generation = read_u32(payload, 12)
                .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidPayload, offset + 12))?;
            let entity = EntityId::new(slot, generation).ok_or(ProtocolError::new(
                ProtocolErrorCode::InvalidPayload,
                offset + 12,
            ))?;
            let (position, rotation) = decode_position(payload, 16, offset)?;
            Command::Move {
                entity,
                position,
                rotation,
            }
        }
        OPCODE_REMOVE => {
            if payload.len() != 16 {
                return Err(ProtocolError::new(
                    ProtocolErrorCode::InvalidPayload,
                    offset,
                ));
            }
            let slot = read_u32(payload, 8)
                .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidPayload, offset + 8))?;
            let generation = read_u32(payload, 12)
                .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidPayload, offset + 12))?;
            Command::Remove {
                entity: EntityId::new(slot, generation).ok_or(ProtocolError::new(
                    ProtocolErrorCode::InvalidPayload,
                    offset + 12,
                ))?,
            }
        }
        _ => return Err(ProtocolError::new(ProtocolErrorCode::UnknownOpcode, offset)),
    };
    Ok(CommandEnvelope::new(client_sequence, command))
}

fn encode_position(out: &mut Vec<u8>, position: GridPosition, rotation: QuarterTurn) {
    out.extend_from_slice(&position.x.to_le_bytes());
    out.extend_from_slice(&position.z.to_le_bytes());
    out.extend_from_slice(&position.elevation_mm.to_le_bytes());
    out.push(rotation.as_u8());
}

fn decode_position(
    payload: &[u8],
    offset: usize,
    base_offset: usize,
) -> Result<(GridPosition, QuarterTurn), ProtocolError> {
    let x = i32::from_le_bytes(read_array(payload, offset).map_err(|_| {
        ProtocolError::new(ProtocolErrorCode::InvalidPayload, base_offset + offset)
    })?);
    let z = i32::from_le_bytes(read_array(payload, offset + 4).map_err(|_| {
        ProtocolError::new(ProtocolErrorCode::InvalidPayload, base_offset + offset + 4)
    })?);
    let elevation_mm = i32::from_le_bytes(read_array(payload, offset + 8).map_err(|_| {
        ProtocolError::new(ProtocolErrorCode::InvalidPayload, base_offset + offset + 8)
    })?);
    let rotation = payload.get(offset + 12).copied().ok_or(ProtocolError::new(
        ProtocolErrorCode::InvalidPayload,
        base_offset + offset + 12,
    ))?;
    if rotation > 3 {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidPayload,
            base_offset + offset + 12,
        ));
    }
    Ok((
        GridPosition::new(x, z, elevation_mm),
        QuarterTurn::from_index(rotation),
    ))
}

fn read_array<const N: usize>(bytes: &[u8], offset: usize) -> Result<[u8; N], ProtocolError> {
    bytes
        .get(offset..offset + N)
        .and_then(|slice| slice.try_into().ok())
        .ok_or(ProtocolError::new(ProtocolErrorCode::Truncated, offset))
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, ProtocolError> {
    Ok(u16::from_le_bytes(read_array(bytes, offset)?))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ProtocolError> {
    Ok(u32::from_le_bytes(read_array(bytes, offset)?))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, ProtocolError> {
    Ok(u64::from_le_bytes(read_array(bytes, offset)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_batch() -> CommandBatch {
        CommandBatch {
            batch_sequence: 17,
            commands: vec![CommandEnvelope::new(
                1,
                Command::Spawn {
                    object_type: 9,
                    position: GridPosition::new(-4, 8, 125),
                    rotation: QuarterTurn::R3,
                },
            )],
        }
    }

    #[test]
    fn command_batch_round_trips_little_endian_tlv() {
        let encoded = encode_command_batch(&sample_batch()).expect("sample should encode");
        assert_eq!(&encoded[..8], &COMMAND_MAGIC);
        assert_eq!(encoded.len(), COMMAND_HEADER_LEN + RECORD_HEADER_LEN + 25);
        assert_eq!(decode_command_batch(&encoded), Ok(sample_batch()));
    }

    #[test]
    fn malformed_length_is_rejected_before_record_decode() {
        let mut encoded = encode_command_batch(&sample_batch()).unwrap();
        let declared_length = u32::try_from(encoded.len() - 1).unwrap();
        encoded[24..28].copy_from_slice(&declared_length.to_le_bytes());
        assert_eq!(
            decode_command_batch(&encoded),
            Err(ProtocolError::new(
                ProtocolErrorCode::InvalidTotalLength,
                24
            ))
        );
    }

    #[test]
    fn unknown_opcode_and_required_flags_fail_closed() {
        let mut encoded = encode_command_batch(&sample_batch()).unwrap();
        encoded[COMMAND_HEADER_LEN..COMMAND_HEADER_LEN + 2].copy_from_slice(&99_u16.to_le_bytes());
        assert_eq!(
            decode_command_batch(&encoded),
            Err(ProtocolError::new(
                ProtocolErrorCode::UnknownOpcode,
                COMMAND_HEADER_LEN + RECORD_HEADER_LEN,
            ))
        );

        let mut flagged = encode_command_batch(&sample_batch()).unwrap();
        flagged[COMMAND_HEADER_LEN + 2..COMMAND_HEADER_LEN + 4]
            .copy_from_slice(&1_u16.to_le_bytes());
        assert_eq!(
            decode_command_batch(&flagged),
            Err(ProtocolError::new(
                ProtocolErrorCode::UnsupportedFlags,
                COMMAND_HEADER_LEN + 2,
            ))
        );
    }

    #[test]
    fn response_is_fixed_size_and_little_endian() {
        let response = CommandResponse {
            batch_sequence: 3,
            tick: 20,
            state_hash: [0xabu8; 32],
        };
        let encoded = encode_command_response(response);
        assert_eq!(encoded.len(), RESPONSE_LEN);
        assert_eq!(&encoded[..8], &RESPONSE_MAGIC);
        assert_eq!(&encoded[12..20], &3_u64.to_le_bytes());
        assert_eq!(&encoded[20..28], &20_u64.to_le_bytes());
        assert_eq!(&encoded[28..60], &[0xabu8; 32]);
        assert_eq!(&encoded[60..64], &(RESPONSE_LEN as u32).to_le_bytes());
    }
}
