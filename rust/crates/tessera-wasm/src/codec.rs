//! Semantic JSON codec for the browser simulation Worker (M22 boundary).
//!
//! The binary encoding stays entirely in `tessera-protocol`; the host never
//! mirrors it. Commands arrive as semantic JSON that this module parses into
//! the same `Command` values the native encoder produces, then exercises the
//! binary path internally so a browser session hash-matches a native session.
//! Outputs are decoded back from the authoritative binary responses so the
//! host receives the validated host form rather than raw bytes.

use tessera_core::{Command, CommandEnvelope, GridPosition, QuarterTurn};
use tessera_protocol::{CommandBatch, EventBatch, PlacementValidationResponse, RenderSnapshotData};

fn command_json_error(kind: &str, reason: impl std::fmt::Display) -> String {
    format!("tessera:{kind}:json:{reason}")
}

/// Reads one required signed field as `i64`.
fn json_i64(value: &serde_json::Value, kind: &str, field: &str) -> Result<i64, String> {
    value
        .get(field)
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| command_json_error(kind, format!("missing_or_invalid_{field}")))
}

/// Reads one required unsigned field within a documented range.
fn json_uint(value: &serde_json::Value, kind: &str, field: &str, max: u64) -> Result<u64, String> {
    let raw = json_i64(value, kind, field)?;
    if raw < 0 || raw as u64 > max {
        return Err(command_json_error(kind, format!("{field}_out_of_range")));
    }
    Ok(raw as u64)
}

/// Reads one required signed 32-bit field.
fn json_i32(value: &serde_json::Value, kind: &str, field: &str) -> Result<i32, String> {
    let raw = json_i64(value, kind, field)?;
    i32::try_from(raw).map_err(|_| command_json_error(kind, format!("{field}_out_of_range")))
}

fn json_i64_value(value: i64) -> serde_json::Value {
    serde_json::Number::from(value).into()
}

fn json_u64_value(value: u64) -> serde_json::Value {
    serde_json::Number::from(value).into()
}

fn parse_position(value: &serde_json::Value, kind: &str) -> Result<GridPosition, String> {
    Ok(GridPosition::new(
        json_i32(value, kind, "x")?,
        json_i32(value, kind, "z")?,
        json_i32(value, kind, "elevationMm")?,
    ))
}

fn parse_rotation(value: &serde_json::Value, kind: &str) -> Result<QuarterTurn, String> {
    let rotation = json_uint(value, kind, "rotation", 3)? as u8;
    Ok(QuarterTurn::from_index(rotation))
}

fn parse_entity(value: &serde_json::Value, kind: &str) -> Result<tessera_core::EntityId, String> {
    let slot = json_uint(value, kind, "slot", u32::MAX as u64)? as u32;
    let generation = json_uint(value, kind, "generation", u32::MAX as u64)? as u32;
    tessera_core::EntityId::new(slot, generation)
        .ok_or_else(|| command_json_error(kind, "invalid_entity"))
}

/// Parses one semantic JSON command into the authoritative command.
fn parse_command(value: &serde_json::Value) -> Result<CommandEnvelope, String> {
    let kind = value
        .get("kind")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| command_json_error("command", "missing_kind"))?;
    let payload = value
        .get("payload")
        .ok_or_else(|| command_json_error(kind, "missing_payload"))?;
    let client_sequence = json_uint(payload, kind, "clientSequence", u64::MAX)?;
    let command = match kind {
        "spawn" => Command::Spawn {
            object_type: json_uint(payload, kind, "objectType", u32::MAX as u64)? as u32,
            position: parse_position(payload, kind)?,
            rotation: parse_rotation(payload, kind)?,
        },
        "move" => Command::Move {
            entity: parse_entity(payload, kind)?,
            position: parse_position(payload, kind)?,
            rotation: parse_rotation(payload, kind)?,
        },
        "remove" => Command::Remove {
            entity: parse_entity(payload, kind)?,
        },
        other => {
            return Err(command_json_error(
                "command",
                format!("unknown_kind_{other}"),
            ));
        }
    };
    Ok(CommandEnvelope::new(client_sequence, command))
}

/// Parses one semantic JSON command batch into the authoritative batch form.
pub fn parse_command_batch_json(json: &str) -> Result<CommandBatch, String> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|error| command_json_error("command", format!("invalid_json_{error}")))?;
    let batch_sequence = json_uint(&value, "command", "batchSequence", u64::MAX)?;
    let commands = value
        .get("commands")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| command_json_error("command", "missing_commands"))?;
    let commands = commands
        .iter()
        .map(parse_command)
        .collect::<Result<_, _>>()?;
    Ok(CommandBatch {
        batch_sequence,
        commands,
    })
}

