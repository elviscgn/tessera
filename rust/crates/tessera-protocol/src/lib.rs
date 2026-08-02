#![forbid(unsafe_code)]

//! Browser-independent command and response codecs for the Rust/Wasm boundary.

use tessera_core::{
    Command, CommandEnvelope, EntityId, EntityState, EventKind, GridPosition, QuarterTurn,
    RejectionReason, SimulationEvent,
};

/// Version of the command/response wire contract.
pub const PROTOCOL_VERSION: u16 = 1;
/// Eight-byte command batch magic.
pub const COMMAND_MAGIC: [u8; 8] = *b"TSCMD001";
/// Eight-byte command response magic.
pub const RESPONSE_MAGIC: [u8; 8] = *b"TSRSP001";
/// Eight-byte render snapshot magic.
pub const RENDER_MAGIC: [u8; 8] = *b"TSRND001";
/// Eight-byte render descriptor magic.
pub const RENDER_DESCRIPTOR_MAGIC: [u8; 8] = *b"TSDES001";
/// Eight-byte reliable event batch magic.
pub const EVENT_MAGIC: [u8; 8] = *b"TSEVT001";
/// Fixed command batch header length.
pub const COMMAND_HEADER_LEN: usize = 28;
/// Fixed record header length.
pub const RECORD_HEADER_LEN: usize = 8;
/// Fixed successful response length.
pub const RESPONSE_LEN: usize = 64;
/// Fixed render snapshot header length.
pub const RENDER_HEADER_LEN: usize = 64;
/// Fixed render region descriptor length.
pub const RENDER_REGION_DESCRIPTOR_LEN: usize = 32;
/// Fixed descriptor returned before reading the Wasm memory payload.
pub const RENDER_DESCRIPTOR_LEN: usize = 32;
/// Fixed reliable event batch header length.
pub const EVENT_HEADER_LEN: usize = 48;
/// Fixed event record header length.
pub const EVENT_RECORD_HEADER_LEN: usize = 8;
/// Maximum accepted command batch length before any record allocation.
pub const MAX_BATCH_BYTES: usize = 1024 * 1024;
/// Maximum accepted record count before any record allocation.
pub const MAX_RECORD_COUNT: u32 = 4096;
/// Maximum render snapshot payload accepted by the transport.
pub const MAX_RENDER_BYTES: usize = 16 * 1024 * 1024;
/// Maximum event batch bytes accepted by the transport.
pub const MAX_EVENT_BATCH_BYTES: usize = 1024 * 1024;
/// Maximum event records returned in one reliable batch.
pub const MAX_EVENT_RECORD_COUNT: u32 = 1024;

const OPCODE_SPAWN: u16 = 1;
const OPCODE_SPAWN_RANDOM: u16 = 2;
const OPCODE_MOVE: u16 = 3;
const OPCODE_REMOVE: u16 = 4;
const EVENT_OPCODE_COMMAND_ACCEPTED: u16 = 1;
const EVENT_OPCODE_COMMAND_REJECTED: u16 = 2;
const EVENT_OPCODE_ENTITY_SPAWNED: u16 = 3;
const EVENT_OPCODE_ENTITY_MOVED: u16 = 4;
const EVENT_OPCODE_ENTITY_REMOVED: u16 = 5;

/// Render regions are deliberately scalar and renderer-neutral.
#[repr(u16)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderRegionKind {
    /// Slot component of the generational entity ID.
    EntitySlot = 1,
    /// Generation component of the generational entity ID.
    EntityGeneration = 2,
    /// Integer millimetre position `(x, z, elevation)`.
    Position = 3,
    /// Presentation quaternion `(x, y, z, w)`.
    RotationQuaternion = 4,
    /// Presentation scale `(x, y, z)`.
    Scale = 5,
    /// Consumer-defined visual type handle.
    VisualType = 6,
    /// Renderer flags.
    RenderFlags = 7,
    /// Presentation animation state.
    AnimationState = 8,
    /// Presentation animation phase.
    AnimationPhase = 9,
}

