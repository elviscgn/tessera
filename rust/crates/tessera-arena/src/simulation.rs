//! The deterministic continuous arena simulation — engine-track M17/M18 core.
//!
//! This module owns the authoritative continuous arena: fixed-point dynamic
//! bodies, match phases, turns, semantic commands, deterministic narrow
//! collision, goals, replay, and a canonical state hash. Every value that
//! reaches the canonical encoding is deterministic integer arithmetic only.

use crate::fixed::{Fixed, Vec2};
use crate::geometry::{ArenaGeometryError, ArenaLayout, Disc};
use std::collections::BTreeMap;

/// Version of the canonical arena-state encoding (engine-track M17).
pub const ARENA_STATE_HASH_VERSION: u16 = 1;
/// The fixed tick rate of the arena simulation.
pub const ARENA_TICK_RATE_HZ: u32 = 20;
/// Default ball radius in micrometres.
pub const DEFAULT_BALL_RADIUS_MICROS: i64 = 37_000;
/// Default striker radius in micrometres.
pub const DEFAULT_STRIKER_RADIUS_MICROS: i64 = 45_000;
/// Maximum velocity a release can impart (micrometres per tick at full power).
pub const MAX_SHOT_VELOCITY: Fixed = Fixed::from_micro(260_000);
/// Rest threshold: a ball below this speed ends the leg (micrometres per tick).
pub const REST_SPEED: Fixed = Fixed::from_micro(1);
/// Maximum ticks a leg may stay in motion (hard timeout).
pub const MAX_RELEASE_TICKS: u64 = 600;
/// Per-tick friction decay applied to every moving body.
const FRICTION_DECAY: Fixed = Fixed::from_raw(1019);
/// Bounce restitution on walls and body contact.
const RESTITUTION: Fixed = Fixed::from_raw(770);
/// Tangential wall damping after a bounce.
const WALL_TANGENT_DAMP: Fixed = Fixed::from_raw(962);
/// Power handle reserved for the standard double-shot power-up.
pub const POWER_DOUBLE_SHOT: u32 = 1;

/// A deterministic fixed-point linear velocity in micrometres per tick.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, PartialOrd)]
pub struct Velocity {
    /// x component, micrometres per tick.
    pub x: Fixed,
    /// z component, micrometres per tick.
    pub z: Fixed,
}

impl Velocity {
    /// The zero velocity.
    pub const fn zero() -> Self {
        Self {
            x: Fixed::zero(),
            z: Fixed::zero(),
        }
    }

    /// A velocity from raw components.
    pub const fn from_raw(x: Fixed, z: Fixed) -> Self {
        Self { x, z }
    }

    /// The squared speed.
    pub fn speed_squared(self) -> Fixed {
        self.x.saturating_mul(self.x) + self.z.saturating_mul(self.z)
    }

    /// The speed.
    pub fn speed(self) -> Fixed {
        self.speed_squared().sqrt()
    }

    /// Whether the speed is below a rest threshold.
    pub fn at_rest(self, threshold: Fixed) -> bool {
        self.speed_squared() < threshold.saturating_mul(threshold)
    }
}

/// A dynamic body in the arena. Identities are stable handles so stale
/// command references can be rejected deterministically.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ArenaBody {
    /// Stable identity.
    pub id: u32,
    /// Body radius in micrometres.
    pub radius_micros: i64,
    /// Continuous centre position.
    pub position: Vec2,
    /// Continuous linear velocity (micrometres per tick).
    pub velocity: Velocity,
    /// Authoritative side (0 or 1).
    pub side: u8,
    /// Whether this body is the ball.
    pub is_ball: bool,
}

/// A canonical 32-byte BLAKE3 digest.
pub type ArenaStateHash = [u8; 32];