/// Parses one semantic JSON placement query.
pub fn parse_placement_json(json: &str) -> Result<(u32, GridPosition, QuarterTurn), String> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|error| command_json_error("placement", format!("invalid_json_{error}")))?;
    let object_type = json_uint(&value, "placement", "objectType", u32::MAX as u64)? as u32;
    let position = parse_position(&value, "placement")?;
    let rotation = parse_rotation(&value, "placement")?;
    Ok((object_type, position, rotation))
}

/// Serializes a validated command response.
pub fn command_response_json(batch_sequence: u64, tick: u64, state_hash: &[u8]) -> String {
    serde_json::json!({
        "batchSequence": json_u64_value(batch_sequence),
        "tick": json_u64_value(tick),
        "stateHashHex": hex(state_hash),
    })
    .to_string()
}

/// Serializes a validated placement validation response.
pub fn placement_response_json(response: &PlacementValidationResponse) -> String {
    let mut object = serde_json::Map::new();
    object.insert(
        "objectType".into(),
        json_u64_value(u64::from(response.object_type)),
    );
    object.insert("x".into(), json_i64_value(i64::from(response.position.x)));
    object.insert("z".into(), json_i64_value(i64::from(response.position.z)));
    object.insert(
        "elevationMm".into(),
        json_i64_value(i64::from(response.position.elevation_mm)),
    );
    object.insert(
        "rotation".into(),
        json_u64_value(u64::from(response.rotation.as_u8())),
    );
    object.insert("valid".into(), serde_json::Value::Bool(response.valid));
    if let Some(reason) = response.rejection_reason {
        object.insert(
            "rejectionCode".into(),
            serde_json::Number::from(reason.code()).into(),
        );
    }
    object.insert(
        "occupiedCellCount".into(),
        serde_json::Number::from(response.occupied_cell_count).into(),
    );
    serde_json::Value::Object(object).to_string()
}

/// Serializes validated render snapshot content.
pub fn render_snapshot_json(snapshot: &RenderSnapshotData) -> String {
    let regions: Vec<serde_json::Value> = snapshot
        .regions
        .iter()
        .map(|region| {
            serde_json::json!({
                "kind": region.kind as u16,
                "scalarType": region.scalar_type as u8,
                "componentCount": region.component_count,
                "flags": region.flags,
                "offset": region.offset,
                "elementCount": region.element_count,
                "byteLength": region.byte_length,
                "capacity": region.capacity,
            })
        })
        .collect();
    let entities: Vec<serde_json::Value> = snapshot
        .entities
        .iter()
        .map(|entity| {
            serde_json::json!({
                "slot": entity.slot,
                "generation": entity.generation,
                "x": entity.position.x,
                "z": entity.position.z,
                "elevationMm": entity.position.elevation_mm,
                "rotation": {
                    "x": entity.rotation[0],
                    "y": entity.rotation[1],
                    "z": entity.rotation[2],
                    "w": entity.rotation[3],
                },
                "scale": {
                    "x": entity.scale[0],
                    "y": entity.scale[1],
                    "z": entity.scale[2],
                },
                "visualType": entity.visual_type,
                "renderFlags": entity.render_flags,
            })
        })
        .collect();
    let occupied_cells: Vec<serde_json::Value> = snapshot
        .occupied_cells
        .iter()
        .map(|cell| {
            serde_json::json!({
                "x": cell.x,
                "z": cell.z,
                "elevationMm": cell.elevation_mm,
            })
        })
        .collect();
    serde_json::json!({
        "totalByteLength": snapshot.total_byte_length,
        "worldGeneration": snapshot.world_generation,
        "snapshotGeneration": json_u64_value(snapshot.snapshot_generation),
        "simulationTick": json_u64_value(snapshot.simulation_tick),
        "entityCount": snapshot.entity_count,
        "entityCapacity": snapshot.entity_capacity,
        "memoryGeneration": snapshot.memory_generation,
        "regions": regions,
        "entities": entities,
        "occupiedCells": occupied_cells,
    })
    .to_string()
}