/// Scalar encodings used by render regions.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderScalarType {
    /// Unsigned byte.
    U8 = 1,
    /// Unsigned 16-bit integer.
    U16 = 2,
    /// Unsigned 32-bit integer.
    U32 = 3,
    /// Signed 32-bit integer.
    I32 = 4,
    /// IEEE-754 32-bit float used only for presentation vectors.
    F32 = 5,
}

/// One fixed render region descriptor.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RenderRegionDescriptor {
    /// Region kind code.
    pub kind: RenderRegionKind,
    /// Scalar type code.
    pub scalar_type: RenderScalarType,
    /// Number of scalar components per element.
    pub component_count: u8,
    /// Region flags.
    pub flags: u32,
    /// Offset from the start of the snapshot buffer.
    pub offset: u32,
    /// Number of logical elements.
    pub element_count: u32,
    /// Number of bytes containing meaningful values.
    pub byte_length: u32,
    /// Allocated region capacity in bytes.
    pub capacity: u32,
}

/// Metadata needed to read a render payload from Wasm memory.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RenderSnapshotDescriptor {
    /// Wasm linear-memory pointer.
    pub pointer: u32,
    /// Meaningful payload length.
    pub byte_length: u32,
    /// Allocated payload capacity.
    pub capacity: u32,
    /// Monotonic snapshot generation.
    pub snapshot_generation: u64,
}

/// A decoded reliable event batch.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventBatch {
    /// First event sequence in the batch, or zero when empty.
    pub first_sequence: u64,
    /// Last event sequence in the batch, or zero when empty.
    pub last_sequence: u64,
    /// Highest sequence acknowledged by the producer.
    pub ack_floor: u64,
    /// Ordered event records.
    pub events: Vec<SimulationEvent>,
}

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
    /// Event records are not contiguous or ordered.
    InvalidEventSequence = 12,
    /// A render region descriptor is invalid.
    InvalidRegion = 13,
    /// A render memory descriptor is invalid.
    InvalidDescriptor = 14,
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

