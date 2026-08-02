#![forbid(unsafe_code)]

//! Browser-independent deterministic simulation kernel.

mod command;
mod event;
mod grid;
mod id;
mod rng;
mod simulation;

pub use command::{
    Command, CommandEnvelope, CommandReceipt, RejectionReason, ReplayCommand, ReplayLog,
};
pub use event::{EventKind, SimulationEvent};
pub use grid::{GridMathError, GridPosition, QuarterTurn, TileScale};
pub use id::{EntityArena, EntityError, EntityId, EntityState};
pub use rng::{RNG_ALGORITHM_VERSION, Seed};
pub use simulation::{
    DEFAULT_TICK_RATE_HZ, ReplayError, STATE_HASH_VERSION, Simulation, SimulationConfig,
    SimulationError, StateHash,
};