/// Serializes validated event batch metadata.
pub fn event_batch_json(batch: &EventBatch) -> String {
    serde_json::json!({
        "firstSequence": json_u64_value(batch.first_sequence),
        "lastSequence": json_u64_value(batch.last_sequence),
        "ackFloor": json_u64_value(batch.ack_floor),
        "recordCount": batch.events.len(),
    })
    .to_string()
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tessera_core::Command;

    const BATCH: &str = r#"{
        "batchSequence": 9,
        "commands": [
            {"kind":"spawn","payload":{"clientSequence":1,"objectType":1,"x":0,"z":0,"elevationMm":0,"rotation":0}},
            {"kind":"move","payload":{"clientSequence":2,"slot":0,"generation":1,"x":5,"z":7,"elevationMm":250,"rotation":2}},
            {"kind":"remove","payload":{"clientSequence":3,"slot":0,"generation":1}}
        ]
    }"#;

    #[test]
    fn json_commands_parse_into_the_native_command_model() {
        let batch = parse_command_batch_json(BATCH).unwrap();
        assert_eq!(batch.batch_sequence, 9);
        assert_eq!(batch.commands.len(), 3);
        match &batch.commands[0].command {
            Command::Spawn {
                object_type,
                position,
                rotation,
            } => {
                assert_eq!(*object_type, 1);
                assert_eq!(position.x, 0);
                assert_eq!(position.z, 0);
                assert_eq!(*rotation, QuarterTurn::R0);
            }
            _ => panic!("expected a spawn command"),
        }
        match &batch.commands[1].command {
            Command::Move {
                entity,
                position,
                rotation,
            } => {
                assert_eq!(entity.slot(), 0);
                assert_eq!(entity.generation(), 1);
                assert_eq!(position.x, 5);
                assert_eq!(position.z, 7);
                assert_eq!(position.elevation_mm, 250);
                assert_eq!(*rotation, QuarterTurn::R2);
            }
            _ => panic!("expected a move command"),
        }
        assert_eq!(
            batch.commands[2].command,
            Command::Remove {
                entity: tessera_core::EntityId::new(0, 1).unwrap(),
            }
        );
    }

    #[test]
    fn malformed_json_commands_are_rejected() {
        assert!(parse_command_batch_json("{").is_err());
        assert!(parse_command_batch_json("{}").is_err());
        assert!(
            parse_command_batch_json(
                r#"{"batchSequence":1,"commands":[{"kind":"spawn","payload":{}}]}"#
            )
            .is_err()
        );
        assert!(
            parse_command_batch_json(
                r#"{"batchSequence":1,"commands":[{"kind":"extinguish","payload":{}}]}"#
            )
            .is_err()
        );
        assert!(parse_command_batch_json(
            r#"{"batchSequence":1,"commands":[{"kind":"move","payload":{"clientSequence":1,"slot":0,"generation":0,"x":0,"z":0,"elevationMm":0,"rotation":0}}]}"#
        )
        .is_err());
    }

    #[test]
    fn placement_json_parses_with_ranges() {
        assert_eq!(
            parse_placement_json(r#"{"objectType":3,"x":-2,"z":4,"elevationMm":100,"rotation":1}"#)
                .unwrap(),
            (3, GridPosition::new(-2, 4, 100), QuarterTurn::R1)
        );
        assert!(
            parse_placement_json(r#"{"objectType":3,"x":-2,"z":4,"elevationMm":100,"rotation":7}"#)
                .is_err()
        );
    }

    #[test]
    fn response_json_emits_stable_fields() {
        let command = command_response_json(9, 20, &[0xabu8; 32]);
        let value: serde_json::Value = serde_json::from_str(&command).unwrap();
        assert_eq!(value["batchSequence"], 9);
        assert_eq!(value["tick"], 20);
        assert_eq!(
            value["stateHashHex"].as_str().unwrap(),
            "abababababababababababababababababababababababababababababababab"
        );

        let placement = placement_response_json(&PlacementValidationResponse {
            object_type: 1,
            position: GridPosition::new(-2, 3, 250),
            rotation: QuarterTurn::R1,
            valid: false,
            rejection_reason: Some(tessera_core::RejectionReason::UnknownEntity),
            occupied_cell_count: 0,
        });
        let value: serde_json::Value = serde_json::from_str(&placement).unwrap();
        assert_eq!(value["objectType"], 1);
        assert_eq!(value["x"], -2);
        assert_eq!(value["z"], 3);
        assert_eq!(value["rejectionCode"], 5);
        assert_eq!(value["valid"], false);
    }
}