/// Encodes a renderer-neutral hybrid structure-of-arrays snapshot.
pub fn encode_render_snapshot(
    entities: &[EntityState],
    simulation_tick: u64,
    world_generation: u32,
    snapshot_generation: u64,
    memory_generation: u32,
) -> Result<Vec<u8>, ProtocolError> {
    let entity_count = u32::try_from(entities.len())
        .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidRegion, 40))?;
    let region_count = 9_u16;
    let table_length = usize::from(region_count)
        .checked_mul(RENDER_REGION_DESCRIPTOR_LEN)
        .ok_or(ProtocolError::new(ProtocolErrorCode::InvalidRegion, 56))?;
    let data_start = RENDER_HEADER_LEN
        .checked_add(table_length)
        .ok_or(ProtocolError::new(ProtocolErrorCode::InvalidRegion, 56))?;
    let mut bytes = vec![0_u8; data_start];
    let mut regions = Vec::with_capacity(usize::from(region_count));

    let mut push_region = |kind: RenderRegionKind,
                           scalar_type: RenderScalarType,
                           component_count: u8,
                           start: usize,
                           byte_length: usize| {
        regions.push(RenderRegionDescriptor {
            kind,
            scalar_type,
            component_count,
            flags: 0,
            offset: u32::try_from(start).unwrap_or(u32::MAX),
            element_count: entity_count,
            byte_length: u32::try_from(byte_length).unwrap_or(u32::MAX),
            capacity: u32::try_from(byte_length).unwrap_or(u32::MAX),
        });
    };

    let start = bytes.len();
    for entity in entities {
        bytes.extend_from_slice(&entity.id.slot().to_le_bytes());
    }
    push_region(
        RenderRegionKind::EntitySlot,
        RenderScalarType::U32,
        1,
        start,
        bytes.len().saturating_sub(start),
    );

    let start = bytes.len();
    for entity in entities {
        bytes.extend_from_slice(&entity.id.generation().to_le_bytes());
    }
    push_region(
        RenderRegionKind::EntityGeneration,
        RenderScalarType::U32,
        1,
        start,
        bytes.len().saturating_sub(start),
    );

    let start = bytes.len();
    for entity in entities {
        bytes.extend_from_slice(&entity.position.x.to_le_bytes());
        bytes.extend_from_slice(&entity.position.z.to_le_bytes());
        bytes.extend_from_slice(&entity.position.elevation_mm.to_le_bytes());
    }
    push_region(
        RenderRegionKind::Position,
        RenderScalarType::I32,
        3,
        start,
        bytes.len().saturating_sub(start),
    );

    let start = bytes.len();
    for entity in entities {
        for value in rotation_quaternion(entity.rotation) {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    push_region(
        RenderRegionKind::RotationQuaternion,
        RenderScalarType::F32,
        4,
        start,
        bytes.len().saturating_sub(start),
    );

    let start = bytes.len();
    for _ in entities {
        for value in [1.0_f32, 1.0, 1.0] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    push_region(
        RenderRegionKind::Scale,
        RenderScalarType::F32,
        3,
        start,
        bytes.len().saturating_sub(start),
    );

    let start = bytes.len();
    for entity in entities {
        bytes.extend_from_slice(&entity.object_type.to_le_bytes());
    }
    push_region(
        RenderRegionKind::VisualType,
        RenderScalarType::U32,
        1,
        start,
        bytes.len().saturating_sub(start),
    );

    let start = bytes.len();
    for _ in entities {
        bytes.extend_from_slice(&1_u32.to_le_bytes());
    }
    push_region(
        RenderRegionKind::RenderFlags,
        RenderScalarType::U32,
        1,
        start,
        bytes.len().saturating_sub(start),
    );

    let start = bytes.len();
    for _ in entities {
        bytes.extend_from_slice(&0_u16.to_le_bytes());
    }
    push_region(
        RenderRegionKind::AnimationState,
        RenderScalarType::U16,
        1,
        start,
        bytes.len().saturating_sub(start),
    );

    let start = bytes.len();
    for _ in entities {
        bytes.extend_from_slice(&0_u16.to_le_bytes());
    }
    push_region(
        RenderRegionKind::AnimationPhase,
        RenderScalarType::U16,
        1,
        start,
        bytes.len().saturating_sub(start),
    );

    if bytes.len() > MAX_RENDER_BYTES {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidTotalLength,
            16,
        ));
    }
    let total_length = u32::try_from(bytes.len())
        .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidTotalLength, 16))?;
    bytes[..8].copy_from_slice(&RENDER_MAGIC);
    bytes[8..10].copy_from_slice(&PROTOCOL_VERSION.to_le_bytes());
    bytes[10..12].copy_from_slice(&(RENDER_HEADER_LEN as u16).to_le_bytes());
    bytes[12..16].copy_from_slice(&0_u32.to_le_bytes());
    bytes[16..20].copy_from_slice(&total_length.to_le_bytes());
    bytes[20..24].copy_from_slice(&world_generation.to_le_bytes());
    bytes[24..32].copy_from_slice(&snapshot_generation.to_le_bytes());
    bytes[32..40].copy_from_slice(&simulation_tick.to_le_bytes());
    bytes[40..44].copy_from_slice(&entity_count.to_le_bytes());
    bytes[44..48].copy_from_slice(&entity_count.to_le_bytes());
    bytes[48..52].copy_from_slice(&memory_generation.to_le_bytes());
    bytes[52..54].copy_from_slice(&region_count.to_le_bytes());
    bytes[54..56].copy_from_slice(&(RENDER_REGION_DESCRIPTOR_LEN as u16).to_le_bytes());
    bytes[56..60].copy_from_slice(&(RENDER_HEADER_LEN as u32).to_le_bytes());
    bytes[60..64].copy_from_slice(&0_u32.to_le_bytes());

    for (index, region) in regions.into_iter().enumerate() {
        let offset = RENDER_HEADER_LEN + index * RENDER_REGION_DESCRIPTOR_LEN;
        bytes[offset..offset + 2].copy_from_slice(&(region.kind as u16).to_le_bytes());
        bytes[offset + 2] = region.scalar_type as u8;
        bytes[offset + 3] = region.component_count;
        bytes[offset + 4..offset + 8].copy_from_slice(&region.flags.to_le_bytes());
        bytes[offset + 8..offset + 12].copy_from_slice(&region.offset.to_le_bytes());
        bytes[offset + 12..offset + 16].copy_from_slice(&region.element_count.to_le_bytes());
        bytes[offset + 16..offset + 20].copy_from_slice(&region.byte_length.to_le_bytes());
        bytes[offset + 20..offset + 24].copy_from_slice(&region.capacity.to_le_bytes());
        bytes[offset + 24..offset + 32].copy_from_slice(&0_u64.to_le_bytes());
    }
    Ok(bytes)
}

