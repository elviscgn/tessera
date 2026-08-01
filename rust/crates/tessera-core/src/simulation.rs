//! Fixed-tick deterministic simulation and canonical state hashing.

use crate::command::{
    Command, CommandEnvelope, CommandReceipt, RejectionReason, ReplayCommand, ReplayLog,
};
use crate::event::{EventKind, SimulationEvent};
use crate::id::{EntityArena, EntityError, EntityId, EntityState};
use crate::rng::{DeterministicRng, RNG_ALGORITHM_VERSION, Seed};
use crate::{GridPosition, QuarterTurn};
use std::collections::BTreeSet;

/// Default and currently immutable tick rate for a scenario.
pub const DEFAULT_TICK_RATE_HZ: u32 = 20;
/// Version of the canonical meaningful-state encoding.
pub const STATE_HASH_VERSION: u16 = 1;
/// A canonical 32-byte BLAKE3 digest.
pub type StateHash = [u8; 32];

/// Immutable scenario settings captured at initialization.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SimulationConfig {
    seed: Seed,
    tick_rate_hz: u32,
}

impl SimulationConfig {
    /// Creates the fixed-rate configuration for a seed.
    pub const fn new(seed: Seed) -> Self {
        Self {
            seed,
            tick_rate_hz: DEFAULT_TICK_RATE_HZ,
        }
    }

    /// Returns the versioned seed.
    pub const fn seed(self) -> Seed {
        self.seed
    }

    /// Returns the immutable tick rate.
    pub const fn tick_rate_hz(self) -> u32 {
        self.tick_rate_hz
    }
}

/// Errors returned by fixed-tick advancement and command scheduling.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SimulationError {
    /// The tick counter cannot advance without wrapping.
    TickOverflow,
    /// The event sequence cannot advance without wrapping.
    EventSequenceOverflow,
    /// The submitted batch is too large for its `u32` batch-order field.
    BatchTooLarge,
}

/// Errors returned while rebuilding a simulation from replay records.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReplayError {
    /// A replay record has no valid future tick.
    InvalidScheduledTick,
    /// Replay records are not ordered by their assigned tick.
    TickOrderViolation,
    /// The final tick precedes the commands it contains.
    FinalTickTooLow,
    /// The simulation could not schedule or advance a replay command.
    Simulation(SimulationError),
}

#[derive(Clone)]
struct ScheduledCommand {
    scheduled_tick: u64,
    client_sequence: u64,
    batch_order: u32,
    command: Command,
    pre_rejection: Option<RejectionReason>,
}

/// The native deterministic kernel.
#[derive(Clone)]
pub struct Simulation {
    config: SimulationConfig,
    tick: u64,
    entities: EntityArena,
    rng: DeterministicRng,
    pending: Vec<ScheduledCommand>,
    seen_sequences: BTreeSet<u64>,
    last_client_sequence: Option<u64>,
    next_event_sequence: u64,
    events: Vec<SimulationEvent>,
    replay_commands: Vec<ReplayCommand>,
}

impl Simulation {
    /// Creates an empty simulation at tick zero.
    pub fn new(seed: Seed) -> Self {
        Self {
            config: SimulationConfig::new(seed),
            tick: 0,
            entities: EntityArena::new(),
            rng: DeterministicRng::new(seed),
            pending: Vec::new(),
            seen_sequences: BTreeSet::new(),
            last_client_sequence: None,
            next_event_sequence: 1,
            events: Vec::new(),
            replay_commands: Vec::new(),
        }
    }

    /// Returns immutable scenario configuration.
    pub const fn config(&self) -> SimulationConfig {
        self.config
    }

    /// Returns the current authoritative tick.
    pub const fn tick(&self) -> u64 {
        self.tick
    }

    /// Returns the live entity at a matching generation.
    pub fn entity(&self, id: EntityId) -> Option<EntityState> {
        self.entities.get(id)
    }

