//! Versioned, browser-independent JSON saves for the deterministic kernel.

use crate::command::{Command, RejectionReason, ReplayCommand};
use crate::event::{EventKind, SimulationEvent};
use crate::id::{EntityArena, EntityId, EntitySlotSnapshot};
use crate::occupancy::{Footprint, FootprintOffset, OccupancyGrid};
use crate::rng::Seed;
use crate::simulation::{DEFAULT_TICK_RATE_HZ, ScheduledCommand, Simulation, SimulationConfig};
use crate::{GridPosition, QuarterTurn};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Stable save document identifier.
pub const SAVE_FORMAT: &str = "tessera.save";
/// Version of the save DTO and migration registry.
pub const SAVE_SCHEMA_VERSION: u16 = 1;
/// Maximum accepted save bytes before JSON allocation.
pub const MAX_SAVE_BYTES: usize = 16 * 1024 * 1024;

/// Errors returned while encoding or validating a save document.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SaveError {
    /// The save exceeds the transport safety limit.
    TooLarge,
    /// The document is not valid UTF-8 JSON.
    InvalidJson,
    /// The document identifier is not recognized.
    InvalidFormat,
    /// The schema is not supported by this build.
    UnsupportedSchema(u16),
    /// The checksum does not match the canonical document body.
    ChecksumMismatch,
    /// The save identity does not match the active runtime.
    IdentityMismatch(&'static str),
    /// A persisted seed or world generation is invalid.
    InvalidMetadata(&'static str),
    /// A persisted state field or reference is invalid.
    InvalidState(&'static str),
}

impl std::fmt::Display for SaveError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLarge => formatter.write_str("save exceeds the maximum size"),
            Self::InvalidJson => formatter.write_str("save JSON is invalid"),
            Self::InvalidFormat => formatter.write_str("save format is unsupported"),
            Self::UnsupportedSchema(version) => {
                write!(formatter, "save schema version {version} is unsupported")
            }
            Self::ChecksumMismatch => formatter.write_str("save checksum is invalid"),
            Self::IdentityMismatch(label) => write!(formatter, "save {label} does not match"),
            Self::InvalidMetadata(label) => write!(formatter, "save {label} is invalid"),
            Self::InvalidState(label) => write!(formatter, "save state {label} is invalid"),
        }
    }
}

impl std::error::Error for SaveError {}