/// Encodes a fixed descriptor that points at the latest snapshot in Wasm memory.
pub fn encode_render_descriptor(descriptor: RenderSnapshotDescriptor) -> Vec<u8> {
    let mut bytes = vec![0_u8; RENDER_DESCRIPTOR_LEN];
    bytes[..8].copy_from_slice(&RENDER_DESCRIPTOR_MAGIC);
    bytes[8..10].copy_from_slice(&PROTOCOL_VERSION.to_le_bytes());
    bytes[10..12].copy_from_slice(&(RENDER_DESCRIPTOR_LEN as u16).to_le_bytes());
    bytes[12..16].copy_from_slice(&descriptor.pointer.to_le_bytes());
    bytes[16..20].copy_from_slice(&descriptor.byte_length.to_le_bytes());
    bytes[20..24].copy_from_slice(&descriptor.capacity.to_le_bytes());
    bytes[24..32].copy_from_slice(&descriptor.snapshot_generation.to_le_bytes());
    bytes
}

/// Decodes and validates a render memory descriptor.
pub fn decode_render_descriptor(bytes: &[u8]) -> Result<RenderSnapshotDescriptor, ProtocolError> {
    if bytes.len() != RENDER_DESCRIPTOR_LEN {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidDescriptor,
            bytes.len(),
        ));
    }
    if bytes[..8] != RENDER_DESCRIPTOR_MAGIC {
        return Err(ProtocolError::new(ProtocolErrorCode::InvalidMagic, 0));
    }
    if read_u16(bytes, 8)? != PROTOCOL_VERSION {
        return Err(ProtocolError::new(ProtocolErrorCode::UnsupportedVersion, 8));
    }
    if read_u16(bytes, 10)? != RENDER_DESCRIPTOR_LEN as u16 {
        return Err(ProtocolError::new(ProtocolErrorCode::InvalidDescriptor, 10));
    }
    let byte_length = read_u32(bytes, 16)?;
    let capacity = read_u32(bytes, 20)?;
    if byte_length > capacity {
        return Err(ProtocolError::new(ProtocolErrorCode::InvalidDescriptor, 16));
    }
    Ok(RenderSnapshotDescriptor {
        pointer: read_u32(bytes, 12)?,
        byte_length,
        capacity,
        snapshot_generation: read_u64(bytes, 24)?,
    })
}

fn rotation_quaternion(rotation: QuarterTurn) -> [f32; 4] {
    match rotation {
        QuarterTurn::R0 => [0.0, 0.0, 0.0, 1.0],
        QuarterTurn::R1 => [0.0, 0.70710677, 0.0, 0.70710677],
        QuarterTurn::R2 => [0.0, 1.0, 0.0, 0.0],
        QuarterTurn::R3 => [0.0, -0.70710677, 0.0, 0.70710677],
    }
}

