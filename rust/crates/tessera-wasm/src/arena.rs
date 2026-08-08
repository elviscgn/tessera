//! Coarse wasm-bindgen adapter for the arena engine track (M22 boundary).
//!
//! The Worker owns one authoritative `ArenaSimulation` behind this adapter.
//! Commands cross the boundary as semantic JSON records that Rust parses into
//! the same `ArenaCommand` values the native crate encodes, so a browser
//! session produces byte-identical hashes to a native session. The binary
//! encoding stays entirely in the Rust crate; it is not mirrored in the host.

use tessera_arena::{
    ArenaCommand, ArenaEvent, ArenaLayout, ArenaSimulation, Phase, Vec2, decode_arena_command,
};
use wasm_bindgen::prelude::*;

/// Version of the arena adapter contract.
pub const ARENA_WASM_ADAPTER_VERSION: u16 = 1;
/// Upper bound on ticks accepted from one `advance_ticks` call.
pub const MAX_ARENA_TICKS_PER_CALL: u64 = 2_048;

fn arena_error_text(context: &str, error: impl std::fmt::Debug) -> String {
    format!("arena_{context}_{error:?}")
}

fn command_json_error(context: &str, reason: impl std::fmt::Display) -> String {
    format!("arena_{context}_json_{reason}")
}

/// Reads one required numeric field from a JSON command payload as `i64`.
fn json_i64(value: &serde_json::Value, kind: &str, field: &str) -> Result<i64, String> {
    value
        .get(field)
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| command_json_error(kind, format!("missing_or_invalid_{field}")))
}

/// Reads one required integer field within a documented range.
fn json_uint(value: &serde_json::Value, kind: &str, field: &str, max: u64) -> Result<u64, String> {
    let raw = json_i64(value, kind, field)?;
    if raw < 0 || raw as u64 > max {
        return Err(command_json_error(kind, format!("{field}_out_of_range")));
    }
    Ok(raw as u64)
}

fn json_bool(value: &serde_json::Value, kind: &str, field: &str) -> Result<bool, String> {
    value
        .get(field)
        .and_then(serde_json::Value::as_bool)
        .ok_or_else(|| command_json_error(kind, format!("missing_or_invalid_{field}")))
}

/// Parses one semantic JSON arena command into the authoritative command.
///
/// The documented JSON form mirrors `ArenaCommand`; positions are micrometres
/// and are scaled into fixed point here, exactly as the native encoder does.
fn parse_arena_command(value: &serde_json::Value) -> Result<ArenaCommand, String> {
    let kind = value
        .get("kind")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| command_json_error("command", "missing_kind"))?;
    let payload = value
        .get("payload")
        .ok_or_else(|| command_json_error(kind, "missing_payload"))?;
    match kind {
        "place" => {
            let body = json_uint(payload, "place", "body", u32::MAX as u64)? as u32;
            let radius_micros = json_i64(payload, "place", "radiusMicros")?;
            let x_micros = json_i64(payload, "place", "xMicros")?;
            let z_micros = json_i64(payload, "place", "zMicros")?;
            let side = json_uint(payload, "place", "side", u8::MAX as u64)? as u8;
            let ball = json_bool(payload, "place", "ball")?;
            Ok(ArenaCommand::Place {
                body,
                position: Vec2::from_micro(x_micros, z_micros),
                radius_micros,
                side,
                ball,
            })
        }
        "move" => {
            let body = json_uint(payload, "move", "body", u32::MAX as u64)? as u32;
            let x_micros = json_i64(payload, "move", "xMicros")?;
            let z_micros = json_i64(payload, "move", "zMicros")?;
            Ok(ArenaCommand::Move {
                body,
                position: Vec2::from_micro(x_micros, z_micros),
            })
        }
        "remove" => {
            let body = json_uint(payload, "remove", "body", u32::MAX as u64)? as u32;
            Ok(ArenaCommand::Remove { body })
        }
        "startTurn" => {
            let side = json_uint(payload, "startTurn", "side", u8::MAX as u64)? as u8;
            Ok(ArenaCommand::StartTurn { side })
        }
        "aim" => {
            let direction_x_micros = json_i64(payload, "aim", "directionXMicros")?;
            let direction_z_micros = json_i64(payload, "aim", "directionZMicros")?;
            let power_milli = json_uint(payload, "aim", "powerMilli", u16::MAX as u64)? as u16;
            Ok(ArenaCommand::Aim {
                direction: Vec2::from_micro(direction_x_micros, direction_z_micros),
                power_milli,
            })
        }
        "release" => Ok(ArenaCommand::Release),
        "power" => {
            let side = json_uint(payload, "power", "side", u8::MAX as u64)? as u8;
            let handle = json_uint(payload, "power", "handle", u32::MAX as u64)? as u32;
            Ok(ArenaCommand::Power { side, handle })
        }
        other => Err(command_json_error(
            "command",
            format!("unknown_kind_{other}"),
        )),
    }
}