/// A validated save result that has not yet been installed into a Wasm host.
#[derive(Clone)]
pub struct LoadedSave {
    /// Rebuilt authoritative simulation state.
    pub simulation: Simulation,
    /// Source world generation recorded in the document.
    pub world_generation: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SaveDocument {
    format: String,
    schema_version: u16,
    framework_version: String,
    protocol_version: u16,
    game_id: String,
    scenario_id: String,
    seed: String,
    world_generation: u32,
    tick: u64,
    tick_rate_hz: u32,
    rng_draws: u64,
    object_types: Vec<SaveObjectType>,
    arena: Vec<SaveArenaSlot>,
    occupancy: Vec<SaveOccupancyEntry>,
    pending: Vec<SavePendingCommand>,
    seen_sequences: Vec<u64>,
    last_client_sequence: Option<u64>,
    next_event_sequence: u64,
    events: Vec<SaveEvent>,
    replay_commands: Vec<SaveReplayCommand>,
    checksum: String,
}

type DecodedObjectTypes = (
    BTreeMap<u32, Footprint>,
    BTreeMap<u32, String>,
    Option<String>,
);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SaveObjectType {
    handle: u32,
    id: Option<String>,
    footprint: Vec<SaveOffset>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SaveOffset {
    dx: i32,
    dz: i32,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SavePosition {
    x: i32,
    z: i32,
    elevation_mm: i32,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SaveEntityId {
    slot: u32,
    generation: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SaveArenaSlot {
    generation: u32,
    alive: bool,
    object_type: u32,
    position: SavePosition,
    rotation: u8,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SaveOccupancyEntry {
    position: SavePosition,
    entity: SaveEntityId,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SavePendingCommand {
    scheduled_tick: u64,
    client_sequence: u64,
    batch_order: u32,
    command: SaveCommand,
    pre_rejection: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    deny_unknown_fields,
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
enum SaveCommand {
    Spawn {
        object_type: u32,
        position: SavePosition,
        rotation: u8,
    },
    SpawnRandom {
        object_type: u32,
    },
    Move {
        entity: SaveEntityId,
        position: SavePosition,
        rotation: u8,
    },
    Remove {
        entity: SaveEntityId,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SaveReplayCommand {
    scheduled_tick: u64,
    client_sequence: u64,
    batch_order: u32,
    command: SaveCommand,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SaveEvent {
    event_sequence: u64,
    tick: u64,
    kind: SaveEventKind,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    deny_unknown_fields,
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
enum SaveEventKind {
    CommandAccepted {
        client_sequence: u64,
    },
    CommandRejected {
        client_sequence: u64,
        reason: u8,
    },
    EntitySpawned {
        client_sequence: u64,
        entity: SaveEntityId,
        object_type: u32,
        position: SavePosition,
        rotation: u8,
    },
    EntityMoved {
        client_sequence: u64,
        entity: SaveEntityId,
        position: SavePosition,
        rotation: u8,
    },
    EntityRemoved {
        client_sequence: u64,
        entity: SaveEntityId,
    },
}

impl Simulation {
    /// Serializes meaningful state and replay metadata as canonical UTF-8 JSON.
    pub fn save_json(
        &self,
        game_id: &str,
        scenario_id: &str,
        framework_version: &str,
        protocol_version: u16,
        world_generation: u32,
    ) -> Result<Vec<u8>, SaveError> {
        if world_generation == 0 {
            return Err(SaveError::InvalidMetadata("world generation"));
        }
        let mut document = SaveDocument {
            format: SAVE_FORMAT.to_owned(),
            schema_version: SAVE_SCHEMA_VERSION,
            framework_version: framework_version.to_owned(),
            protocol_version,
            game_id: game_id.to_owned(),
            scenario_id: scenario_id.to_owned(),
            seed: encode_hex(&self.config.seed()),
            world_generation,
            tick: self.tick,
            tick_rate_hz: self.config.tick_rate_hz(),
            rng_draws: self.rng.draws(),
            object_types: self
                .footprints
                .iter()
                .map(|(&handle, footprint)| SaveObjectType {
                    handle,
                    id: self.object_type_ids.get(&handle).cloned(),
                    footprint: footprint
                        .offsets()
                        .iter()
                        .map(|offset| SaveOffset {
                            dx: offset.dx,
                            dz: offset.dz,
                        })
                        .collect(),
                })
                .collect(),
            arena: self
                .entities
                .save_slots()
                .into_iter()
                .map(|slot| SaveArenaSlot {
                    generation: slot.generation,
                    alive: slot.alive,
                    object_type: slot.object_type,
                    position: save_position(slot.position),
                    rotation: slot.rotation.as_u8(),
                })
                .collect(),
            occupancy: self
                .occupancy
                .entries()
                .map(|(position, entity)| SaveOccupancyEntry {
                    position: save_position(position),
                    entity: save_entity_id(entity),
                })
                .collect(),
            pending: self.pending.iter().map(save_pending_command).collect(),
            seen_sequences: self.seen_sequences.iter().copied().collect(),
            last_client_sequence: self.last_client_sequence,
            next_event_sequence: self.next_event_sequence,
            events: self.events.iter().map(save_event).collect(),
            replay_commands: self
                .replay_commands
                .iter()
                .map(save_replay_command)
                .collect(),
            checksum: String::new(),
        };
        document.checksum = checksum_for(&document)?;
        let bytes = serde_json::to_vec(&document).map_err(|_| SaveError::InvalidJson)?;
        if bytes.len() > MAX_SAVE_BYTES {
            return Err(SaveError::TooLarge);
        }
        Ok(bytes)
    }

    /// Validates a save into temporary state; callers swap only on success.
    pub fn load_json(
        bytes: &[u8],
        expected_game_id: &str,
        expected_scenario_id: &str,
        expected_framework_version: &str,
        expected_protocol_version: u16,
    ) -> Result<LoadedSave, SaveError> {
        if bytes.len() > MAX_SAVE_BYTES {
            return Err(SaveError::TooLarge);
        }
        let document: SaveDocument =
            serde_json::from_slice(bytes).map_err(|_| SaveError::InvalidJson)?;
        if document.format != SAVE_FORMAT {
            return Err(SaveError::InvalidFormat);
        }
        let document = migrate_document(document)?;
        if document.game_id != expected_game_id {
            return Err(SaveError::IdentityMismatch("game"));
        }
        if document.scenario_id != expected_scenario_id {
            return Err(SaveError::IdentityMismatch("scenario"));
        }
        if document.framework_version != expected_framework_version {
            return Err(SaveError::IdentityMismatch("framework"));
        }
        if document.protocol_version != expected_protocol_version {
            return Err(SaveError::IdentityMismatch("protocol"));
        }
        if document.world_generation == 0 {
            return Err(SaveError::InvalidMetadata("world generation"));
        }
        if document.tick_rate_hz != DEFAULT_TICK_RATE_HZ {
            return Err(SaveError::InvalidMetadata("tick rate"));
        }
        if document.rng_draws > u64::MAX / 2 {
            return Err(SaveError::InvalidState("random stream position"));
        }
        if document.checksum != checksum_for(&document)? {
            return Err(SaveError::ChecksumMismatch);
        }

        let seed = decode_seed(&document.seed)?;
        let (footprints, object_type_ids, last_object_type_id) = decode_object_types(&document)?;
        let slots = document
            .arena
            .iter()
            .map(|slot| {
                if slot.rotation > 3 {
                    return Err(SaveError::InvalidState("entity rotation"));
                }
                Ok(EntitySlotSnapshot {
                    generation: slot.generation,
                    alive: slot.alive,
                    object_type: slot.object_type,
                    position: decode_position(slot.position),
                    rotation: QuarterTurn::from_index(slot.rotation),
                })
            })
            .collect::<Result<Vec<_>, SaveError>>()?;
        let entities = EntityArena::from_save_slots(&slots).map_err(SaveError::InvalidState)?;
        if !footprints.is_empty()
            && entities
                .iter()
                .any(|entity| !footprints.contains_key(&entity.object_type))
        {
            return Err(SaveError::InvalidState("entity object type reference"));
        }

        let mut occupancy = OccupancyGrid::new();
        for entry in &document.occupancy {
            let entity = decode_entity_id(entry.entity)?;
            if entities.get(entity).is_none() {
                return Err(SaveError::InvalidState("occupancy entity reference"));
            }
            let position = decode_position(entry.position);
            occupancy
                .occupy(entity, &[position])
                .map_err(|_| SaveError::InvalidState("occupancy entry"))?;
        }

        let mut simulation = Simulation::new(seed);
        simulation.config = SimulationConfig::new(seed);
        simulation.tick = document.tick;
        simulation.entities = entities;
        simulation.footprints = footprints;
        simulation.object_type_ids = object_type_ids;
        simulation.last_object_type_id = last_object_type_id;
        simulation.occupancy = occupancy;
        simulation.rng = crate::rng::DeterministicRng::from_state(seed, document.rng_draws);
        simulation.seen_sequences = decode_seen_sequences(&document.seen_sequences)?;
        simulation.last_client_sequence = document.last_client_sequence;
        if simulation.last_client_sequence == Some(0) {
            return Err(SaveError::InvalidState("last client sequence"));
        }
        if simulation
            .last_client_sequence
            .is_some_and(|sequence| !simulation.seen_sequences.contains(&sequence))
        {
            return Err(SaveError::InvalidState("last client sequence set"));
        }
        simulation.pending = document
            .pending
            .iter()
            .map(decode_pending_command)
            .collect::<Result<Vec<_>, SaveError>>()?;
        if simulation.pending.iter().any(|command| {
            command.scheduled_tick <= simulation.tick
                || !simulation.seen_sequences.contains(&command.client_sequence)
        }) {
            return Err(SaveError::InvalidState("pending command reference"));
        }
        simulation.events = document
            .events
            .iter()
            .map(decode_event)
            .collect::<Result<Vec<_>, SaveError>>()?;
        validate_events(
            &simulation.events,
            simulation.tick,
            document.next_event_sequence,
        )?;
        simulation.next_event_sequence = document.next_event_sequence;
        simulation.replay_commands = document
            .replay_commands
            .iter()
            .map(decode_replay_command)
            .collect::<Result<Vec<_>, SaveError>>()?;
        if simulation
            .replay_commands
            .iter()
            .any(|command| !simulation.seen_sequences.contains(&command.client_sequence))
        {
            return Err(SaveError::InvalidState("replay command reference"));
        }
        validate_replay(&simulation.replay_commands, simulation.tick)?;
        simulation
            .validate_invariants()
            .map_err(|_| SaveError::InvalidState("entity and occupancy stores diverge"))?;

        Ok(LoadedSave {
            simulation,
            world_generation: document.world_generation,
        })
    }
}

/// Applies the pure migration registry before identity or state validation.
///
/// Schema 1 is the current canonical representation, so its migration is a
/// deliberate no-op. A later schema must add an explicit transformation here;
/// unknown versions remain unsupported rather than being guessed at.
fn migrate_document(document: SaveDocument) -> Result<SaveDocument, SaveError> {
    match document.schema_version {
        SAVE_SCHEMA_VERSION => Ok(document),
        version => Err(SaveError::UnsupportedSchema(version)),
    }
}

fn checksum_for(document: &SaveDocument) -> Result<String, SaveError> {
    let mut unsigned = document.clone();
    unsigned.checksum.clear();
    let bytes = serde_json::to_vec(&unsigned).map_err(|_| SaveError::InvalidJson)?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_seed(value: &str) -> Result<Seed, SaveError> {
    if value.len() != 64 {
        return Err(SaveError::InvalidMetadata("seed"));
    }
    let mut seed = [0; 32];
    for (index, byte) in seed.iter_mut().enumerate() {
        let start = index * 2;
        *byte = u8::from_str_radix(&value[start..start + 2], 16)
            .map_err(|_| SaveError::InvalidMetadata("seed"))?;
    }
    Ok(seed)
}

fn save_position(position: GridPosition) -> SavePosition {
    SavePosition {
        x: position.x,
        z: position.z,
        elevation_mm: position.elevation_mm,
    }
}

const fn decode_position(position: SavePosition) -> GridPosition {
    GridPosition::new(position.x, position.z, position.elevation_mm)
}

const fn save_entity_id(entity: EntityId) -> SaveEntityId {
    SaveEntityId {
        slot: entity.slot(),
        generation: entity.generation(),
    }
}

fn decode_entity_id(entity: SaveEntityId) -> Result<EntityId, SaveError> {
    EntityId::new(entity.slot, entity.generation)
        .ok_or(SaveError::InvalidState("entity generation"))
}

fn valid_public_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.chars().all(|character| !character.is_control())
}

fn decode_object_types(document: &SaveDocument) -> Result<DecodedObjectTypes, SaveError> {
    let mut footprints = BTreeMap::new();
    let mut object_type_ids = BTreeMap::new();
    let mut ids = BTreeSet::new();
    let mut previous_id: Option<&str> = None;
    for object_type in &document.object_types {
        if object_type.handle == 0 || object_type.footprint.is_empty() {
            return Err(SaveError::InvalidState("object type definition"));
        }
        let footprint = Footprint::new(
            object_type
                .footprint
                .iter()
                .map(|offset| FootprintOffset::new(offset.dx, offset.dz)),
        )
        .map_err(|_| SaveError::InvalidState("object type footprint"))?;
        if footprints.insert(object_type.handle, footprint).is_some() {
            return Err(SaveError::InvalidState("duplicate object type handle"));
        }
        if let Some(id) = object_type.id.as_deref() {
            if !valid_public_id(id) || !ids.insert(id.to_owned()) {
                return Err(SaveError::InvalidState("object type identifier"));
            }
            if previous_id.is_some_and(|previous| id <= previous) {
                return Err(SaveError::InvalidState("object type identifier order"));
            }
            previous_id = Some(id);
            object_type_ids.insert(object_type.handle, id.to_owned());
        }
    }
    let last = object_type_ids.values().next_back().cloned();
    Ok((footprints, object_type_ids, last))
}

fn decode_seen_sequences(values: &[u64]) -> Result<BTreeSet<u64>, SaveError> {
    if values.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(SaveError::InvalidState("sequence set"));
    }
    Ok(values.iter().copied().collect())
}

fn save_command(command: &Command) -> SaveCommand {
    match command {
        Command::Spawn {
            object_type,
            position,
            rotation,
        } => SaveCommand::Spawn {
            object_type: *object_type,
            position: save_position(*position),
            rotation: rotation.as_u8(),
        },
        Command::SpawnRandom { object_type } => SaveCommand::SpawnRandom {
            object_type: *object_type,
        },
        Command::Move {
            entity,
            position,
            rotation,
        } => SaveCommand::Move {
            entity: save_entity_id(*entity),
            position: save_position(*position),
            rotation: rotation.as_u8(),
        },
        Command::Remove { entity } => SaveCommand::Remove {
            entity: save_entity_id(*entity),
        },
    }
}

fn decode_command(command: &SaveCommand) -> Result<Command, SaveError> {
    match command {
        SaveCommand::Spawn {
            object_type,
            position,
            rotation,
        } => Ok(Command::Spawn {
            object_type: *object_type,
            position: decode_position(*position),
            rotation: decode_rotation(*rotation)?,
        }),
        SaveCommand::SpawnRandom { object_type } => Ok(Command::SpawnRandom {
            object_type: *object_type,
        }),
        SaveCommand::Move {
            entity,
            position,
            rotation,
        } => Ok(Command::Move {
            entity: decode_entity_id(*entity)?,
            position: decode_position(*position),
            rotation: decode_rotation(*rotation)?,
        }),
        SaveCommand::Remove { entity } => Ok(Command::Remove {
            entity: decode_entity_id(*entity)?,
        }),
    }
}

fn decode_rotation(rotation: u8) -> Result<QuarterTurn, SaveError> {
    (rotation <= 3)
        .then_some(QuarterTurn::from_index(rotation))
        .ok_or(SaveError::InvalidState("rotation"))
}

fn save_pending_command(command: &ScheduledCommand) -> SavePendingCommand {
    SavePendingCommand {
        scheduled_tick: command.scheduled_tick,
        client_sequence: command.client_sequence,
        batch_order: command.batch_order,
        command: save_command(&command.command),
        pre_rejection: command.pre_rejection.map(RejectionReason::code),
    }
}

fn decode_pending_command(command: &SavePendingCommand) -> Result<ScheduledCommand, SaveError> {
    Ok(ScheduledCommand {
        scheduled_tick: command.scheduled_tick,
        client_sequence: command.client_sequence,
        batch_order: command.batch_order,
        command: decode_command(&command.command)?,
        pre_rejection: match command.pre_rejection {
            None => None,
            Some(code) => Some(
                RejectionReason::from_code(code)
                    .ok_or(SaveError::InvalidState("rejection code"))?,
            ),
        },
    })
}

fn save_replay_command(command: &ReplayCommand) -> SaveReplayCommand {
    SaveReplayCommand {
        scheduled_tick: command.scheduled_tick,
        client_sequence: command.client_sequence,
        batch_order: command.batch_order,
        command: save_command(&command.command),
    }
}

fn decode_replay_command(command: &SaveReplayCommand) -> Result<ReplayCommand, SaveError> {
    Ok(ReplayCommand {
        scheduled_tick: command.scheduled_tick,
        client_sequence: command.client_sequence,
        batch_order: command.batch_order,
        command: decode_command(&command.command)?,
    })
}

fn save_event(event: &SimulationEvent) -> SaveEvent {
    let kind = match &event.kind {
        EventKind::CommandAccepted { client_sequence } => SaveEventKind::CommandAccepted {
            client_sequence: *client_sequence,
        },
        EventKind::CommandRejected {
            client_sequence,
            reason,
        } => SaveEventKind::CommandRejected {
            client_sequence: *client_sequence,
            reason: reason.code(),
        },
        EventKind::EntitySpawned {
            client_sequence,
            entity,
            object_type,
            position,
            rotation,
        } => SaveEventKind::EntitySpawned {
            client_sequence: *client_sequence,
            entity: save_entity_id(*entity),
            object_type: *object_type,
            position: save_position(*position),
            rotation: rotation.as_u8(),
        },
        EventKind::EntityMoved {
            client_sequence,
            entity,
            position,
            rotation,
        } => SaveEventKind::EntityMoved {
            client_sequence: *client_sequence,
            entity: save_entity_id(*entity),
            position: save_position(*position),
            rotation: rotation.as_u8(),
        },
        EventKind::EntityRemoved {
            client_sequence,
            entity,
        } => SaveEventKind::EntityRemoved {
            client_sequence: *client_sequence,
            entity: save_entity_id(*entity),
        },
    };
    SaveEvent {
        event_sequence: event.event_sequence,
        tick: event.tick,
        kind,
    }
}

fn decode_event(event: &SaveEvent) -> Result<SimulationEvent, SaveError> {
    let kind = match &event.kind {
        SaveEventKind::CommandAccepted { client_sequence } => EventKind::CommandAccepted {
            client_sequence: *client_sequence,
        },
        SaveEventKind::CommandRejected {
            client_sequence,
            reason,
        } => EventKind::CommandRejected {
            client_sequence: *client_sequence,
            reason: RejectionReason::from_code(*reason)
                .ok_or(SaveError::InvalidState("event rejection code"))?,
        },
        SaveEventKind::EntitySpawned {
            client_sequence,
            entity,
            object_type,
            position,
            rotation,
        } => EventKind::EntitySpawned {
            client_sequence: *client_sequence,
            entity: decode_entity_id(*entity)?,
            object_type: *object_type,
            position: decode_position(*position),
            rotation: decode_rotation(*rotation)?,
        },
        SaveEventKind::EntityMoved {
            client_sequence,
            entity,
            position,
            rotation,
        } => EventKind::EntityMoved {
            client_sequence: *client_sequence,
            entity: decode_entity_id(*entity)?,
            position: decode_position(*position),
            rotation: decode_rotation(*rotation)?,
        },
        SaveEventKind::EntityRemoved {
            client_sequence,
            entity,
        } => EventKind::EntityRemoved {
            client_sequence: *client_sequence,
            entity: decode_entity_id(*entity)?,
        },
    };
    Ok(SimulationEvent {
        event_sequence: event.event_sequence,
        tick: event.tick,
        kind,
    })
}

fn validate_events(
    events: &[SimulationEvent],
    tick: u64,
    next_event_sequence: u64,
) -> Result<(), SaveError> {
    if events
        .windows(2)
        .any(|pair| pair[0].event_sequence >= pair[1].event_sequence)
        || events
            .iter()
            .any(|event| event.event_sequence == 0 || event.tick > tick)
    {
        return Err(SaveError::InvalidState("event sequence"));
    }
    let expected = events
        .last()
        .map_or(1, |event| event.event_sequence.checked_add(1).unwrap_or(0));
    if expected == 0 || next_event_sequence != expected {
        return Err(SaveError::InvalidState("next event sequence"));
    }
    Ok(())
}

fn validate_replay(commands: &[ReplayCommand], final_tick: u64) -> Result<(), SaveError> {
    let latest_representable_tick = final_tick.saturating_add(1);
    if commands.iter().any(|command| {
        command.scheduled_tick == 0 || command.scheduled_tick > latest_representable_tick
    }) {
        return Err(SaveError::InvalidState("replay tick"));
    }
    if commands
        .windows(2)
        .any(|pair| pair[0].scheduled_tick > pair[1].scheduled_tick)
    {
        return Err(SaveError::InvalidState("replay ordering"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{SAVE_FORMAT, SAVE_SCHEMA_VERSION, SaveError};
    use crate::{Command, CommandEnvelope, Footprint, GridPosition, QuarterTurn, Simulation};

    fn configured_simulation() -> Simulation {
        let mut simulation = Simulation::new([9; 32]);
        simulation
            .register_object_type("foundation", Footprint::single_cell())
            .expect("object type registration succeeds");
        simulation
            .submit_batch(&[CommandEnvelope::new(
                1,
                Command::Spawn {
                    object_type: 1,
                    position: GridPosition::new(2, -1, 0),
                    rotation: QuarterTurn::R0,
                },
            )])
            .expect("command schedules");
        simulation.advance_one_tick().expect("tick advances");
        simulation
    }

    #[test]
    fn save_round_trip_preserves_hash_replay_and_canonical_bytes() {
        let simulation = configured_simulation();
        let bytes = simulation
            .save_json("tessera", "foundation", "0.0.0", 1, 1)
            .expect("save encodes");
        let second_bytes = simulation
            .save_json("tessera", "foundation", "0.0.0", 1, 1)
            .expect("save remains canonical");
        assert_eq!(bytes, second_bytes);
        let text = std::str::from_utf8(&bytes).expect("save is UTF-8");
        assert!(text.contains(SAVE_FORMAT));
        assert!(text.contains(&format!("\"schemaVersion\":{SAVE_SCHEMA_VERSION}")));
        assert_eq!(
            text,
            include_str!("../../../../tests/fixtures/save-v1-foundation.json").trim()
        );

        let loaded =
            Simulation::load_json(&bytes, "tessera", "foundation", "0.0.0", 1).expect("save loads");
        assert_eq!(loaded.simulation.state_hash(), simulation.state_hash());
        assert_eq!(loaded.simulation.replay_log(), simulation.replay_log());
        assert_eq!(loaded.simulation.events(), simulation.events());
        assert_eq!(loaded.world_generation, 1);
        let replayed = Simulation::replay_with_object_types(
            [9; 32],
            &simulation.replay_log(),
            vec![("foundation".to_owned(), Footprint::single_cell())],
        )
        .expect("replay rebuilds the saved state");
        assert_eq!(replayed.state_hash(), simulation.state_hash());
    }

    #[test]
    fn corrupted_and_wrong_identity_saves_fail_closed() {
        let simulation = configured_simulation();
        let bytes = simulation
            .save_json("tessera", "foundation", "0.0.0", 1, 1)
            .expect("save encodes");
        let mut corrupted = bytes.clone();
        let marker = b"\"checksum\":\"";
        let checksum_start = corrupted
            .windows(marker.len())
            .position(|window| window == marker)
            .expect("checksum marker exists")
            + marker.len();
        corrupted[checksum_start] = if corrupted[checksum_start] == b'0' {
            b'1'
        } else {
            b'0'
        };
        assert!(matches!(
            Simulation::load_json(&corrupted, "tessera", "foundation", "0.0.0", 1),
            Err(SaveError::ChecksumMismatch)
        ));
        assert!(matches!(
            Simulation::load_json(&bytes, "other-game", "foundation", "0.0.0", 1),
            Err(SaveError::IdentityMismatch("game"))
        ));
        assert!(matches!(
            Simulation::load_json(&bytes, "tessera", "other-scenario", "0.0.0", 1),
            Err(SaveError::IdentityMismatch("scenario"))
        ));
    }

    #[test]
    fn save_round_trip_restores_the_random_cursor() {
        let mut simulation = Simulation::new([3; 32]);
        simulation
            .submit_batch(&[crate::CommandEnvelope::new(
                1,
                Command::SpawnRandom { object_type: 9 },
            )])
            .expect("random command schedules");
        simulation.advance_one_tick().expect("random tick advances");
        assert_eq!(simulation.rng_draws(), 1);

        let bytes = simulation
            .save_json("tessera", "foundation", "0.0.0", 1, 1)
            .expect("save encodes");
        let mut restored = Simulation::load_json(&bytes, "tessera", "foundation", "0.0.0", 1)
            .expect("save loads")
            .simulation;

        let next = crate::CommandEnvelope::new(2, Command::SpawnRandom { object_type: 9 });
        simulation
            .submit_batch(std::slice::from_ref(&next))
            .expect("next random command schedules");
        restored
            .submit_batch(std::slice::from_ref(&next))
            .expect("next random command schedules after load");
        simulation.advance_one_tick().expect("original advances");
        restored.advance_one_tick().expect("restored advances");

        assert_eq!(restored.rng_draws(), simulation.rng_draws());
        assert_eq!(restored.state_hash(), simulation.state_hash());
    }

    #[test]
    fn save_round_trip_preserves_a_command_waiting_for_the_next_tick() {
        let mut simulation = Simulation::new([5; 32]);
        simulation
            .submit_batch(&[CommandEnvelope::new(
                1,
                Command::Spawn {
                    object_type: 9,
                    position: GridPosition::new(4, 2, 0),
                    rotation: QuarterTurn::R0,
                },
            )])
            .expect("command schedules");
        let bytes = simulation
            .save_json("tessera", "foundation", "0.0.0", 1, 1)
            .expect("save encodes with pending work");
        let mut restored = Simulation::load_json(&bytes, "tessera", "foundation", "0.0.0", 1)
            .expect("pending save loads")
            .simulation;

        assert_eq!(restored.state_hash(), simulation.state_hash());
        simulation.advance_one_tick().expect("original advances");
        restored.advance_one_tick().expect("restored advances");
        assert_eq!(restored.state_hash(), simulation.state_hash());
        assert_eq!(restored.events(), simulation.events());
    }

    #[test]
    fn save_load_rejects_unsupported_schema_before_state_installation() {
        let simulation = configured_simulation();
        let mut bytes = simulation
            .save_json("tessera", "foundation", "0.0.0", 1, 1)
            .expect("save encodes");
        let marker = b"\"schemaVersion\":1";
        let replacement = b"\"schemaVersion\":2";
        let offset = bytes
            .windows(marker.len())
            .position(|window| window == marker)
            .expect("schema marker exists");
        bytes[offset..offset + marker.len()].copy_from_slice(replacement);
        assert!(matches!(
            Simulation::load_json(&bytes, "tessera", "foundation", "0.0.0", 1),
            Err(SaveError::UnsupportedSchema(2))
        ));
    }
}