/// Encodes ordered authoritative events as a reliable little-endian batch.
pub fn encode_event_batch(
    events: &[SimulationEvent],
    ack_floor: u64,
) -> Result<Vec<u8>, ProtocolError> {
    let record_count = u32::try_from(events.len())
        .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidRecordCount, 32))?;
    if record_count > MAX_EVENT_RECORD_COUNT {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidRecordCount,
            32,
        ));
    }
    let mut records = Vec::new();
    let mut previous_sequence: Option<u64> = None;
    for event in events {
        if previous_sequence.is_some_and(|previous| {
            previous
                .checked_add(1)
                .is_none_or(|expected| event.event_sequence != expected)
        }) {
            return Err(ProtocolError::new(
                ProtocolErrorCode::InvalidEventSequence,
                records.len(),
            ));
        }
        previous_sequence = Some(event.event_sequence);
        let (opcode, payload) = encode_event(event);
        let payload_length = u32::try_from(payload.len())
            .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidPayload, records.len()))?;
        records.extend_from_slice(&opcode.to_le_bytes());
        records.extend_from_slice(&0_u16.to_le_bytes());
        records.extend_from_slice(&payload_length.to_le_bytes());
        records.extend_from_slice(&payload);
    }
    let total_length = EVENT_HEADER_LEN
        .checked_add(records.len())
        .ok_or(ProtocolError::new(
            ProtocolErrorCode::InvalidTotalLength,
            12,
        ))?;
    if total_length > MAX_EVENT_BATCH_BYTES {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidTotalLength,
            12,
        ));
    }
    let first_sequence = events.first().map_or(0, |event| event.event_sequence);
    let last_sequence = events.last().map_or(0, |event| event.event_sequence);
    let total_length = u32::try_from(total_length)
        .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidTotalLength, 12))?;
    let mut bytes = Vec::with_capacity(total_length as usize);
    bytes.extend_from_slice(&EVENT_MAGIC);
    bytes.extend_from_slice(&PROTOCOL_VERSION.to_le_bytes());
    bytes.extend_from_slice(&0_u16.to_le_bytes());
    bytes.extend_from_slice(&total_length.to_le_bytes());
    bytes.extend_from_slice(&first_sequence.to_le_bytes());
    bytes.extend_from_slice(&last_sequence.to_le_bytes());
    bytes.extend_from_slice(&record_count.to_le_bytes());
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    bytes.extend_from_slice(&ack_floor.to_le_bytes());
    bytes.extend_from_slice(&records);
    Ok(bytes)
}

/// Decodes and validates a reliable event batch before allocating its records.
pub fn decode_event_batch(bytes: &[u8]) -> Result<EventBatch, ProtocolError> {
    if bytes.len() < EVENT_HEADER_LEN {
        return Err(ProtocolError::new(
            ProtocolErrorCode::Truncated,
            bytes.len(),
        ));
    }
    if bytes.len() > MAX_EVENT_BATCH_BYTES {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidTotalLength,
            12,
        ));
    }
    if bytes[..8] != EVENT_MAGIC {
        return Err(ProtocolError::new(ProtocolErrorCode::InvalidMagic, 0));
    }
    if read_u16(bytes, 8)? != PROTOCOL_VERSION {
        return Err(ProtocolError::new(ProtocolErrorCode::UnsupportedVersion, 8));
    }
    if read_u16(bytes, 10)? != 0 {
        return Err(ProtocolError::new(ProtocolErrorCode::UnsupportedFlags, 10));
    }
    let total_length = usize::try_from(read_u32(bytes, 12)?)
        .map_err(|_| ProtocolError::new(ProtocolErrorCode::InvalidTotalLength, 12))?;
    if total_length != bytes.len() || total_length < EVENT_HEADER_LEN {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidTotalLength,
            12,
        ));
    }
    let first_sequence = read_u64(bytes, 16)?;
    let last_sequence = read_u64(bytes, 24)?;
    let record_count = read_u32(bytes, 32)?;
    if record_count > MAX_EVENT_RECORD_COUNT {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidRecordCount,
            32,
        ));
    }
    let ack_floor = read_u64(bytes, 40)?;
    if record_count == 0 {
        if first_sequence != 0 || last_sequence != 0 {
            return Err(ProtocolError::new(
                ProtocolErrorCode::InvalidEventSequence,
                16,
            ));
        }
        return Ok(EventBatch {
            first_sequence,
            last_sequence,
            ack_floor,
            events: Vec::new(),
        });
    }
    if first_sequence == 0 || last_sequence < first_sequence {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidEventSequence,
            16,
        ));
    }
    let expected_records = last_sequence
        .checked_sub(first_sequence)
        .and_then(|difference| difference.checked_add(1))
        .ok_or(ProtocolError::new(
            ProtocolErrorCode::InvalidEventSequence,
            16,
        ))?;
    if expected_records != u64::from(record_count) {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidEventSequence,
            32,
        ));
    }

    let mut offset = EVENT_HEADER_LEN;
    for index in 0..record_count {
        let (opcode, payload_start, payload_end) =
            event_record_bounds(bytes, total_length, offset)?;
        validate_event_payload(opcode, &bytes[payload_start..payload_end], payload_start)?;
        let event_sequence = read_u64(bytes, payload_start)?;
        let expected = first_sequence + u64::from(index);
        if event_sequence != expected {
            return Err(ProtocolError::new(
                ProtocolErrorCode::InvalidEventSequence,
                payload_start,
            ));
        }
        offset = payload_end;
    }
    if offset != total_length {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidTotalLength,
            offset,
        ));
    }

    let mut events = Vec::with_capacity(record_count as usize);
    offset = EVENT_HEADER_LEN;
    for _ in 0..record_count {
        let (opcode, payload_start, payload_end) =
            event_record_bounds(bytes, total_length, offset)?;
        events.push(decode_event(
            opcode,
            &bytes[payload_start..payload_end],
            payload_start,
        )?);
        offset = payload_end;
    }
    Ok(EventBatch {
        first_sequence,
        last_sequence,
        ack_floor,
        events,
    })
}

