//! Coarse wasm-bindgen adapter for the arena engine track (M22 boundary).
//!
//! The Worker owns one authoritative `ArenaSimulation` behind this adapter.
//! Commands cross the boundary as the same deterministic byte encoding the
//! native crate uses (`encode_arena_command`/`decode_arena_command`), so a
//! browser session produces byte-identical hashes to a native session.

use tessera_arena::{ArenaEvent, ArenaLayout, ArenaSimulation, Phase, decode_arena_command};
use wasm_bindgen::prelude::*;

/// Version of the arena adapter contract.
pub const ARENA_WASM_ADAPTER_VERSION: u16 = 1;
/// Upper bound on ticks accepted from one `advance_ticks` call.
pub const MAX_ARENA_TICKS_PER_CALL: u64 = 2_048;

fn arena_error_text(context: &str, error: impl std::fmt::Debug) -> String {
    format!("arena_{context}_{error:?}")
}

fn arena_event_json(event: &ArenaEvent) -> serde_json::Value {
    match event {
        ArenaEvent::Placed { body, side, ball } => {
            serde_json::json!({ "kind": "placed", "body": body, "side": side, "ball": ball })
        }
        ArenaEvent::Moved { body } => serde_json::json!({ "kind": "moved", "body": body }),
        ArenaEvent::Removed { body } => serde_json::json!({ "kind": "removed", "body": body }),
        ArenaEvent::TurnStarted { side } => {
            serde_json::json!({ "kind": "turn_started", "side": side })
        }
        ArenaEvent::Aimed { power_milli } => {
            serde_json::json!({ "kind": "aimed", "power_milli": power_milli })
        }
        ArenaEvent::Released => serde_json::json!({ "kind": "released" }),
        ArenaEvent::Goal { side } => serde_json::json!({ "kind": "goal", "side": side }),
        ArenaEvent::MatchOver { score } => {
            serde_json::json!({ "kind": "match_over", "score": [score.0, score.1] })
        }
        ArenaEvent::PowerOn { side, handle } => {
            serde_json::json!({ "kind": "power_on", "side": side, "handle": handle })
        }
        ArenaEvent::Rejected { reason } => {
            serde_json::json!({ "kind": "rejected", "reason": format!("{reason:?}") })
        }
    }
}

/// One authoritative arena simulation instance owned by a dedicated Worker.
#[wasm_bindgen]
pub struct ArenaWasm {
    arena: ArenaSimulation,
    disposed: bool,
}

#[wasm_bindgen]
impl ArenaWasm {
    /// Creates an arena with the standard layout and a win target.
    #[wasm_bindgen(constructor)]
    pub fn new(win_goals: u32) -> Result<ArenaWasm, JsValue> {
        Ok(Self {
            arena: ArenaSimulation::new(ArenaLayout::standard(), win_goals)
                .map_err(|error| arena_error_text("new", error))?,
            disposed: false,
        })
    }

    /// Creates an arena from explicit layout dimensions (millimetres).
    #[wasm_bindgen]
    pub fn new_with_layout(
        width_mm: u32,
        depth_mm: u32,
        wall_mm: u32,
        pocket_radius_mm: u32,
        win_goals: u32,
    ) -> Result<ArenaWasm, JsValue> {
        let layout = ArenaLayout {
            width_micrometres: i64::from(width_mm) * 1_000,
            depth_micrometres: i64::from(depth_mm) * 1_000,
            wall_thickness_micros: i64::from(wall_mm) * 1_000,
            pocket_radius_micros: i64::from(pocket_radius_mm) * 1_000,
        };
        Ok(Self {
            arena: ArenaSimulation::new(layout, win_goals)
                .map_err(|error| arena_error_text("new", error))?,
            disposed: false,
        })
    }

