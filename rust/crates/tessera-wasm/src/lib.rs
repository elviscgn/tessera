#![forbid(unsafe_code)]

//! Coarse wasm-bindgen adapter for the browser simulation Worker.

mod arena;

pub use arena::{ARENA_WASM_ADAPTER_VERSION, ArenaWasm, MAX_ARENA_TICKS_PER_CALL};

use tessera_core::{
    Footprint, FootprintError, FootprintOffset, GridConfigurationError, GridPosition, QuarterTurn,
    SaveError, Seed, Simulation, SimulationError,
};
use tessera_protocol::{
    CommandResponse, PlacementValidationResponse, ProtocolError, RenderSnapshotDescriptor,
    decode_command_batch, encode_command_response, encode_event_batch, encode_placement_validation,
    encode_render_descriptor, encode_render_snapshot_with_occupied_cells,
};
use wasm_bindgen::prelude::*;

/// Maximum exact ticks accepted by one Worker command call in this milestone.
pub const MAX_EXACT_TICKS_PER_CALL: u32 = 5;
/// Version of the exported adapter contract.
pub const WASM_ADAPTER_VERSION: u16 = 1;

/// One authoritative simulation instance owned by a dedicated Worker.
#[wasm_bindgen]
pub struct TesseraWasm {
    simulation: Simulation,
    disposed: bool,
    render_snapshot_front: Vec<u8>,
    render_snapshot_back: Vec<u8>,
    snapshot_generation: u64,
    world_generation: u32,
    event_ack_sequence: u64,
}

#[wasm_bindgen]
impl TesseraWasm {
    /// Initializes one simulation from an exactly 32-byte seed.
    #[wasm_bindgen(constructor)]
    pub fn new(seed: &[u8]) -> Result<TesseraWasm, JsValue> {
        let seed: Seed = seed
            .try_into()
            .map_err(|_| adapter_error("startup", "invalid_seed", "seed must be 32 bytes"))?;
        Ok(Self {
            simulation: Simulation::new(seed),
            disposed: false,
            render_snapshot_front: Vec::new(),
            render_snapshot_back: Vec::new(),
            snapshot_generation: 0,
            world_generation: 1,
            event_ack_sequence: 0,
        })
    }

    /// Decodes one binary command batch, schedules it, advances bounded exact ticks, and
    /// returns a fixed-size binary response containing the canonical state hash.
    pub fn run_command_batch(
        &mut self,
        command_batch: &[u8],
        exact_ticks: u32,
    ) -> Result<Vec<u8>, JsValue> {
        self.run_command_batch_inner(command_batch, exact_ticks)
            .map_err(|message| JsValue::from_str(&message))
    }

    /// Registers one declarative object type before the first command is run.
    pub fn register_object_type(
        &mut self,
        id: &str,
        footprint_offsets: &[i32],
    ) -> Result<u32, JsValue> {
        self.register_object_type_inner(id, footprint_offsets)
            .map_err(|message| JsValue::from_str(&message))
    }

    /// Queries authoritative occupancy for a prospective placement without mutation.
    pub fn validate_placement(
        &self,
        object_type: u32,
        x: i32,
        z: i32,
        elevation_mm: i32,
        rotation: u8,
    ) -> Result<Vec<u8>, JsValue> {
        self.validate_placement_inner(object_type, x, z, elevation_mm, rotation)
            .map_err(|message| JsValue::from_str(&message))
    }

    /// Serializes the current authoritative state without mutating it.
    pub fn save_state(
        &self,
        game_id: &str,
        scenario_id: &str,
        framework_version: &str,
        protocol_version: u16,
    ) -> Result<Vec<u8>, JsValue> {
        self.save_state_inner(game_id, scenario_id, framework_version, protocol_version)
            .map_err(|message| JsValue::from_str(&message))
    }

