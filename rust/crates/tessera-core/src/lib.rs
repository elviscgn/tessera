#![forbid(unsafe_code)]

//! Browser-independent deterministic simulation kernel.

mod command;
mod event;
mod grid;
mod id;
mod occupancy;
mod rng;
mod save;
mod simulation;

pub use command::{
    Command, CommandEnvelope, CommandReceipt, RejectionReason, ReplayCommand, ReplayLog,
};
pub use event::{EventKind, SimulationEvent};
pub use grid::{GridMathError, GridPosition, QuarterTurn, TileScale};
pub use id::{EntityArena, EntityError, EntityId, EntityState};
pub use occupancy::{
    Footprint, FootprintError, FootprintOffset, GridConfigurationError, GridInvariantError,
    MAX_FOOTPRINT_CELLS, OccupancyError, OccupancyGrid,
};
pub use rng::{RNG_ALGORITHM_VERSION, Seed};
pub use save::{LoadedSave, MAX_SAVE_BYTES, SAVE_FORMAT, SAVE_SCHEMA_VERSION, SaveError};
pub use simulation::{
    DEFAULT_TICK_RATE_HZ, ReplayError, STATE_HASH_VERSION, Simulation, SimulationConfig,
    SimulationError, StateHash,
};
