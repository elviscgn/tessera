//! Outside-workspace composition check (M23): a minimal crate that depends on
//! tessera-arena purely through its public API and verifies the deterministic
//! probe hash, proving the crate is consumable beyond the workspace.

use tessera_arena::{ArenaCommand, ArenaError, ArenaSimulation, Vec2};

const PINNED_PROBE_HASH: &str =
    "9d9fbb9fd3a81349eafd57bc8ff966bf82cc900efa180e5b50587a8b6ead02c3";

pub fn run_probe() -> Result<String, ArenaError> {
    let mut arena = ArenaSimulation::standard();
    arena.submit_batch(&[
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
    ])?;
    arena.advance_one_tick()?;
    arena.submit_batch(&[
        ArenaCommand::StartTurn { side: 0 },
        ArenaCommand::Aim {
            direction: Vec2::from_micro(1, 0),
            power_milli: 600,
        },
        ArenaCommand::Release,
    ])?;
    arena.advance_ticks(3)?;
    Ok(arena.state_hash_hex())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_digest_matches_the_pin() {
        assert_eq!(run_probe().expect("probe"), PINNED_PROBE_HASH);
    }
}

fn main() {
    match run_probe() {
        Ok(hash) => println!("probe hash: {hash}"),
        Err(error) => {
            eprintln!("probe failed: {error:?}");
            std::process::exit(1);
        }
    }
}