    /// Validates a save into temporary state and swaps it atomically on success.
    pub fn load_state(
        &mut self,
        bytes: &[u8],
        game_id: &str,
        scenario_id: &str,
        framework_version: &str,
        protocol_version: u16,
    ) -> Result<(), JsValue> {
        self.load_state_inner(
            bytes,
            game_id,
            scenario_id,
            framework_version,
            protocol_version,
        )
        .map_err(|message| JsValue::from_str(&message))
    }

    /// Returns the current canonical state hash for a load response.
    pub fn state_hash(&self) -> Vec<u8> {
        self.simulation.state_hash().to_vec()
    }

    /// Returns the current reset/world generation.
    pub fn world_generation(&self) -> u32 {
        self.world_generation
    }

    /// Returns the next client sequence that will not be rejected as stale.
    pub fn next_client_sequence(&self) -> u64 {
        self.simulation.next_client_sequence().unwrap_or(0)
    }

    /// Returns the adapter contract version used by the Worker readiness message.
    pub fn adapter_version(&self) -> u16 {
        WASM_ADAPTER_VERSION
    }

    /// Builds the latest packed snapshot and returns a descriptor into Wasm memory.
    pub fn render_snapshot_descriptor(&mut self) -> Result<Vec<u8>, JsValue> {
        self.render_snapshot_descriptor_inner()
            .map_err(|message| JsValue::from_str(&message))
    }

    /// Returns ordered event records after the requested sequence.
    pub fn event_batch(&self, after_sequence: u64, max_events: u32) -> Result<Vec<u8>, JsValue> {
        self.event_batch_inner(after_sequence, max_events)
            .map_err(|message| JsValue::from_str(&message))
    }

    /// Acknowledges the highest contiguous event sequence consumed by the host.
    pub fn ack_events(&mut self, highest_contiguous: u64) -> Result<(), JsValue> {
        self.ack_events_inner(highest_contiguous)
            .map_err(|message| JsValue::from_str(&message))
    }

    /// Returns the highest event sequence currently retained by the simulation.
    pub fn latest_event_sequence(&self) -> u64 {
        self.simulation
            .events()
            .last()
            .map_or(0, |event| event.event_sequence)
    }

    /// Returns the current authoritative tick.
    pub fn tick(&self) -> u64 {
        self.simulation.tick()
    }

    /// Marks the instance closed. Disposal is idempotent.
    pub fn dispose(&mut self) {
        self.disposed = true;
        self.render_snapshot_front.clear();
        self.render_snapshot_back.clear();
    }
}

impl TesseraWasm {
    fn save_state_inner(
        &self,
        game_id: &str,
        scenario_id: &str,
        framework_version: &str,
        protocol_version: u16,
    ) -> Result<Vec<u8>, String> {
        if self.disposed {
            return Err(adapter_error_text(
                "save",
                "disposed",
                "the Wasm simulation has been disposed",
            ));
        }
        self.simulation
            .save_json(
                game_id,
                scenario_id,
                framework_version,
                protocol_version,
                self.world_generation,
            )
            .map_err(|error| save_error_text("save", error))
    }

    fn load_state_inner(
        &mut self,
        bytes: &[u8],
        game_id: &str,
        scenario_id: &str,
        framework_version: &str,
        protocol_version: u16,
    ) -> Result<(), String> {
        if self.disposed {
            return Err(adapter_error_text(
                "load",
                "disposed",
                "the Wasm simulation has been disposed",
            ));
        }
        let loaded = Simulation::load_json(
            bytes,
            game_id,
            scenario_id,
            framework_version,
            protocol_version,
        )
        .map_err(|error| save_error_text("load", error))?;
        let next_world_generation = self.world_generation.checked_add(1).ok_or_else(|| {
            adapter_error_text("load", "generation_overflow", "world generation overflowed")
        })?;
        self.simulation = loaded.simulation;
        self.world_generation = next_world_generation;
        self.event_ack_sequence = 0;
        self.render_snapshot_front.clear();
        self.render_snapshot_back.clear();
        Ok(())
    }

