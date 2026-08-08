//! Headless deterministic arena match — the M20 vertical slice.
//!
//! `tessera-cli arena play` runs a deterministic match (fixed shot policy,
//! fixed-point physics) and verifies the canonical hash reproduces from the
//! recorded replay log.

use std::error::Error;
use std::path::PathBuf;

use tessera_arena::{ArenaCommand, ArenaEvent, ArenaLayout, ArenaSimulation, Phase, Vec2};

pub const DEFAULT_POWER_MILLI: u16 = 800;
pub const MAX_LEG_TICKS: u64 = 3_000;

#[derive(Clone, Debug)]
pub struct ArenaPlayOptions {
    pub layout: ArenaLayout,
    pub win_goals: u32,
    pub max_turns: u32,
    pub power_milli: u16,
    pub report_output: Option<PathBuf>,
    pub replay_output: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub struct ArenaMatchReport {
    pub layout_width_micrometres: i64,
    pub layout_depth_micrometres: i64,
    pub win_goals: u32,
    pub max_turns: u32,
    pub turns_played: u32,
    pub final_tick: u64,
    pub score: (u32, u32),
    pub match_over: bool,
    pub winner: Option<u8>,
    pub goals: Vec<(u64, u8)>,
    pub state_hash_hex: String,
    pub replay_commands: usize,
    pub replay_reproduced: bool,
}

fn boxed_arena<E: std::fmt::Debug>(error: E) -> Box<dyn Error> {
    format!("{error:?}").into()
}

/// Runs a deterministic arena match and returns the report.
pub fn run_match(options: &ArenaPlayOptions) -> Result<ArenaMatchReport, Box<dyn Error>> {
    let mut arena = ArenaSimulation::new(options.layout, options.win_goals).map_err(boxed_arena)?;
    arena
        .submit_batch(&[
            ArenaCommand::Place {
                body: 1,
                position: Vec2::from_micro(0, 0),
                radius_micros: 37_000,
                side: 0,
                ball: true,
            },
            ArenaCommand::Place {
                body: 2,
                position: Vec2::from_micro(-500_000, -150_000),
                radius_micros: 45_000,
                side: 0,
                ball: false,
            },
            ArenaCommand::Place {
                body: 3,
                position: Vec2::from_micro(500_000, 150_000),
                radius_micros: 45_000,
                side: 1,
                ball: false,
            },
        ])
        .map_err(boxed_arena)?;
    arena.advance_one_tick().map_err(boxed_arena)?;

    let mut goals = Vec::new();
    let mut turn = 0u32;
    while turn < options.max_turns && !arena.is_complete() {
        let side = if turn.is_multiple_of(2) { 0 } else { 1 };
        let direction = if side == 0 {
            Vec2::from_micro(-1, 0)
        } else {
            Vec2::from_micro(1, 0)
        };
        let leg_start_tick = arena.tick();
        arena
            .submit_batch(&[
                ArenaCommand::StartTurn { side },
                ArenaCommand::Aim {
                    direction,
                    power_milli: options.power_milli,
                },
                ArenaCommand::Release,
            ])
            .map_err(boxed_arena)?;
        for _ in 0..MAX_LEG_TICKS {
            arena.advance_one_tick().map_err(boxed_arena)?;
            if arena.phase() == Phase::Resolved {
                break;
            }
        }
        record_goal(&arena.drain_events(), leg_start_tick, &mut goals);
        // Goals flip possession automatically; otherwise hand the turn over.
        if !arena.is_complete() && arena.possession() == side {
            arena
                .submit_batch(&[ArenaCommand::StartTurn { side: 1 - side }])
                .map_err(boxed_arena)?;
            arena.advance_one_tick().map_err(boxed_arena)?;
        }
        turn += 1;
    }

    let log = arena.replay_log();
    let rebuilt = ArenaSimulation::replay(options.layout, options.win_goals, &log)
        .map_err(|error| format!("replay verification failed: {error:?}"))?;
    let replay_reproduced = rebuilt.state_hash_hex() == arena.state_hash_hex();

    if let Some(path) = options.replay_output.as_ref() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let replay_json = serde_json::json!({
            "schema": "tessera.arena.replay",
            "schemaVersion": 1,
            "finalTick": log.final_tick,
            "commands": log
                .commands
                .iter()
                .map(|command| {
                    serde_json::json!({
                        "scheduledTick": command.scheduled_tick,
                        "clientSequence": command.client_sequence,
                        "batchOrder": command.batch_order,
                    })
                })
                .collect::<Vec<_>>(),
        });
        std::fs::write(
            path,
            format!("{}\n", serde_json::to_string_pretty(&replay_json)?),
        )?;
    }

    let score = arena.score();
    Ok(ArenaMatchReport {
        layout_width_micrometres: options.layout.width_micrometres,
        layout_depth_micrometres: options.layout.depth_micrometres,
        win_goals: options.win_goals,
        max_turns: options.max_turns,
        turns_played: turn,
        final_tick: arena.tick(),
        score,
        match_over: arena.is_complete(),
        winner: if arena.is_complete() {
            Some(if score.0 > score.1 { 0 } else { 1 })
        } else {
            None
        },
        goals,
        state_hash_hex: arena.state_hash_hex(),
        replay_commands: log.commands.len(),
        replay_reproduced,
    })
}

fn record_goal(events: &[ArenaEvent], leg_start_tick: u64, goals: &mut Vec<(u64, u8)>) {
    for event in events {
        if let ArenaEvent::Goal { side } = event {
            goals.push((leg_start_tick, *side));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(layout: ArenaLayout, win_goals: u32, max_turns: u32) -> ArenaPlayOptions {
        ArenaPlayOptions {
            layout,
            win_goals,
            max_turns,
            power_milli: 800,
            report_output: None,
            replay_output: None,
        }
    }

    #[test]
    fn match_is_deterministic_and_replay_verified() {
        let layout = ArenaLayout::standard();
        let first = run_match(&options(layout, 3, 12)).expect("first match");
        let second = run_match(&options(layout, 3, 12)).expect("second match");
        assert_eq!(first.state_hash_hex, second.state_hash_hex);
        assert!(first.replay_reproduced);
        assert!(first.final_tick == second.final_tick);
        assert_eq!(first.score, second.score);
    }

    #[test]
    fn match_recorded_goals_match_score_delta() {
        let report = run_match(&options(ArenaLayout::test_small(), 1, 8)).expect("match");
        let goal_count = report.goals.len() as u32;
        assert_eq!(report.score.0 + report.score.1, goal_count);
        for (tick, side) in &report.goals {
            assert!(*side <= 1);
            assert!(*tick <= report.final_tick);
        }
    }
}
