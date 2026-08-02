#![forbid(unsafe_code)]

//! Coarse wasm-bindgen adapter for the browser simulation Worker.

use tessera_core::{Seed, Simulation, SimulationError};
use tessera_protocol::{
    CommandResponse, ProtocolError, decode_command_batch, encode_command_response,
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

    /// Returns the current authoritative tick.
    pub fn tick(&self) -> u64 {
        self.simulation.tick()
    }

    /// Marks the instance closed. Disposal is idempotent.
    pub fn dispose(&mut self) {
        self.disposed = true;
    }
}

impl TesseraWasm {
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
    use tessera_protocol::{CommandBatch, encode_command_batch};

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