    fn register_object_type_inner(
        &mut self,
        id: &str,
        footprint_offsets: &[i32],
    ) -> Result<u32, String> {
        if self.disposed {
            return Err(adapter_error_text(
                "startup",
                "disposed",
                "the Wasm simulation has been disposed",
            ));
        }
        if !footprint_offsets.len().is_multiple_of(2) {
            return Err(adapter_error_text(
                "startup",
                "invalid_footprint",
                "footprint offsets must contain dx,dz pairs",
            ));
        }
        let footprint = Footprint::new(
            footprint_offsets
                .chunks_exact(2)
                .map(|pair| FootprintOffset::new(pair[0], pair[1])),
        )
        .map_err(|error| footprint_error_text("startup", error))?;
        self.simulation
            .register_object_type(id, footprint)
            .map_err(|error| grid_configuration_error_text("startup", error))
    }

    fn validate_placement_inner(
        &self,
        object_type: u32,
        x: i32,
        z: i32,
        elevation_mm: i32,
        rotation: u8,
    ) -> Result<Vec<u8>, String> {
        if self.disposed {
            return Err(adapter_error_text(
                "placement",
                "disposed",
                "the Wasm simulation has been disposed",
            ));
        }
        if rotation > 3 {
            return Err(adapter_error_text(
                "placement",
                "invalid_rotation",
                "rotation must be in the range 0..3",
            ));
        }
        let position = GridPosition::new(x, z, elevation_mm);
        let rotation = QuarterTurn::from_index(rotation);
        let result = self
            .simulation
            .validate_placement(object_type, position, rotation);
        let (valid, rejection_reason, occupied_cell_count) = match result {
            Ok(count) => (
                true,
                None,
                u32::try_from(count).map_err(|_| {
                    adapter_error_text(
                        "placement",
                        "count_overflow",
                        "footprint cell count exceeds the protocol range",
                    )
                })?,
            ),
            Err(reason) => (false, Some(reason), 0),
        };
        Ok(encode_placement_validation(PlacementValidationResponse {
            object_type,
            position,
            rotation,
            valid,
            rejection_reason,
            occupied_cell_count,
        }))
    }

    fn render_snapshot_descriptor_inner(&mut self) -> Result<Vec<u8>, String> {
        if self.disposed {
            return Err(adapter_error_text(
                "snapshot",
                "disposed",
                "the Wasm simulation has been disposed",
            ));
        }
        self.snapshot_generation = self.snapshot_generation.checked_add(1).ok_or_else(|| {
            adapter_error_text(
                "snapshot",
                "generation_overflow",
                "snapshot generation overflowed",
            )
        })?;
        let entities: Vec<_> = self.simulation.entities().collect();
        let occupied_cells: Vec<_> = self.simulation.occupied_cells().collect();
        self.render_snapshot_back = encode_render_snapshot_with_occupied_cells(
            &entities,
            &occupied_cells,
            self.simulation.tick(),
            self.world_generation,
            self.snapshot_generation,
            0,
        )
        .map_err(|error| protocol_error_text("snapshot", error))?;
        std::mem::swap(
            &mut self.render_snapshot_front,
            &mut self.render_snapshot_back,
        );
        let pointer =
            u32::try_from(self.render_snapshot_front.as_ptr() as usize).map_err(|_| {
                adapter_error_text(
                    "snapshot",
                    "pointer_overflow",
                    "snapshot pointer exceeds u32",
                )
            })?;
        let byte_length = u32::try_from(self.render_snapshot_front.len()).map_err(|_| {
            adapter_error_text("snapshot", "length_overflow", "snapshot length exceeds u32")
        })?;
        let capacity = u32::try_from(self.render_snapshot_front.capacity()).map_err(|_| {
            adapter_error_text(
                "snapshot",
                "capacity_overflow",
                "snapshot capacity exceeds u32",
            )
        })?;
        Ok(encode_render_descriptor(RenderSnapshotDescriptor {
            pointer,
            byte_length,
            capacity,
            snapshot_generation: self.snapshot_generation,
        }))
    }

