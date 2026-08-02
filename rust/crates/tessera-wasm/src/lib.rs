#![forbid(unsafe_code)]

//! Coarse wasm-bindgen adapter for the browser simulation Worker.

use tessera_core::{Seed, Simulation, SimulationError};
use tessera_protocol::{
    CommandResponse, ProtocolError, RenderSnapshotDescriptor, decode_command_batch,
    encode_command_response, encode_event_batch, encode_render_descriptor, encode_render_snapshot,
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
        self.render_snapshot_back = encode_render_snapshot(
            &entities,
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
    };
    adapter_error_text(
        phase,
        code,
        "the authoritative simulation rejected the operation",
    )
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
        CommandBatch, MAX_EVENT_RECORD_COUNT, decode_event_batch, encode_command_batch,
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
                0x24, 0xeb, 0xdf, 0xb8, 0xbf, 0x10, 0x25, 0x1c, 0x18, 0x4a, 0x2b, 0xcd, 0x57, 0xd4,
                0x8a, 0x6b, 0x7d, 0x77, 0xbe, 0x51, 0x11, 0x4f, 0xbc, 0xf7, 0x58, 0x47, 0xf7, 0x7f,
                0x32, 0xad, 0xb1, 0x04,
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
}