    /// Iterates live entities in deterministic slot order.
    pub fn entities(&self) -> impl Iterator<Item = EntityState> + '_ {
        self.entities.iter()
    }

    /// Returns the number of live entities.
    pub fn entity_count(&self) -> usize {
        self.entities.len()
    }

    /// Returns how many ChaCha8 words have been consumed.
    pub const fn rng_draws(&self) -> u64 {
        self.rng.draws()
    }

    /// Schedules a batch for the next unstarted tick.
    pub fn submit_batch(
        &mut self,
        commands: &[CommandEnvelope],
    ) -> Result<Vec<CommandReceipt>, SimulationError> {
        let scheduled_tick = self
            .tick
            .checked_add(1)
            .ok_or(SimulationError::TickOverflow)?;
        let mut receipts = Vec::with_capacity(commands.len());

        for (batch_order, envelope) in commands.iter().enumerate() {
            let batch_order =
                u32::try_from(batch_order).map_err(|_| SimulationError::BatchTooLarge)?;
            let sequence = envelope.client_sequence;
            let pre_rejection = if self.seen_sequences.contains(&sequence) {
                Some(RejectionReason::DuplicateSequence)
            } else if sequence == 0 {
                Some(RejectionReason::ZeroSequence)
            } else if self
                .last_client_sequence
                .is_some_and(|last| sequence < last)
            {
                Some(RejectionReason::NonMonotonicSequence)
            } else {
                self.last_client_sequence = Some(sequence);
                None
            };
            self.seen_sequences.insert(sequence);

            self.pending.push(ScheduledCommand {
                scheduled_tick,
                client_sequence: sequence,
                batch_order,
                command: envelope.command.clone(),
                pre_rejection,
            });
            self.replay_commands.push(ReplayCommand {
                scheduled_tick,
                client_sequence: sequence,
                batch_order,
                command: envelope.command.clone(),
            });
            receipts.push(CommandReceipt {
                client_sequence: sequence,
                scheduled_tick,
                batch_order,
            });
        }

        Ok(receipts)
    }

    /// Advances exactly one fixed tick and applies commands scheduled for it.
    pub fn advance_one_tick(&mut self) -> Result<(), SimulationError> {
        let next_tick = self
            .tick
            .checked_add(1)
            .ok_or(SimulationError::TickOverflow)?;
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
            self.apply_scheduled(command)?;
        }
        Ok(())
    }

    /// Advances exactly `count` fixed ticks.
    pub fn advance_ticks(&mut self, count: u64) -> Result<(), SimulationError> {
        for _ in 0..count {
            self.advance_one_tick()?;
        }
        Ok(())
    }

    /// Returns the ordered event log without clearing it.
    pub fn events(&self) -> &[SimulationEvent] {
        &self.events
    }

    /// Takes the ordered event log for a caller-owned drain.
    pub fn drain_events(&mut self) -> Vec<SimulationEvent> {
        std::mem::take(&mut self.events)
    }

    /// Returns all submitted commands and the source final tick.
    pub fn replay_log(&self) -> ReplayLog {
        ReplayLog {
            final_tick: self.tick,
            commands: self.replay_commands.clone(),
        }
    }

    /// Rebuilds a simulation from a seed and assigned-tick replay log.
    pub fn replay(seed: Seed, log: &ReplayLog) -> Result<Self, ReplayError> {
        let mut simulation = Self::new(seed);
        let mut index = 0;
        while index < log.commands.len() {
            let target_tick = log.commands[index].scheduled_tick;
            if target_tick == 0 {
                return Err(ReplayError::InvalidScheduledTick);
            }
            if target_tick <= simulation.tick {
                return Err(ReplayError::TickOrderViolation);
            }
            while simulation.tick + 1 < target_tick {
                simulation
                    .advance_one_tick()
                    .map_err(ReplayError::Simulation)?;
            }

            let start = index;
            while index < log.commands.len() && log.commands[index].scheduled_tick == target_tick {
                index += 1;
            }
            let envelopes: Vec<_> = log.commands[start..index]
                .iter()
                .map(|command| {
                    CommandEnvelope::new(command.client_sequence, command.command.clone())
                })
                .collect();
            let receipts = simulation
                .submit_batch(&envelopes)
                .map_err(ReplayError::Simulation)?;
            if receipts
                .iter()
                .any(|receipt| receipt.scheduled_tick != target_tick)
            {
                return Err(ReplayError::InvalidScheduledTick);
            }
            simulation
                .advance_one_tick()
                .map_err(ReplayError::Simulation)?;
        }

        if log.final_tick < simulation.tick {
            return Err(ReplayError::FinalTickTooLow);
        }
        simulation
            .advance_ticks(log.final_tick - simulation.tick)
            .map_err(ReplayError::Simulation)?;
        Ok(simulation)
    }

    /// Returns the canonical bytes used as the state-hash input.
    pub fn canonical_state_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"TESSERA_STATE_HASH\0");
        out.extend_from_slice(&STATE_HASH_VERSION.to_le_bytes());
        out.extend_from_slice(&self.config.tick_rate_hz.to_le_bytes());
        out.extend_from_slice(&self.config.seed);
        out.extend_from_slice(&self.tick.to_le_bytes());
        out.extend_from_slice(&RNG_ALGORITHM_VERSION.to_le_bytes());
        out.extend_from_slice(&self.rng.seed());
        out.extend_from_slice(&self.rng.draws().to_le_bytes());
        match self.last_client_sequence {
            Some(sequence) => {
                out.push(1);
                out.extend_from_slice(&sequence.to_le_bytes());
            }
            None => out.push(0),
        }
        out.extend_from_slice(&(self.seen_sequences.len() as u64).to_le_bytes());
        for sequence in &self.seen_sequences {
            out.extend_from_slice(&sequence.to_le_bytes());
        }
        out.extend_from_slice(&self.next_event_sequence.to_le_bytes());
        self.entities.encode_canonical(&mut out);

        let mut pending = self.pending.clone();
        pending.sort_by_key(|command| {
            (
                command.scheduled_tick,
                command.client_sequence,
                command.batch_order,
            )
        });
        out.extend_from_slice(&(pending.len() as u64).to_le_bytes());
        for command in pending {
            out.extend_from_slice(&command.scheduled_tick.to_le_bytes());
            out.extend_from_slice(&command.client_sequence.to_le_bytes());
            out.extend_from_slice(&command.batch_order.to_le_bytes());
            out.push(command.pre_rejection.map_or(0, RejectionReason::code));
            encode_command(&mut out, &command.command);
        }
        out
    }

    /// Hashes meaningful state using the versioned canonical encoding.
    pub fn state_hash(&self) -> StateHash {
        *blake3::hash(&self.canonical_state_bytes()).as_bytes()
    }

    /// Returns the state hash as lowercase hexadecimal.
    pub fn state_hash_hex(&self) -> String {
        blake3::Hash::from(self.state_hash()).to_hex().to_string()
    }

    fn apply_scheduled(&mut self, command: ScheduledCommand) -> Result<(), SimulationError> {
        if let Some(reason) = command.pre_rejection {
            return self.reject(command.client_sequence, reason);
        }

        match command.command {
            Command::Spawn {
                object_type,
                position,
                rotation,
            } => {
                if object_type == 0 {
                    return self
                        .reject(command.client_sequence, RejectionReason::InvalidObjectType);
                }
                let entity = match self.entities.spawn(object_type, position, rotation) {
                    Ok(entity) => entity,
                    Err(error) => {
                        return self.reject(command.client_sequence, error.rejection_reason());
                    }
                };
                self.accept(command.client_sequence)?;
                self.emit(EventKind::EntitySpawned {
                    client_sequence: command.client_sequence,
                    entity: entity.id,
                    object_type: entity.object_type,
                    position: entity.position,
                    rotation: entity.rotation,
                })
            }
            Command::SpawnRandom { object_type } => {
                if object_type == 0 {
                    return self
                        .reject(command.client_sequence, RejectionReason::InvalidObjectType);
                }
                let random = self.rng.next_u64();
                let position = GridPosition::new(
                    (random % 2049) as i32 - 1024,
                    ((random >> 16) % 2049) as i32 - 1024,
                    0,
                );
                let rotation = QuarterTurn::from_index((random >> 32) as u8);
                let entity = match self.entities.spawn(object_type, position, rotation) {
                    Ok(entity) => entity,
                    Err(error) => {
                        return self.reject(command.client_sequence, error.rejection_reason());
                    }
                };
                self.accept(command.client_sequence)?;
                self.emit(EventKind::EntitySpawned {
                    client_sequence: command.client_sequence,
                    entity: entity.id,
                    object_type: entity.object_type,
                    position: entity.position,
                    rotation: entity.rotation,
                })
            }
            Command::Move {
                entity,
                position,
                rotation,
            } => {
                let entity = match self.entities.move_entity(entity, position, rotation) {
                    Ok(entity) => entity,
                    Err(error) => {
                        return self.reject(command.client_sequence, error.rejection_reason());
                    }
                };
                self.accept(command.client_sequence)?;
                self.emit(EventKind::EntityMoved {
                    client_sequence: command.client_sequence,
                    entity: entity.id,
                    position: entity.position,
                    rotation: entity.rotation,
                })
            }
            Command::Remove { entity } => {
                let removed = match self.entities.despawn(entity) {
                    Ok(entity) => entity,
                    Err(error) => {
                        return self.reject(command.client_sequence, error.rejection_reason());
                    }
                };
                self.accept(command.client_sequence)?;
                self.emit(EventKind::EntityRemoved {
                    client_sequence: command.client_sequence,
                    entity: removed.id,
                })
            }
        }
    }

    fn accept(&mut self, client_sequence: u64) -> Result<(), SimulationError> {
        self.emit(EventKind::CommandAccepted { client_sequence })
    }

    fn reject(
        &mut self,
        client_sequence: u64,
        reason: RejectionReason,
    ) -> Result<(), SimulationError> {
        self.emit(EventKind::CommandRejected {
            client_sequence,
            reason,
        })
    }

    fn emit(&mut self, kind: EventKind) -> Result<(), SimulationError> {
        let event_sequence = self.next_event_sequence;
        self.next_event_sequence = self
            .next_event_sequence
            .checked_add(1)
            .ok_or(SimulationError::EventSequenceOverflow)?;
        self.events.push(SimulationEvent {
            event_sequence,
            tick: self.tick,
            kind,
        });
        Ok(())
    }
}