    fn event_batch_inner(&self, after_sequence: u64, max_events: u32) -> Result<Vec<u8>, String> {
        if max_events > tessera_protocol::MAX_EVENT_RECORD_COUNT {
            return Err(adapter_error_text(
                "events",
                "record_count",
                "event batch record count exceeds the limit",
            ));
        }
        let events: Vec<_> = self
            .simulation
            .events()
            .iter()
            .filter(|event| event.event_sequence > after_sequence)
            .take(max_events as usize)
            .cloned()
            .collect();
        encode_event_batch(&events, self.event_ack_sequence)
            .map_err(|error| protocol_error_text("events", error))
    }

    fn ack_events_inner(&mut self, highest_contiguous: u64) -> Result<(), String> {
        if highest_contiguous < self.event_ack_sequence {
            return Err(adapter_error_text(
                "events",
                "ack_regression",
                "event acknowledgement moved backwards",
            ));
        }
        if highest_contiguous > self.latest_event_sequence() {
            return Err(adapter_error_text(
                "events",
                "ack_ahead",
                "event acknowledgement is ahead of retained events",
            ));
        }
        self.event_ack_sequence = highest_contiguous;
        Ok(())
    }

    fn run_command_batch_inner(
        &mut self,
        command_batch: &[u8],
        exact_ticks: u32,
    ) -> Result<Vec<u8>, String> {
        if self.disposed {
            return Err(adapter_error_text(
                "command",
                "disposed",
                "the Wasm simulation has been disposed",
            ));
        }
        if validate_exact_ticks(exact_ticks).is_err() {
            return Err(adapter_error_text(
                "command",
                "tick_bound_exceeded",
                "exact tick count exceeds the per-call bound",
            ));
        }
        let batch = decode_command_batch(command_batch)
            .map_err(|error| protocol_error_text("command", error))?;
        self.simulation
            .submit_batch(&batch.commands)
            .map_err(|error| simulation_error_text("command", error))?;
        self.simulation
            .advance_ticks(u64::from(exact_ticks))
            .map_err(|error| simulation_error_text("command", error))?;
        let state_hash = self.simulation.state_hash();
        let response = encode_command_response(CommandResponse {
            batch_sequence: batch.batch_sequence,
            tick: self.simulation.tick(),
            state_hash,
        });
        Ok(response)
    }
}

fn validate_exact_ticks(exact_ticks: u32) -> Result<(), ()> {
    (exact_ticks <= MAX_EXACT_TICKS_PER_CALL)
        .then_some(())
        .ok_or(())
}

fn protocol_error_text(phase: &str, error: ProtocolError) -> String {
    adapter_error_text(phase, protocol_code(error.code), &error.to_string())
}

fn save_error_text(phase: &str, error: SaveError) -> String {
    let code = match error {
        SaveError::TooLarge => "too_large",
        SaveError::InvalidJson => "invalid_json",
        SaveError::InvalidFormat => "invalid_format",
        SaveError::UnsupportedSchema(_) => "unsupported_schema",
        SaveError::ChecksumMismatch => "checksum_mismatch",
        SaveError::IdentityMismatch(_) => "identity_mismatch",
        SaveError::InvalidMetadata(_) => "invalid_metadata",
        SaveError::InvalidState(_) => "invalid_state",
    };
    format!("tessera:{phase}:{code}:{error}")
}