    /// Submits a batch of encoded arena commands for the next tick.
    pub fn submit_command_batch(&mut self, bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
        self.check_live()?;
        let mut commands = Vec::new();
        let mut offset = 0;
        while offset < bytes.len() {
            let (command, next) = decode_arena_command(&bytes[offset..])
                .map_err(|error| JsValue::from_str(&arena_error_text("submit", error)))?;
            commands.push(command);
            offset += next;
        }
        let sequences = self
            .arena
            .submit_batch(&commands)
            .map_err(|error| JsValue::from_str(&arena_error_text("submit", error)))?;
        let mut out = Vec::with_capacity(sequences.len() * 8);
        for sequence in sequences {
            out.extend_from_slice(&sequence.to_le_bytes());
        }
        Ok(out)
    }

    /// Advances exactly one tick.
    pub fn advance_one_tick(&mut self) -> Result<(), JsValue> {
        self.check_live()?;
        self.arena
            .advance_one_tick()
            .map_err(|error| JsValue::from_str(&arena_error_text("advance", error)))
    }

    /// Advances up to `MAX_ARENA_TICKS_PER_CALL` ticks.
    pub fn advance_ticks(&mut self, count: u64) -> Result<(), JsValue> {
        self.check_live()?;
        if count > MAX_ARENA_TICKS_PER_CALL {
            return Err(JsValue::from_str(&format!(
                "arena_advance_batch_too_large_{count}"
            )));
        }
        self.arena
            .advance_ticks(count)
            .map_err(|error| JsValue::from_str(&arena_error_text("advance", error)))
    }

    /// The canonical 64-character state hash.
    pub fn state_hash_hex(&self) -> String {
        self.arena.state_hash_hex()
    }

    /// The current tick.
    pub fn tick(&self) -> u64 {
        self.arena.tick()
    }

    /// The current phase discriminant (0..3).
    pub fn phase(&self) -> u8 {
        match self.arena.phase() {
            Phase::Setup => 0,
            Phase::Aiming => 1,
            Phase::Releasing => 2,
            Phase::Resolved => 3,
        }
    }

    /// The side in possession.
    pub fn possession(&self) -> u8 {
        self.arena.possession()
    }

    /// The score as `[side0, side1]`.
    pub fn score(&self) -> Vec<u32> {
        let score = self.arena.score();
        vec![score.0, score.1]
    }

    /// Whether the match is over.
    pub fn is_complete(&self) -> bool {
        self.arena.is_complete()
    }

    /// Serializes the live bodies and match status as JSON.
    pub fn state_snapshot(&self) -> String {
        let arena = &self.arena;
        let bodies: Vec<serde_json::Value> = arena
            .bodies()
            .map(|body| {
                serde_json::json!({
                    "id": body.id,
                    "side": body.side,
                    "ball": body.is_ball,
                    "radius_micros": body.radius_micros,
                    "x_micros": body.position.x.to_micro_floor(),
                    "z_micros": body.position.z.to_micro_floor(),
                    "vx_micros_per_tick": body.velocity.x.to_micro_floor(),
                    "vz_micros_per_tick": body.velocity.z.to_micro_floor(),
                })
            })
            .collect();
        let score = arena.score();
        serde_json::json!({
            "tick": arena.tick(),
            "phase": format!("{:?}", arena.phase()),
            "possession": arena.possession(),
            "score": [score.0, score.1],
            "match_over": arena.is_complete(),
            "state_hash_hex": arena.state_hash_hex(),
            "bodies": bodies,
        })
        .to_string()
    }

    /// Serializes and clears the event log.
    pub fn drain_events(&mut self) -> String {
        let events: Vec<serde_json::Value> = self
            .arena
            .drain_events()
            .iter()
            .map(arena_event_json)
            .collect();
        serde_json::json!(events).to_string()
    }

    /// Checks a prospective placement without mutating state.
    pub fn validate_placement(&self, radius_micros: i64, x_micros: i64, z_micros: i64) -> bool {
        self.arena
            .validate_placement(
                radius_micros,
                tessera_arena::Vec2::from_micro(x_micros, z_micros),
            )
            .is_ok()
    }

    /// Marks the instance closed. Disposal is idempotent.
    pub fn dispose(&mut self) {
        self.disposed = true;
    }

    fn check_live(&self) -> Result<(), JsValue> {
        if self.disposed {
            return Err(JsValue::from_str("arena_adapter_disposed"));
        }
        Ok(())
    }
}