fn encode_event(event: &SimulationEvent) -> (u16, Vec<u8>) {
    let mut payload = Vec::new();
    payload.extend_from_slice(&event.event_sequence.to_le_bytes());
    payload.extend_from_slice(&event.tick.to_le_bytes());
    let opcode = match &event.kind {
        EventKind::CommandAccepted { client_sequence } => {
            payload.extend_from_slice(&client_sequence.to_le_bytes());
            EVENT_OPCODE_COMMAND_ACCEPTED
        }
        EventKind::CommandRejected {
            client_sequence,
            reason,
        } => {
            payload.extend_from_slice(&client_sequence.to_le_bytes());
            payload.push(reason.code());
            payload.extend_from_slice(&[0_u8; 7]);
            EVENT_OPCODE_COMMAND_REJECTED
        }
        EventKind::EntitySpawned {
            client_sequence,
            entity,
            object_type,
            position,
            rotation,
        } => {
            payload.extend_from_slice(&client_sequence.to_le_bytes());
            payload.extend_from_slice(&entity.slot().to_le_bytes());
            payload.extend_from_slice(&entity.generation().to_le_bytes());
            payload.extend_from_slice(&object_type.to_le_bytes());
            payload.extend_from_slice(&position.x.to_le_bytes());
            payload.extend_from_slice(&position.z.to_le_bytes());
            payload.extend_from_slice(&position.elevation_mm.to_le_bytes());
            payload.push(rotation.as_u8());
            payload.extend_from_slice(&[0_u8; 3]);
            EVENT_OPCODE_ENTITY_SPAWNED
        }
        EventKind::EntityMoved {
            client_sequence,
            entity,
            position,
            rotation,
        } => {
            payload.extend_from_slice(&client_sequence.to_le_bytes());
            payload.extend_from_slice(&entity.slot().to_le_bytes());
            payload.extend_from_slice(&entity.generation().to_le_bytes());
            payload.extend_from_slice(&0_u32.to_le_bytes());
            payload.extend_from_slice(&position.x.to_le_bytes());
            payload.extend_from_slice(&position.z.to_le_bytes());
            payload.extend_from_slice(&position.elevation_mm.to_le_bytes());
            payload.push(rotation.as_u8());
            payload.extend_from_slice(&[0_u8; 3]);
            EVENT_OPCODE_ENTITY_MOVED
        }
        EventKind::EntityRemoved {
            client_sequence,
            entity,
        } => {
            payload.extend_from_slice(&client_sequence.to_le_bytes());
            payload.extend_from_slice(&entity.slot().to_le_bytes());
            payload.extend_from_slice(&entity.generation().to_le_bytes());
            EVENT_OPCODE_ENTITY_REMOVED
        }
    };
    (opcode, payload)
}