fn protocol_code(code: tessera_protocol::ProtocolErrorCode) -> &'static str {
    match code {
        tessera_protocol::ProtocolErrorCode::Truncated => "truncated",
        tessera_protocol::ProtocolErrorCode::InvalidMagic => "invalid_magic",
        tessera_protocol::ProtocolErrorCode::UnsupportedVersion => "unsupported_version",
        tessera_protocol::ProtocolErrorCode::InvalidTotalLength => "invalid_total_length",
        tessera_protocol::ProtocolErrorCode::InvalidRecordCount => "invalid_record_count",
        tessera_protocol::ProtocolErrorCode::InvalidRecordLength => "invalid_record_length",
        tessera_protocol::ProtocolErrorCode::UnsupportedFlags => "unsupported_flags",
        tessera_protocol::ProtocolErrorCode::UnknownOpcode => "unknown_opcode",
        tessera_protocol::ProtocolErrorCode::InvalidPayload => "invalid_payload",
        tessera_protocol::ProtocolErrorCode::InvalidArgument => "invalid_argument",
        tessera_protocol::ProtocolErrorCode::Simulation => "simulation",
        tessera_protocol::ProtocolErrorCode::InvalidEventSequence => "invalid_event_sequence",
        tessera_protocol::ProtocolErrorCode::InvalidRegion => "invalid_region",
        tessera_protocol::ProtocolErrorCode::InvalidDescriptor => "invalid_descriptor",
    }
}

fn simulation_error_text(phase: &str, error: SimulationError) -> String {
    let code = match error {
        SimulationError::TickOverflow => "tick_overflow",
        SimulationError::EventSequenceOverflow => "event_sequence_overflow",
        SimulationError::BatchTooLarge => "batch_too_large",
        SimulationError::InvariantViolation => "invariant_violation",
    };
    adapter_error_text(
        phase,
        code,
        "the authoritative simulation rejected the operation",
    )
}

fn grid_configuration_error_text(phase: &str, error: GridConfigurationError) -> String {
    let code = match error {
        GridConfigurationError::InvalidObjectType => "invalid_object_type",
        GridConfigurationError::InvalidObjectTypeId => "invalid_object_type_id",
        GridConfigurationError::DuplicateObjectTypeId => "duplicate_object_type_id",
        GridConfigurationError::ObjectTypeOrderViolation => "object_type_order",
        GridConfigurationError::WorldAlreadyStarted => "world_already_started",
    };
    adapter_error_text(
        phase,
        code,
        "object type definitions are not valid for this world",
    )
}

fn footprint_error_text(phase: &str, error: FootprintError) -> String {
    let code = match error {
        FootprintError::Empty => "empty_footprint",
        FootprintError::DuplicateCell => "duplicate_footprint_cell",
        FootprintError::ZeroDimension => "zero_footprint_dimension",
        FootprintError::TooLarge => "footprint_too_large",
        FootprintError::CoordinateOverflow => "footprint_coordinate_overflow",
    };
    adapter_error_text(phase, code, "the object footprint is invalid")
}

fn adapter_error_text(phase: &str, code: &str, message: &str) -> String {
    format!("tessera:{phase}:{code}:{message}")
}