/// Errors returned by the arena simulation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArenaError {
    /// The tick counter cannot advance without wrapping.
    TickOverflow,
    /// A command references an unknown, duplicate, or stale body.
    UnknownBody,
    /// The side argument is outside the two-owner convention.
    InvalidSide,
    /// The requested power handle is not defined.
    UnknownPower,
    /// A command is not legal in the current match phase.
    InvalidPhase,
    /// A placement would leave the arena.
    OutOfBounds,
    /// Replay records are not ordered by tick.
    TickOrderViolation,
    /// The tick of a replay record has no valid future.
    InvalidScheduledTick,
    /// The final replay tick precedes the contained commands.
    FinalTickTooLow,
    /// Too many replay commands were submitted.
    ReplayTooLarge,
    /// The match is already complete and rejects further commands.
    MatchComplete,
    /// The client submitted a duplicated sequence.
    SequenceDuplicate,
    /// The ball is required for the command.
    NoBall,
}

/// A semantic arena command (engine-track M18).
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ArenaCommand {
    /// Place a body at a fixed-point position.
    Place {
        /// Application-side body handle (1-based).
        body: u32,
        /// Continuous centre.
        position: Vec2,
        /// Radius in micrometres.
        radius_micros: i64,
        /// Owner side (0 or 1).
        side: u8,
        /// Whether this is the ball.
        ball: bool,
    },
    /// Move a body to a fixed-point position (formation edits etc.).
    Move { body: u32, position: Vec2 },
    /// Remove a body.
    Remove { body: u32 },
    /// Award possession and begin a turn for a side.
    StartTurn { side: u8 },
    /// Aim the current turn with a direction vector and power (0..1000).
    Aim { direction: Vec2, power_milli: u16 },
    /// Release the aimed shot.
    Release,
    /// Activate a consumer-defined power handle for a side.
    Power { side: u8, handle: u32 },
}

/// A command assigned to a tick with its client sequence.
#[derive(Clone, Debug)]
struct ScheduledCommand {
    scheduled_tick: u64,
    client_sequence: u64,
    batch_order: u32,
    command: ArenaCommand,
}

/// The arena phase: which part of a leg the match is in.
///
/// - `Setup`: bodies may be placed, moved, removed; no turn is active.
/// - `Aiming`: the possessing side may aim and release; moves are frozen.
/// - `Releasing`: the ball is in deterministic motion; physics resolves.
/// - `Resolved`: the leg is over; turn alternates unless the match is done.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, PartialOrd, Ord)]
pub enum Phase {
    /// Bodies can be placed and moved; no turn active.
    #[default]
    Setup,
    /// The side in possession aims and releases.
    Aiming,
    /// The ball is in deterministic motion.
    Releasing,
    /// The leg resolved; ready for the next turn or match end.
    Resolved,
}

/// A command persisted for deterministic replay.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayCommand {
    /// Assigned simulation tick.
    pub scheduled_tick: u64,
    /// Client sequence consumed by the command.
    pub client_sequence: u64,
    /// Original batch position.
    pub batch_order: u32,
    /// Original command payload.
    pub command: ArenaCommand,
}

/// A replay input and its intended final tick.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ReplayLog {
    /// The tick at which the source simulation was captured.
    pub final_tick: u64,
    /// Commands in submission order.
    pub commands: Vec<ReplayCommand>,
}

/// A deterministic arena event for the presentation layer.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ArenaEvent {
    /// A body was placed.
    Placed { body: u32, side: u8, ball: bool },
    /// A body was moved.
    Moved { body: u32 },
    /// A body was removed.
    Removed { body: u32 },
    /// Possession switched to a side.
    TurnStarted { side: u8 },
    /// A shot was aimed with deterministic power.
    Aimed { power_milli: u16 },
    /// A ball was released and is resolving.
    Released,
    /// A goal was scored by a side.
    Goal { side: u8 },
    /// The match is over.
    MatchOver { score: (u32, u32) },
    /// A power handle was activated for a side.
    PowerOn { side: u8, handle: u32 },
    /// A command was rejected and did not mutate state.
    Rejected { reason: ArenaError },
}

/// The deterministic continuous arena simulation.
#[derive(Clone)]
pub struct ArenaSimulation {
    layout: ArenaLayout,
    tick: u64,
    phase: Phase,
    possession: u8,
    bodies: BTreeMap<u32, ArenaBody>,
    score: (u32, u32),
    win_goals: u32,
    match_over: bool,
    pending: Vec<ScheduledCommand>,
    seen_sequences: Vec<u64>,
    last_client_sequence: u64,
    replay: Vec<ReplayCommand>,
    events: Vec<ArenaEvent>,
    release_ticks: u64,
    aim_direction: Option<Vec2>,
    aim_power_milli: u16,
    double_shot_next: [bool; 2],
}