fn event_record_bounds(
    bytes: &[u8],
    total_length: usize,
    offset: usize,
) -> Result<(u16, usize, usize), ProtocolError> {
    if total_length - offset < EVENT_RECORD_HEADER_LEN {
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
    let payload_start = offset + EVENT_RECORD_HEADER_LEN;
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

fn validate_event_payload(opcode: u16, payload: &[u8], offset: usize) -> Result<(), ProtocolError> {
    let expected_length = match opcode {
        EVENT_OPCODE_COMMAND_ACCEPTED => 24,
        EVENT_OPCODE_COMMAND_REJECTED => 32,
        EVENT_OPCODE_ENTITY_SPAWNED | EVENT_OPCODE_ENTITY_MOVED => 52,
        EVENT_OPCODE_ENTITY_REMOVED => 32,
        _ => return Err(ProtocolError::new(ProtocolErrorCode::UnknownOpcode, offset)),
    };
    if payload.len() != expected_length {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidPayload,
            offset,
        ));
    }
    Ok(())
}

fn decode_event(
    opcode: u16,
    payload: &[u8],
    offset: usize,
) -> Result<SimulationEvent, ProtocolError> {
    validate_event_payload(opcode, payload, offset)?;
    let event_sequence = read_u64(payload, 0)?;
    let tick = read_u64(payload, 8)?;
    let kind = match opcode {
        EVENT_OPCODE_COMMAND_ACCEPTED => EventKind::CommandAccepted {
            client_sequence: read_u64(payload, 16)?,
        },
        EVENT_OPCODE_COMMAND_REJECTED => EventKind::CommandRejected {
            client_sequence: read_u64(payload, 16)?,
            reason: rejection_reason(payload[24])?,
        },
        EVENT_OPCODE_ENTITY_SPAWNED | EVENT_OPCODE_ENTITY_MOVED => {
            let client_sequence = read_u64(payload, 16)?;
            let entity = EntityId::new(read_u32(payload, 24)?, read_u32(payload, 28)?).ok_or(
                ProtocolError::new(ProtocolErrorCode::InvalidPayload, offset + 28),
            )?;
            let object_type = read_u32(payload, 32)?;
            let position = GridPosition::new(
                i32::from_le_bytes(read_array(payload, 36)?),
                i32::from_le_bytes(read_array(payload, 40)?),
                i32::from_le_bytes(read_array(payload, 44)?),
            );
            let rotation = payload[48];
            if rotation > 3 {
                return Err(ProtocolError::new(
                    ProtocolErrorCode::InvalidPayload,
                    offset + 48,
                ));
            }
            if opcode == EVENT_OPCODE_ENTITY_SPAWNED {
                EventKind::EntitySpawned {
                    client_sequence,
                    entity,
                    object_type,
                    position,
                    rotation: QuarterTurn::from_index(rotation),
                }
            } else {
                EventKind::EntityMoved {
                    client_sequence,
                    entity,
                    position,
                    rotation: QuarterTurn::from_index(rotation),
                }
            }
        }
        EVENT_OPCODE_ENTITY_REMOVED => EventKind::EntityRemoved {
            client_sequence: read_u64(payload, 16)?,
            entity: EntityId::new(read_u32(payload, 24)?, read_u32(payload, 28)?).ok_or(
                ProtocolError::new(ProtocolErrorCode::InvalidPayload, offset + 28),
            )?,
        },
        _ => return Err(ProtocolError::new(ProtocolErrorCode::UnknownOpcode, offset)),
    };
    Ok(SimulationEvent {
        event_sequence,
        tick,
        kind,
    })
}

