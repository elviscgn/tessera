//! Authoritative simulation events emitted by command application.

use crate::{EntityId, GridPosition, QuarterTurn, RejectionReason};

/// An ordered event produced by the native kernel.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SimulationEvent {
    /// Monotonic event sequence within this simulation instance.
    pub event_sequence: u64,
    /// Tick at which the event was produced.
    pub tick: u64,
    /// Event payload.
    pub kind: EventKind,
}

/// Event payloads needed by the Milestone 1 native tests and replay proof.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EventKind {
    /// A command passed sequence and semantic validation.
    CommandAccepted { client_sequence: u64 },
    /// A command consumed its sequence but did not mutate state.
    CommandRejected {
        client_sequence: u64,
        reason: RejectionReason,
    },
    /// A new entity became live.
    EntitySpawned {
        client_sequence: u64,
        entity: EntityId,
        object_type: u32,
        position: GridPosition,
        rotation: QuarterTurn,
    },
    /// An existing entity changed transform.
    EntityMoved {
        client_sequence: u64,
        entity: EntityId,
        position: GridPosition,
        rotation: QuarterTurn,
    },
    /// An entity was removed.
    EntityRemoved {
        client_sequence: u64,
        entity: EntityId,
    },
}