impl ArenaSimulation {
    /// Creates an empty arena at tick zero with a layout and win target.
    pub fn new(layout: ArenaLayout, win_goals: u32) -> Result<Self, ArenaGeometryError> {
        layout.validate()?;
        Ok(Self {
            layout,
            tick: 0,
            phase: Phase::Setup,
            possession: 0,
            bodies: BTreeMap::new(),
            score: (0, 0),
            win_goals,
            match_over: false,
            pending: Vec::new(),
            seen_sequences: Vec::new(),
            last_client_sequence: 0,
            replay: Vec::new(),
            events: Vec::new(),
            release_ticks: 0,
            aim_direction: None,
            aim_power_milli: 0,
            double_shot_next: [false; 2],
        })
    }

    /// Creates an arena with the standard layout and a 5-goal win target.
    pub fn standard() -> Self {
        Self::new(ArenaLayout::standard(), 5).expect("standard layout is valid")
    }

    /// The current tick.
    pub const fn tick(&self) -> u64 {
        self.tick
    }

    /// The arena layout.
    pub const fn layout(&self) -> ArenaLayout {
        self.layout
    }

    /// The current phase.
    pub const fn phase(&self) -> Phase {
        self.phase
    }

    /// The side in possession.
    pub const fn possession(&self) -> u8 {
        self.possession
    }

    /// The score.
    pub const fn score(&self) -> (u32, u32) {
        self.score
    }

    /// Whether the match is over.
    pub const fn is_complete(&self) -> bool {
        self.match_over
    }

    /// Iterates live bodies by id.
    pub fn bodies(&self) -> impl Iterator<Item = &ArenaBody> {
        self.bodies.values()
    }

    /// A body by id.
    pub fn body(&self, id: u32) -> Option<&ArenaBody> {
        self.bodies.get(&id)
    }

    /// The ball, if placed.
    pub fn ball(&self) -> Option<&ArenaBody> {
        self.bodies.values().find(|body| body.is_ball)
    }

    /// The number of live bodies.
    pub fn body_count(&self) -> usize {
        self.bodies.len()
    }

    /// The next client sequence that will be accepted.
    pub fn next_client_sequence(&self) -> u64 {
        self.last_client_sequence + 1
    }

    /// Submits a batch of commands for the next unstarted tick.
    pub fn submit_batch(&mut self, commands: &[ArenaCommand]) -> Result<Vec<u64>, ArenaError> {
        let scheduled_tick = self.tick.checked_add(1).ok_or(ArenaError::TickOverflow)?;
        let mut sequences = Vec::with_capacity(commands.len());
        for (batch_order, command) in commands.iter().enumerate() {
            let client_sequence = self.next_client_sequence();
            let batch_order = u32::try_from(batch_order).map_err(|_| ArenaError::ReplayTooLarge)?;
            self.seen_sequences.push(client_sequence);
            self.last_client_sequence = client_sequence;
            self.pending.push(ScheduledCommand {
                scheduled_tick,
                client_sequence,
                batch_order,
                command: command.clone(),
            });
            self.replay.push(ReplayCommand {
                scheduled_tick,
                client_sequence,
                batch_order,
                command: command.clone(),
            });
            sequences.push(client_sequence);
        }
        Ok(sequences)
    }

