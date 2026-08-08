//! Reproducible arena probe: prints the canonical hash of a fixed command
//! sequence. The JavaScript parity test pins this value to prove the native
//! and Wasm tracks agree across the adapter boundary.
//!
//! Run with: `cargo run -p tessera-arena --example arena_probe`

use tessera_arena::{ArenaCommand, ArenaSimulation, Vec2, encode_arena_command};

fn main() {
    let mut arena = ArenaSimulation::standard();
    let sequence = [
        ArenaCommand::Place {
            body: 1,
            position: Vec2::from_micro(0, 0),
            radius_micros: 37_000,
            side: 0,
            ball: true,
        },
        ArenaCommand::Place {
            body: 2,
            position: Vec2::from_micro(-100_000, 200_000),
            radius_micros: 45_000,
            side: 0,
            ball: false,
        },
    ];
    let mut bytes = Vec::new();
    for command in &sequence {
        encode_arena_command(&mut bytes, command);
    }
    println!("sequence bytes ({}): {:02x?}", bytes.len(), bytes);
    arena.submit_batch(&sequence).expect("placement");
    arena.advance_one_tick().expect("tick");

    let shot = [
        ArenaCommand::StartTurn { side: 0 },
        ArenaCommand::Aim {
            direction: Vec2::from_micro(1, 0),
            power_milli: 600,
        },
        ArenaCommand::Release,
    ];
    for command in &shot {
        encode_arena_command(&mut bytes, command);
    }
    arena.submit_batch(&shot).expect("shot");
    arena.advance_ticks(3).expect("resolve start");

    println!("probe hash: {}", arena.state_hash_hex());
}