impl EntityError {
    const fn rejection_reason(self) -> RejectionReason {
        match self {
            Self::UnknownEntity => RejectionReason::UnknownEntity,
            Self::SlotExhausted | Self::GenerationExhausted => RejectionReason::GenerationExhausted,
        }
    }
}

fn encode_command(out: &mut Vec<u8>, command: &Command) {
    match command {
        Command::Spawn {
            object_type,
            position,
            rotation,
        } => {
            out.push(1);
            out.extend_from_slice(&object_type.to_le_bytes());
            encode_position(out, *position, *rotation);
        }
        Command::SpawnRandom { object_type } => {
            out.push(2);
            out.extend_from_slice(&object_type.to_le_bytes());
        }
        Command::Move {
            entity,
            position,
            rotation,
        } => {
            out.push(3);
            out.extend_from_slice(&entity.slot().to_le_bytes());
            out.extend_from_slice(&entity.generation().to_le_bytes());
            encode_position(out, *position, *rotation);
        }
        Command::Remove { entity } => {
            out.push(4);
            out.extend_from_slice(&entity.slot().to_le_bytes());
            out.extend_from_slice(&entity.generation().to_le_bytes());
        }
    }
}

fn encode_position(out: &mut Vec<u8>, position: GridPosition, rotation: QuarterTurn) {
    out.extend_from_slice(&position.x.to_le_bytes());
    out.extend_from_slice(&position.z.to_le_bytes());
    out.extend_from_slice(&position.elevation_mm.to_le_bytes());
    out.push(rotation.as_u8());
}

