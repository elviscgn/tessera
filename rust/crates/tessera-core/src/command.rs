//! Commands and replay records accepted by the deterministic kernel.

use crate::{EntityId, GridPosition, QuarterTurn};

/// A gameplay command understood by the Milestone 1 kernel.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Command {
    /// Creates an entity at an explicit integer transform.
    Spawn {
        object_type: u32,
        position: GridPosition,
        rotation: QuarterTurn,
    },
    /// Creates an entity at a deterministic position derived from ChaCha8.
    SpawnRandom { object_type: u32 },
    /// Changes an existing entity transform.
    Move {
        entity: EntityId,
        position: GridPosition,
        rotation: QuarterTurn,
    },
    /// Removes an existing entity.
    Remove { entity: EntityId },
}

/// A live command with a client-owned monotonic sequence number.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandEnvelope {
    /// Monotonic client sequence; zero is invalid but still consumed.
    pub client_sequence: u64,
    /// Command payload.
    pub command: Command,
}

impl CommandEnvelope {
    /// Creates a sequenced command envelope.
    pub const fn new(client_sequence: u64, command: Command) -> Self {
        Self {
            client_sequence,
            command,
        }
    }
}

/// Receipt returned when Rust schedules a submitted command batch.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CommandReceipt {
    /// Client sequence that was consumed.
    pub client_sequence: u64,
    /// Tick on which the command will be evaluated.
    pub scheduled_tick: u64,
    /// Position in its submitted batch.
    pub batch_order: u32,
}

/// A command persisted for deterministic replay with its assigned tick.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayCommand {
    /// Assigned simulation tick.
    pub scheduled_tick: u64,
    /// Client sequence consumed by the command.
    pub client_sequence: u64,
    /// Original batch position.
    pub batch_order: u32,
    /// Original command payload.
    pub command: Command,
}

/// A replay input and its intended final tick.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ReplayLog {
    /// The tick at which the source simulation was captured.
    pub final_tick: u64,
    /// Commands in submission order.
    pub commands: Vec<ReplayCommand>,
}

/// Deterministic reasons a command can be rejected.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RejectionReason {
    /// Sequence zero is reserved.
    ZeroSequence = 1,
    /// A sequence already consumed by an earlier command was submitted again.
    DuplicateSequence = 2,
    /// A new sequence was lower than the highest accepted sequence.
    NonMonotonicSequence = 3,
    /// Object type zero is reserved as invalid.
    InvalidObjectType = 4,
    /// The target entity was absent or stale.
    UnknownEntity = 5,
    /// An entity generation could not advance safely.
    GenerationExhausted = 6,
    /// The command would claim a cell already occupied by another entity.
    OccupiedCell = 7,
    /// The configured footprint could not be expanded at the requested anchor.
    InvalidFootprint = 8,
}

impl RejectionReason {
    /// Stable numeric representation for canonical state and future protocols.
    pub const fn code(self) -> u8 {
        self as u8
    }
}