    /// Advances exactly one fixed tick.
    pub fn advance_one_tick(&mut self) -> Result<(), ArenaError> {
        let next_tick = self.tick.checked_add(1).ok_or(ArenaError::TickOverflow)?;
        let mut due = Vec::new();
        let mut future = Vec::new();
        for command in self.pending.drain(..) {
            if command.scheduled_tick <= next_tick {
                due.push(command);
            } else {
                future.push(command);
            }
        }
        due.sort_by_key(|command| {
            (
                command.scheduled_tick,
                command.client_sequence,
                command.batch_order,
            )
        });
        self.pending = future;
        self.tick = next_tick;

        for command in due {
            self.apply_scheduled(&command)?;
        }

        if self.phase == Phase::Releasing {
            self.step_physics()?;
            self.release_ticks += 1;
            let ball_moving = self
                .ball()
                .is_some_and(|ball| !ball.velocity.at_rest(REST_SPEED));
            let timed_out = self.release_ticks >= MAX_RELEASE_TICKS;
            if !ball_moving || timed_out {
                self.end_leg()?;
            }
        }
        Ok(())
    }

    /// Advances exactly `count` ticks.
    pub fn advance_ticks(&mut self, count: u64) -> Result<(), ArenaError> {
        for _ in 0..count {
            self.advance_one_tick()?;
        }
        Ok(())
    }

    /// The ordered event log without clearing.
    pub fn events(&self) -> &[ArenaEvent] {
        &self.events
    }

    /// Takes the ordered event log.
    pub fn drain_events(&mut self) -> Vec<ArenaEvent> {
        std::mem::take(&mut self.events)
    }

    /// The replay log for deterministic reproduction.
    pub fn replay_log(&self) -> ReplayLog {
        ReplayLog {
            final_tick: self.tick,
            commands: self.replay.clone(),
        }
    }

    /// Rebuilds an arena from a replay log.
    pub fn replay(
        layout: ArenaLayout,
        win_goals: u32,
        log: &ReplayLog,
    ) -> Result<Self, ArenaError> {
        let mut arena = Self::new(layout, win_goals).map_err(|_| ArenaError::ReplayTooLarge)?;
        let mut index = 0;
        while index < log.commands.len() {
            let target_tick = log.commands[index].scheduled_tick;
            if target_tick == 0 {
                return Err(ArenaError::InvalidScheduledTick);
            }
            if target_tick <= arena.tick {
                return Err(ArenaError::TickOrderViolation);
            }
            while arena.tick + 1 < target_tick {
                arena.advance_one_tick()?;
            }
            let start = index;
            while index < log.commands.len() && log.commands[index].scheduled_tick == target_tick {
                index += 1;
            }
            let commands: Vec<_> = log.commands[start..index]
                .iter()
                .map(|record| record.command.clone())
                .collect();
            arena.submit_batch(&commands)?;
            arena.advance_one_tick()?;
        }
        if log.final_tick < arena.tick {
            return Err(ArenaError::FinalTickTooLow);
        }
        arena.advance_ticks(log.final_tick - arena.tick)?;
        Ok(arena)
    }