fn adapter_error(phase: &str, code: &str, message: &str) -> JsValue {
    JsValue::from_str(&adapter_error_text(phase, code, message))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tessera_core::{Command, CommandEnvelope, GridPosition, QuarterTurn};
    use tessera_protocol::{
        CommandBatch, MAX_EVENT_RECORD_COUNT, decode_event_batch, decode_placement_validation,
        encode_command_batch,
    };

    fn batch() -> Vec<u8> {
        encode_command_batch(&CommandBatch {
            batch_sequence: 9,
            commands: vec![CommandEnvelope::new(
                1,
                Command::Spawn {
                    object_type: 1,
                    position: GridPosition::new(0, 0, 0),
                    rotation: QuarterTurn::R0,
                },
            )],
        })
        .unwrap()
    }

    #[test]
    fn native_adapter_returns_hash_response() {
        let mut adapter = TesseraWasm::new(&[7; 32]).unwrap();
        let response = adapter.run_command_batch_inner(&batch(), 1).unwrap();
        assert_eq!(response.len(), tessera_protocol::RESPONSE_LEN);
        assert_eq!(adapter.simulation.tick(), 1);
        assert_eq!(
            &response[28..60],
            [
                0x1d, 0x58, 0xe8, 0xe0, 0xcf, 0x93, 0x7e, 0x92, 0x27, 0x9a, 0x52, 0x06, 0xca, 0x3d,
                0x4e, 0x8d, 0x24, 0xb0, 0x46, 0xb9, 0x54, 0x55, 0x68, 0x69, 0x5b, 0xc2, 0x62, 0xdd,
                0x0e, 0xd4, 0x96, 0x7c,
            ]
            .as_slice()
        );
        let events = adapter
            .event_batch_inner(0, MAX_EVENT_RECORD_COUNT)
            .unwrap();
        let events = decode_event_batch(&events).unwrap();
        assert_eq!(events.first_sequence, 1);
        assert_eq!(events.last_sequence, 2);
        adapter.ack_events_inner(events.last_sequence).unwrap();
        assert_eq!(adapter.event_ack_sequence, 2);
    }

    #[test]
    fn exact_tick_bound_is_rejected_before_mutation() {
        let mut adapter = TesseraWasm::new(&[7; 32]).unwrap();
        let error = adapter
            .run_command_batch_inner(&batch(), MAX_EXACT_TICKS_PER_CALL + 1)
            .expect_err("the exact tick bound must fail before mutation");
        assert!(error.starts_with("tessera:command:tick_bound_exceeded:"));
        assert_eq!(adapter.simulation.tick(), 0);
        assert_eq!(adapter.simulation.entity_count(), 0);
    }

    #[test]
    fn malformed_batch_returns_structured_error() {
        let mut adapter = TesseraWasm::new(&[7; 32]).unwrap();
        let error = adapter
            .run_command_batch_inner(&[0; 28], 0)
            .expect_err("an invalid magic must fail before mutation");
        assert!(error.starts_with("tessera:command:invalid_magic:"));
        assert_eq!(adapter.simulation.tick(), 0);
    }

    #[test]
    fn object_type_registration_and_placement_query_stay_in_rust() {
        let mut adapter = TesseraWasm::new(&[7; 32]).unwrap();
        assert_eq!(
            adapter
                .register_object_type_inner("foundation", &[0, 0, 1, 0])
                .unwrap(),
            1
        );
        let result =
            decode_placement_validation(&adapter.validate_placement_inner(1, 2, -3, 0, 1).unwrap())
                .unwrap();
        assert!(result.valid);
        assert_eq!(result.occupied_cell_count, 2);
        assert_eq!(result.object_type, 1);
    }

    #[test]
    fn save_load_swaps_atomically_and_increments_world_generation() {
        let mut adapter = TesseraWasm::new(&[7; 32]).unwrap();
        adapter
            .register_object_type_inner("foundation", &[0, 0])
            .unwrap();
        adapter.run_command_batch_inner(&batch(), 1).unwrap();
        let saved_hash = adapter.simulation.state_hash();
        let saved = adapter
            .save_state_inner("tessera", "foundation", "0.0.0", 1)
            .unwrap();

        adapter.run_command_batch_inner(&batch(), 1).unwrap();
        let changed_hash = adapter.simulation.state_hash();
        assert_ne!(changed_hash, saved_hash);
        adapter
            .load_state_inner(&saved, "tessera", "foundation", "0.0.0", 1)
            .unwrap();
        assert_eq!(adapter.simulation.state_hash(), saved_hash);
        assert_eq!(adapter.world_generation, 2);
        assert_eq!(adapter.simulation.next_client_sequence(), Some(2));

        let before_failed_load = adapter.simulation.state_hash();
        let error = adapter
            .load_state_inner(b"{}", "tessera", "foundation", "0.0.0", 1)
            .expect_err("malformed load must fail");
        assert!(error.starts_with("tessera:load:invalid_json:"));
        assert_eq!(adapter.simulation.state_hash(), before_failed_load);
        assert_eq!(adapter.world_generation, 2);
    }
}
