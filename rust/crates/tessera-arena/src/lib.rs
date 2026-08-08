//! Deterministic continuous arena engine — the M16+ engine-track core.
//!
//! This crate owns the continuous-tabletop track: fixed-point arithmetic,
//! arena geometry, dynamic bodies, match phases, turns, deterministic narrow
//! collision, goals, and replay. It deliberately shares no code with the
//! grid simulation core: the two tracks stay on separate versioned contracts
//! so the v0.1 grid foundation and the engine track can advance independently.

#![forbid(unsafe_code)]

pub mod fixed;
pub mod geometry;
pub mod simulation;

pub use fixed::{Fixed, Vec2};
pub use geometry::{ArenaGeometryError, ArenaLayout, Disc};
pub use simulation::{
    ARENA_STATE_HASH_VERSION, ARENA_TICK_RATE_HZ, ArenaBody, ArenaCommand, ArenaError, ArenaEvent,
    ArenaSimulation, ArenaStateHash, DEFAULT_BALL_RADIUS_MICROS, DEFAULT_STRIKER_RADIUS_MICROS,
    MAX_RELEASE_TICKS, MAX_SHOT_VELOCITY, POWER_DOUBLE_SHOT, Phase, REST_SPEED, ReplayCommand,
    ReplayLog, Velocity,
};