/// Parses a JSON array of semantic arena commands.
pub fn parse_arena_commands_json(json: &str) -> Result<Vec<ArenaCommand>, String> {
    let values: serde_json::Value = serde_json::from_str(json)
        .map_err(|error| command_json_error("command", format!("invalid_json_{error}")))?;
    let records = values
        .as_array()
        .ok_or_else(|| command_json_error("command", "expected_array"))?;
    records.iter().map(parse_arena_command).collect()
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
        self.submit_commands(commands)
    }

    /// Submits a JSON array of semantic arena commands for the next tick.
    pub fn submit_commands_json(&mut self, json: &str) -> Result<Vec<u8>, JsValue> {
        self.check_live()?;
        let commands =
            parse_arena_commands_json(json).map_err(|error| JsValue::from_str(&error))?;
        self.submit_commands(commands)
    }

    fn submit_commands(&mut self, commands: Vec<ArenaCommand>) -> Result<Vec<u8>, JsValue> {
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

#[cfg(test)]
mod tests {
    use super::parse_arena_commands_json;
    use tessera_arena::{ArenaCommand, fixed::MICROMETRE_SCALE};

    const PLACEMENT: &str = r#"[
        {"kind":"place","payload":{"body":1,"radiusMicros":37000,"xMicros":0,"zMicros":0,"side":0,"ball":true}},
        {"kind":"place","payload":{"body":2,"radiusMicros":45000,"xMicros":-100000,"zMicros":200000,"side":0,"ball":false}}
    ]"#;

    const SHOT: &str = r#"[
        {"kind":"startTurn","payload":{"side":0}},
        {"kind":"aim","payload":{"directionXMicros":1,"directionZMicros":0,"powerMilli":600}},
        {"kind":"release","payload":{}}
    ]"#;

    #[test]
    fn json_commands_parse_into_the_native_command_model() {
        let commands = parse_arena_commands_json(PLACEMENT).unwrap();
        assert_eq!(commands.len(), 2);
        match &commands[0] {
            ArenaCommand::Place {
                body,
                position,
                radius_micros,
                side,
                ball,
            } => {
                assert_eq!(*body, 1);
                assert_eq!(position.x.raw(), 0);
                assert_eq!(position.z.raw(), 0);
                assert_eq!(*radius_micros, 37_000);
                assert_eq!(*side, 0);
                assert!(*ball);
            }
            _ => panic!("expected a place command"),
        }
        match &commands[1] {
            ArenaCommand::Place { position, .. } => {
                assert_eq!(position.x.raw(), -100_000 * MICROMETRE_SCALE);
                assert_eq!(position.z.raw(), 200_000 * MICROMETRE_SCALE);
            }
            _ => panic!("expected a place command"),
        }
    }

    #[test]
    fn json_shot_sequence_parses_with_scaling_and_ranges() {
        let commands = parse_arena_commands_json(SHOT).unwrap();
        assert_eq!(commands.len(), 3);
        assert_eq!(commands[0], ArenaCommand::StartTurn { side: 0 });
        match &commands[1] {
            ArenaCommand::Aim {
                direction,
                power_milli,
            } => {
                assert_eq!(direction.x.raw(), MICROMETRE_SCALE);
                assert_eq!(direction.z.raw(), 0);
                assert_eq!(*power_milli, 600);
            }
            _ => panic!("expected an aim command"),
        }
        assert_eq!(commands[2], ArenaCommand::Release);
    }

    #[test]
    fn malformed_json_commands_are_rejected() {
        assert!(parse_arena_commands_json("{").is_err());
        assert!(parse_arena_commands_json("{}").is_err());
        assert!(parse_arena_commands_json(r#"[{"kind":"place","payload":{}}]"#).is_err());
        assert!(parse_arena_commands_json(
            r#"[{"kind":"place","payload":{"body":1,"radiusMicros":37000,"xMicros":0,"zMicros":0,"side":300,"ball":true}}]"#
        )
        .is_err());
        assert!(parse_arena_commands_json(r#"[{"kind":"extinguish","payload":{}}]"#).is_err());
    }
}