#[cfg(test)]
mod tests {
    use super::{ReplayError, Simulation};
    use crate::{
        Command, CommandEnvelope, EntityArena, EventKind, GridPosition, QuarterTurn,
        RejectionReason,
    };

    const SEED: [u8; 32] = [0x11; 32];

    fn spawn(sequence: u64, object_type: u32, x: i32) -> CommandEnvelope {
        CommandEnvelope::new(
            sequence,
            Command::Spawn {
                object_type,
                position: GridPosition::new(x, -x, 250),
                rotation: QuarterTurn::R1,
            },
        )
    }

    #[test]
    fn entity_generations_reject_stale_ids() {
        let mut arena = EntityArena::new();
        let first = arena
            .spawn(1, GridPosition::new(0, 0, 0), QuarterTurn::R0)
            .expect("first slot should be available");
        assert_eq!(first.id.slot(), 0);
        assert_eq!(first.id.generation(), 1);
        assert!(arena.despawn(first.id).is_ok());
        assert!(arena.get(first.id).is_none());

        let second = arena
            .spawn(2, GridPosition::new(3, 4, 5), QuarterTurn::R2)
            .expect("freed slot should be reused");
        assert_eq!(second.id.slot(), first.id.slot());
        assert_eq!(second.id.generation(), 2);
        assert_ne!(second.id, first.id);
        assert!(
            arena
                .move_entity(first.id, GridPosition::new(1, 1, 1), QuarterTurn::R0)
                .is_err()
        );
        assert_eq!(arena.len(), 1);
    }