    /// The canonical bytes used as the state-hash input.
    pub fn canonical_state_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"TESSERA_ARENA_STATE\0");
        out.extend_from_slice(&ARENA_STATE_HASH_VERSION.to_le_bytes());
        out.extend_from_slice(&ARENA_TICK_RATE_HZ.to_le_bytes());
        out.extend_from_slice(&self.layout.width_micrometres.to_le_bytes());
        out.extend_from_slice(&self.layout.depth_micrometres.to_le_bytes());
        out.extend_from_slice(&self.layout.wall_thickness_micros.to_le_bytes());
        out.extend_from_slice(&self.layout.pocket_radius_micros.to_le_bytes());
        out.extend_from_slice(&self.tick.to_le_bytes());
        out.push(self.phase as u8);
        out.push(self.possession);
        out.extend_from_slice(&self.score.0.to_le_bytes());
        out.extend_from_slice(&self.score.1.to_le_bytes());
        out.extend_from_slice(&self.win_goals.to_le_bytes());
        out.push(u8::from(self.match_over));
        out.extend_from_slice(&(self.bodies.len() as u64).to_le_bytes());
        for (id, body) in &self.bodies {
            out.extend_from_slice(&id.to_le_bytes());
            out.extend_from_slice(&body.radius_micros.to_le_bytes());
            out.extend_from_slice(&body.position.x.raw().to_le_bytes());
            out.extend_from_slice(&body.position.z.raw().to_le_bytes());
            out.extend_from_slice(&body.velocity.x.raw().to_le_bytes());
            out.extend_from_slice(&body.velocity.z.raw().to_le_bytes());
            out.push(body.side);
            out.push(u8::from(body.is_ball));
        }
        let mut pending = self.pending.clone();
        pending.sort_by_key(|command| {
            (
                command.scheduled_tick,
                command.client_sequence,
                command.batch_order,
            )
        });
        out.extend_from_slice(&(pending.len() as u64).to_le_bytes());
        for command in &pending {
            out.extend_from_slice(&command.scheduled_tick.to_le_bytes());
            out.extend_from_slice(&command.client_sequence.to_le_bytes());
            out.extend_from_slice(&command.batch_order.to_le_bytes());
            encode_arena_command(&mut out, &command.command);
        }
        out
    }

    /// Hashes meaningful state using the versioned canonical encoding.
    pub fn state_hash(&self) -> ArenaStateHash {
        *blake3::hash(&self.canonical_state_bytes()).as_bytes()
    }

    /// Returns the state hash as lowercase hexadecimal.
    pub fn state_hash_hex(&self) -> String {
        blake3::Hash::from(self.state_hash()).to_hex().to_string()
    }

    /// Checks a prospective body placement without mutating state.
    pub fn validate_placement(&self, radius_micros: i64, position: Vec2) -> Result<(), ArenaError> {
        if self.layout_inside(radius_micros, position) {
            Ok(())
        } else {
            Err(ArenaError::OutOfBounds)
        }
    }

    fn apply_scheduled(&mut self, command: &ScheduledCommand) -> Result<(), ArenaError> {
        if self.match_over {
            return self.reject(ArenaError::MatchComplete);
        }
        match command.command.clone() {
            ArenaCommand::Place {
                body,
                position,
                radius_micros,
                side,
                ball,
            } => {
                if side > 1 {
                    return self.reject(ArenaError::InvalidSide);
                }
                if self.phase != Phase::Setup {
                    return self.reject(ArenaError::InvalidPhase);
                }
                if !self.layout_inside(radius_micros, position) {
                    return self.reject(ArenaError::OutOfBounds);
                }
                if body == 0 || self.bodies.contains_key(&body) {
                    return self.reject(ArenaError::UnknownBody);
                }
                if ball && self.bodies.values().any(|existing| existing.is_ball) {
                    return self.reject(ArenaError::UnknownBody);
                }
                self.bodies.insert(
                    body,
                    ArenaBody {
                        id: body,
                        radius_micros,
                        position,
                        velocity: Velocity::zero(),
                        side,
                        is_ball: ball,
                    },
                );
                self.events.push(ArenaEvent::Placed { body, side, ball });
            }
            ArenaCommand::Move { body, position } => {
                let current = match self.bodies.get(&body) {
                    Some(body) => *body,
                    None => return self.reject(ArenaError::UnknownBody),
                };
                if self.phase == Phase::Releasing {
                    return self.reject(ArenaError::InvalidPhase);
                }
                if !self.layout_inside(current.radius_micros, position) {
                    return self.reject(ArenaError::OutOfBounds);
                }
                self.bodies.insert(
                    body,
                    ArenaBody {
                        position,
                        ..current
                    },
                );
                self.events.push(ArenaEvent::Moved { body });
            }
            ArenaCommand::Remove { body } => {
                if self.bodies.remove(&body).is_none() {
                    return self.reject(ArenaError::UnknownBody);
                }
                self.events.push(ArenaEvent::Removed { body });
            }
            ArenaCommand::StartTurn { side } => {
                if side > 1 {
                    return self.reject(ArenaError::InvalidSide);
                }
                if self.ball().is_none() {
                    return self.reject(ArenaError::NoBall);
                }
                self.possession = side;
                if self.phase == Phase::Setup || self.phase == Phase::Resolved {
                    self.phase = Phase::Aiming;
                }
                self.aim_direction = None;
                self.aim_power_milli = 0;
                self.events.push(ArenaEvent::TurnStarted { side });
            }
            ArenaCommand::Aim {
                direction,
                power_milli,
            } => {
                if self.phase != Phase::Aiming {
                    return self.reject(ArenaError::InvalidPhase);
                }
                if power_milli > 1_000 {
                    return self.reject(ArenaError::InvalidPhase);
                }
                if direction.length().is_zero() {
                    return self.reject(ArenaError::InvalidPhase);
                }
                self.aim_direction = Some(direction);
                self.aim_power_milli = power_milli;
                self.events.push(ArenaEvent::Aimed { power_milli });
            }
            ArenaCommand::Release => {
                if self.phase != Phase::Aiming {
                    return self.reject(ArenaError::InvalidPhase);
                }
                let direction = match self.aim_direction {
                    Some(direction) => direction.saturating_div_length(direction.length()),
                    None => return self.reject(ArenaError::InvalidPhase),
                };
                let ball_id = match self.ball() {
                    Some(ball) => ball.id,
                    None => return self.reject(ArenaError::NoBall),
                };
                let power = Fixed::from_micro(i64::from(self.aim_power_milli));
                let side_index = usize::from(self.possession);
                let multiplier = if self.double_shot_next[side_index] {
                    self.double_shot_next[side_index] = false;
                    Fixed::from_micro(2)
                } else {
                    Fixed::one()
                };
                let base = MAX_SHOT_VELOCITY
                    .saturating_mul(power)
                    .saturating_div(Fixed::from_micro(1000));
                let speed = base.saturating_mul(multiplier);
                let ball = self.bodies.get_mut(&ball_id).expect("ball exists");
                ball.velocity = Velocity::from_raw(
                    direction.x.saturating_mul(speed),
                    direction.z.saturating_mul(speed),
                );
                self.phase = Phase::Releasing;
                self.release_ticks = 0;
                self.events.push(ArenaEvent::Released);
            }
            ArenaCommand::Power { side, handle } => {
                if side > 1 {
                    return self.reject(ArenaError::InvalidSide);
                }
                if self.phase != Phase::Aiming {
                    return self.reject(ArenaError::InvalidPhase);
                }
                match handle {
                    POWER_DOUBLE_SHOT => {
                        self.double_shot_next[usize::from(side)] = true;
                    }
                    _ => return self.reject(ArenaError::UnknownPower),
                }
                self.events.push(ArenaEvent::PowerOn { side, handle });
            }
        }
        Ok(())
    }

    fn end_leg(&mut self) -> Result<(), ArenaError> {
        if self.phase != Phase::Releasing {
            return Ok(());
        }
        self.phase = Phase::Resolved;
        self.release_ticks = 0;
        self.aim_direction = None;
        Ok(())
    }

    fn reject(&mut self, reason: ArenaError) -> Result<(), ArenaError> {
        self.events.push(ArenaEvent::Rejected { reason });
        Ok(())
    }

    fn layout_inside(&self, radius_micros: i64, position: Vec2) -> bool {
        let min_x = self.layout.min_centre_x(radius_micros);
        let max_x = self.layout.max_centre_x(radius_micros);
        let min_z = self.layout.min_centre_z(radius_micros);
        let max_z = self.layout.max_centre_z(radius_micros);
        let x = position.x.to_micro_floor();
        let z = position.z.to_micro_floor();
        x >= min_x && x <= max_x && z >= min_z && z <= max_z
    }

    fn step_physics(&mut self) -> Result<(), ArenaError> {
        // Friction, then integration, in body-id order.
        let ids: Vec<u32> = self.bodies.keys().copied().collect();
        for id in &ids {
            let mut body = self.bodies[id];
            body.velocity = Velocity {
                x: body.velocity.x.saturating_mul(FRICTION_DECAY),
                z: body.velocity.z.saturating_mul(FRICTION_DECAY),
            };
            body.position = body
                .position
                .saturating_add(velocity_as_vec2(body.velocity));
            self.bodies.insert(*id, body);
        }
        // Resolve walls.
        let ids: Vec<u32> = self.bodies.keys().copied().collect();
        for id in ids {
            let body = self.bodies[&id];
            let x_min = self.layout.min_centre_x(body.radius_micros);
            let x_max = self.layout.max_centre_x(body.radius_micros);
            let z_min = self.layout.min_centre_z(body.radius_micros);
            let z_max = self.layout.max_centre_z(body.radius_micros);
            let mut velocity = body.velocity;
            let mut position = body.position;
            let x = position.x.to_micro_floor();
            let z = position.z.to_micro_floor();
            if x < x_min {
                position.x = Fixed::from_micro(x_min);
                velocity.x = -velocity.x.saturating_mul(RESTITUTION);
                velocity.z = velocity.z.saturating_mul(WALL_TANGENT_DAMP);
            } else if x > x_max {
                position.x = Fixed::from_micro(x_max);
                velocity.x = -velocity.x.saturating_mul(RESTITUTION);
                velocity.z = velocity.z.saturating_mul(WALL_TANGENT_DAMP);
            }
            if z < z_min {
                position.z = Fixed::from_micro(z_min);
                velocity.z = -velocity.z.saturating_mul(RESTITUTION);
                velocity.x = velocity.x.saturating_mul(WALL_TANGENT_DAMP);
            } else if z > z_max {
                position.z = Fixed::from_micro(z_max);
                velocity.z = -velocity.z.saturating_mul(RESTITUTION);
                velocity.x = velocity.x.saturating_mul(WALL_TANGENT_DAMP);
            }
            self.bodies.insert(
                id,
                ArenaBody {
                    position,
                    velocity,
                    ..body
                },
            );
        }
        // Narrow-pair deterministic contact: ids sorted, i < j pairs.
        let ids: Vec<u32> = self.bodies.keys().copied().collect();
        for (index, &left_id) in ids.iter().enumerate() {
            for &right_id in &ids[index + 1..] {
                self.resolve_contact(left_id, right_id)?;
            }
        }
        // Pocket goals after the contact pass.
        self.check_goal();
        Ok(())
    }

    fn resolve_contact(&mut self, left_id: u32, right_id: u32) -> Result<(), ArenaError> {
        let left = self.bodies[&left_id];
        let right = self.bodies[&right_id];
        let left_disc = Disc::new(left.position, left.radius_micros);
        let right_disc = Disc::new(right.position, right.radius_micros);
        if !left_disc.overlaps(right_disc) {
            return Ok(());
        }
        let contact = left_disc
            .contact_normal_from(right_disc)
            .unwrap_or(Vec2::from_raw(1, 0));
        let relative = Velocity::from_raw(
            right.velocity.x - left.velocity.x,
            right.velocity.z - left.velocity.z,
        );
        let approach = relative.x.saturating_mul(contact.x) + relative.z.saturating_mul(contact.z);
        if !approach.is_negative() {
            // Separating or stationary pair: positional separation only.
            self.separate(left_id, right_id);
            return Ok(());
        }
        // Equal-mass impulse along the normal, restitution-scaled.
        let impulse = approach.saturating_mul(RESTITUTION).saturating_neg();
        let left_velocity = Velocity::from_raw(
            left.velocity.x + contact.x.saturating_mul(impulse).saturating_neg(),
            left.velocity.z + contact.z.saturating_mul(impulse).saturating_neg(),
        );
        let right_velocity = Velocity::from_raw(
            right.velocity.x + contact.x.saturating_mul(impulse),
            right.velocity.z + contact.z.saturating_mul(impulse),
        );
        self.bodies.insert(
            left_id,
            ArenaBody {
                velocity: left_velocity,
                ..left
            },
        );
        self.bodies.insert(
            right_id,
            ArenaBody {
                velocity: right_velocity,
                ..right
            },
        );
        self.separate(left_id, right_id);
        Ok(())
    }

    fn separate(&mut self, left_id: u32, right_id: u32) {
        let left = self.bodies[&left_id];
        let right = self.bodies[&right_id];
        let delta = right.position - left.position;
        let length = delta.length();
        let overlap = Fixed::from_micro(left.radius_micros + right.radius_micros) - length;
        if overlap <= Fixed::zero() {
            return;
        }
        let normal = if length.is_zero() {
            // Coincident centres: deterministic tie-break by body id.
            if left_id < right_id {
                Vec2::from_raw(-1, 0)
            } else {
                Vec2::from_raw(1, 0)
            }
        } else {
            delta.saturating_div_length(length)
        };
        let push = normal.saturating_scale(overlap.saturating_div(Fixed::from_micro(2)));
        self.bodies.insert(
            left_id,
            ArenaBody {
                position: left.position.saturating_sub(push),
                ..left
            },
        );
        self.bodies.insert(
            right_id,
            ArenaBody {
                position: right.position.saturating_add(push),
                ..right
            },
        );
    }

    fn check_goal(&mut self) {
        let Some(ball) = self.ball() else {
            return;
        };
        let pocket_radius = Fixed::from_micro(self.layout.pocket_radius_micros);
        let (west_x, west_z) = self.layout.west_pocket_centre();
        let (east_x, east_z) = self.layout.east_pocket_centre();
        let radius = Fixed::from_micro(ball.radius_micros);
        let in_west =
            (ball.position - Vec2::from_micro(west_x, west_z)).length() <= pocket_radius + radius;
        let in_east =
            (ball.position - Vec2::from_micro(east_x, east_z)).length() <= pocket_radius + radius;
        // A ball in the west pocket scores for side 1 (side 0 defends west).
        if in_west {
            self.score_goal(1);
        } else if in_east {
            self.score_goal(0);
        }
    }

    fn score_goal(&mut self, side: u8) {
        if side == 0 {
            self.score.0 = self.score.0.saturating_add(1);
        } else {
            self.score.1 = self.score.1.saturating_add(1);
        }
        self.events.push(ArenaEvent::Goal { side });
        self.phase = Phase::Resolved;
        self.release_ticks = 0;
        self.aim_direction = None;
        if self.score.0 >= self.win_goals || self.score.1 >= self.win_goals {
            self.match_over = true;
            self.events
                .push(ArenaEvent::MatchOver { score: self.score });
        }
        // The ball re-centres; possession alternates for the next leg.
        let ball_id = self.ball().map(|ball| ball.id);
        if let Some(ball_id) = ball_id {
            let ball = self.bodies.get_mut(&ball_id).expect("ball exists");
            ball.position = self.layout.centre();
            ball.velocity = Velocity::zero();
        }
        self.possession = 1 - self.possession;
    }
}