fn rejection_reason(code: u8) -> Result<RejectionReason, ProtocolError> {
    match code {
        1 => Ok(RejectionReason::ZeroSequence),
        2 => Ok(RejectionReason::DuplicateSequence),
        3 => Ok(RejectionReason::NonMonotonicSequence),
        4 => Ok(RejectionReason::InvalidObjectType),
        5 => Ok(RejectionReason::UnknownEntity),
        6 => Ok(RejectionReason::GenerationExhausted),
        _ => Err(ProtocolError::new(ProtocolErrorCode::InvalidPayload, 24)),
    }
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

    fn sample_events() -> Vec<SimulationEvent> {
        let entity = EntityId::new(2, 1).unwrap();
        vec![
            SimulationEvent {
                event_sequence: 1,
                tick: 1,
                kind: EventKind::CommandAccepted { client_sequence: 1 },
            },
            SimulationEvent {
                event_sequence: 2,
                tick: 1,
                kind: EventKind::EntitySpawned {
                    client_sequence: 1,
                    entity,
                    object_type: 7,
                    position: GridPosition::new(-3, 4, 250),
                    rotation: QuarterTurn::R1,
                },
            },
            SimulationEvent {
                event_sequence: 3,
                tick: 2,
                kind: EventKind::EntityMoved {
                    client_sequence: 2,
                    entity,
                    position: GridPosition::new(5, 6, 500),
                    rotation: QuarterTurn::R2,
                },
            },
            SimulationEvent {
                event_sequence: 4,
                tick: 3,
                kind: EventKind::EntityRemoved {
                    client_sequence: 3,
                    entity,
                },
            },
        ]
    }

    #[test]
    fn render_snapshot_has_fixed_header_and_regions() {
        let entity = EntityState {
            id: EntityId::new(0, 1).unwrap(),
            object_type: 4,
            position: GridPosition::new(-2, 3, 100),
            rotation: QuarterTurn::R3,
        };
        let encoded = encode_render_snapshot(&[entity], 8, 1, 5, 0).unwrap();
        assert_eq!(&encoded[..8], &RENDER_MAGIC);
        assert_eq!(u16::from_le_bytes(encoded[52..54].try_into().unwrap()), 9);
        assert_eq!(
            u32::from_le_bytes(encoded[16..20].try_into().unwrap()) as usize,
            encoded.len()
        );
        assert_eq!(u32::from_le_bytes(encoded[40..44].try_into().unwrap()), 1);
        assert!(encoded.len() < MAX_RENDER_BYTES);
        let descriptor = RenderSnapshotDescriptor {
            pointer: 12,
            byte_length: encoded.len() as u32,
            capacity: encoded.len() as u32,
            snapshot_generation: 5,
        };
        assert_eq!(
            decode_render_descriptor(&encode_render_descriptor(descriptor)),
            Ok(descriptor)
        );
    }

    #[test]
    fn event_batch_round_trips_and_preserves_sequence_metadata() {
        let events = sample_events();
        let encoded = encode_event_batch(&events, 2).unwrap();
        assert_eq!(&encoded[..8], &EVENT_MAGIC);
        let decoded = decode_event_batch(&encoded).unwrap();
        assert_eq!(decoded.first_sequence, 1);
        assert_eq!(decoded.last_sequence, 4);
        assert_eq!(decoded.ack_floor, 2);
        assert_eq!(decoded.events, events);
    }

    #[test]
    fn event_batch_rejects_a_sequence_gap() {
        let mut encoded = encode_event_batch(&sample_events(), 0).unwrap();
        let second_payload_sequence = EVENT_HEADER_LEN + EVENT_RECORD_HEADER_LEN + 24 + 8;
        encoded[second_payload_sequence..second_payload_sequence + 8]
            .copy_from_slice(&9_u64.to_le_bytes());
        assert_eq!(
            decode_event_batch(&encoded),
            Err(ProtocolError::new(
                ProtocolErrorCode::InvalidEventSequence,
                second_payload_sequence,
            ))
        );
    }
}