    #[test]
    fn commands_schedule_for_the_next_tick_and_emit_deterministic_order() {
        let mut simulation = Simulation::new(SEED);
        let receipts = simulation
            .submit_batch(&[spawn(1, 7, 2), spawn(2, 8, 5)])
            .expect("batch should schedule");
        assert_eq!(simulation.tick(), 0);
        assert_eq!(receipts[0].scheduled_tick, 1);
        assert_eq!(receipts[1].scheduled_tick, 1);
        assert_eq!(receipts[0].batch_order, 0);
        assert_eq!(receipts[1].batch_order, 1);

        simulation.advance_one_tick().expect("tick should advance");
        assert_eq!(simulation.tick(), 1);
        assert_eq!(simulation.entity_count(), 2);
        assert_eq!(simulation.events().len(), 4);
        assert_eq!(simulation.events()[0].event_sequence, 1);
        assert_eq!(simulation.events()[0].tick, 1);
        assert!(matches!(
            simulation.events()[0].kind,
            EventKind::CommandAccepted { client_sequence: 1 }
        ));
        assert!(matches!(
            simulation.events()[1].kind,
            EventKind::EntitySpawned {
                client_sequence: 1,
                object_type: 7,
                ..
            }
        ));
        assert!(matches!(
            simulation.events()[2].kind,
            EventKind::CommandAccepted { client_sequence: 2 }
        ));
        assert!(matches!(
            simulation.events()[3].kind,
            EventKind::EntitySpawned {
                client_sequence: 2,
                object_type: 8,
                ..
            }
        ));
    }

    #[test]
    fn invalid_and_duplicate_sequences_are_consumed_without_mutation() {
        let mut simulation = Simulation::new(SEED);
        let commands = [
            spawn(5, 1, 0),
            spawn(5, 2, 1),
            spawn(4, 3, 2),
            spawn(0, 4, 3),
        ];
        simulation
            .submit_batch(&commands)
            .expect("invalid commands still schedule");
        simulation.advance_one_tick().expect("tick should advance");

        assert_eq!(simulation.entity_count(), 1);
        assert!(matches!(
            simulation.events()[0].kind,
            EventKind::CommandRejected {
                client_sequence: 0,
                reason: RejectionReason::ZeroSequence,
            }
        ));
        assert!(matches!(
            simulation.events()[1].kind,
            EventKind::CommandRejected {
                client_sequence: 4,
                reason: RejectionReason::NonMonotonicSequence,
            }
        ));
        assert!(matches!(
            simulation.events()[2].kind,
            EventKind::CommandAccepted { client_sequence: 5 }
        ));
        assert!(matches!(
            simulation.events()[3].kind,
            EventKind::EntitySpawned {
                client_sequence: 5,
                object_type: 1,
                ..
            }
        ));
        assert!(matches!(
            simulation.events()[4].kind,
            EventKind::CommandRejected {
                client_sequence: 5,
                reason: RejectionReason::DuplicateSequence,
            }
        ));
        assert_eq!(simulation.replay_log().commands.len(), commands.len());
        let rebuilt = Simulation::replay(SEED, &simulation.replay_log())
            .expect("replay should preserve sequence rejection semantics");
        assert_eq!(rebuilt.state_hash(), simulation.state_hash());
    }