fn velocity_as_vec2(velocity: Velocity) -> Vec2 {
    Vec2::from_raw(velocity.x.raw(), velocity.z.raw())
}

/// The state-hash encoding keeps the command discriminant in the first byte,
/// matching the replay fixture bytes in tests and the protocol layer.
pub(crate) fn encode_arena_command(out: &mut Vec<u8>, command: &ArenaCommand) {
    match command {
        ArenaCommand::Place {
            body,
            position,
            radius_micros,
            side,
            ball,
        } => {
            out.push(1u8);
            out.extend_from_slice(&body.to_le_bytes());
            out.extend_from_slice(&radius_micros.to_le_bytes());
            out.extend_from_slice(&position.x.raw().to_le_bytes());
            out.extend_from_slice(&position.z.raw().to_le_bytes());
            out.push(*side);
            out.push(u8::from(*ball));
        }
        ArenaCommand::Move { body, position } => {
            out.push(2u8);
            out.extend_from_slice(&body.to_le_bytes());
            out.extend_from_slice(&position.x.raw().to_le_bytes());
            out.extend_from_slice(&position.z.raw().to_le_bytes());
        }
        ArenaCommand::Remove { body } => {
            out.push(3u8);
            out.extend_from_slice(&body.to_le_bytes());
        }
        ArenaCommand::StartTurn { side } => {
            out.push(4u8);
            out.push(*side);
        }
        ArenaCommand::Aim {
            direction,
            power_milli,
        } => {
            out.push(5u8);
            out.extend_from_slice(&direction.x.raw().to_le_bytes());
            out.extend_from_slice(&direction.z.raw().to_le_bytes());
            out.extend_from_slice(&power_milli.to_le_bytes());
        }
        ArenaCommand::Release => out.push(6u8),
        ArenaCommand::Power { side, handle } => {
            out.push(7u8);
            out.push(*side);
            out.extend_from_slice(&handle.to_le_bytes());
        }
    }
}