    #[test]
    fn random_commands_are_seeded_and_reproducible() {
        let command = CommandEnvelope::new(1, Command::SpawnRandom { object_type: 9 });
        let mut first = Simulation::new(SEED);
        let mut second = Simulation::new(SEED);
        first.submit_batch(std::slice::from_ref(&command)).unwrap();
        second.submit_batch(std::slice::from_ref(&command)).unwrap();
        first.advance_one_tick().unwrap();
        second.advance_one_tick().unwrap();

        assert_eq!(first.state_hash(), second.state_hash());
        assert_eq!(first.rng_draws(), 1);
        assert_eq!(
            first.entities().next().map(|entity| entity.position),
            second.entities().next().map(|entity| entity.position)
        );

        let mut different = Simulation::new([0x22; 32]);
        different
            .submit_batch(std::slice::from_ref(&command))
            .unwrap();
        different.advance_one_tick().unwrap();
        assert_ne!(first.state_hash(), different.state_hash());
    }

    #[test]
    fn state_hash_is_canonical_and_does_not_depend_on_event_drain() {
        let command = spawn(1, 3, 6);
        let mut retained = Simulation::new(SEED);
        let mut drained = Simulation::new(SEED);
        retained
            .submit_batch(std::slice::from_ref(&command))
            .unwrap();
        drained
            .submit_batch(std::slice::from_ref(&command))
            .unwrap();
        retained.advance_one_tick().unwrap();
        drained.advance_one_tick().unwrap();
        let retained_hash = retained.state_hash();
        assert_eq!(retained_hash, drained.state_hash());
        assert_eq!(
            retained.state_hash_hex(),
            "a6181997e83e6b2bafb290da1d702e932fd61b3ff066d1c16def73c6062828b0"
        );
        assert_eq!(retained.state_hash_hex().len(), 64);
        assert_eq!(drained.drain_events().len(), 2);
        assert_eq!(retained_hash, drained.state_hash());

        drained
            .submit_batch(&[spawn(2, 4, 7)])
            .expect("second command should schedule");
        assert_ne!(retained_hash, drained.state_hash());
    }

    #[test]
    fn replay_reproduces_hash_across_idle_ticks() {
        let mut source = Simulation::new(SEED);
        source.submit_batch(&[spawn(1, 5, 0)]).unwrap();
        source.advance_one_tick().unwrap();
        source.advance_ticks(2).unwrap();
        source
            .submit_batch(&[CommandEnvelope::new(
                2,
                Command::SpawnRandom { object_type: 6 },
            )])
            .unwrap();
        source.advance_one_tick().unwrap();
        source.advance_ticks(2).unwrap();

        let log = source.replay_log();
        assert_eq!(log.final_tick, 6);
        assert_eq!(
            log.commands
                .iter()
                .map(|command| command.scheduled_tick)
                .collect::<Vec<_>>(),
            vec![1, 4]
        );
        let rebuilt = Simulation::replay(SEED, &log).expect("replay should rebuild state");
        assert_eq!(rebuilt.tick(), source.tick());
        assert_eq!(rebuilt.state_hash(), source.state_hash());
        assert_eq!(rebuilt.entity_count(), source.entity_count());
    }

    #[test]
    fn replay_rejects_out_of_order_records() {
        let log = crate::ReplayLog {
            final_tick: 2,
            commands: vec![
                crate::ReplayCommand {
                    scheduled_tick: 2,
                    client_sequence: 2,
                    batch_order: 0,
                    command: spawn(2, 1, 0).command,
                },
                crate::ReplayCommand {
                    scheduled_tick: 1,
                    client_sequence: 1,
                    batch_order: 1,
                    command: spawn(1, 1, 0).command,
                },
            ],
        };
        assert!(matches!(
            Simulation::replay(SEED, &log),
            Err(ReplayError::TickOrderViolation)
        ));
    }
}
