//! Engine-track arena behavior tests: phases, turns, physics determinism,
//! goals, power plays, replay parity, and canonical hash stability.

use tessera_arena::{
    ArenaCommand, ArenaError, ArenaEvent, ArenaLayout, ArenaSimulation, Fixed, POWER_DOUBLE_SHOT,
    Phase, REST_SPEED, ReplayCommand, ReplayLog, Vec2, Velocity,
};

fn standard() -> ArenaSimulation {
    ArenaSimulation::standard()
}

fn with_ball_and_striker(arena: &mut ArenaSimulation) -> (u32, u32) {
    let ball = 1;
    let striker = 2;
    arena
        .submit_batch(&[
            ArenaCommand::Place {
                body: ball,
                position: Vec2::from_micro(0, 0),
                radius_micros: 37_000,
                side: 0,
                ball: true,
            },
            ArenaCommand::Place {
                body: striker,
                position: Vec2::from_micro(-100_000, 200_000),
                radius_micros: 45_000,
                side: 0,
                ball: false,
            },
        ])
        .expect("placement should schedule");
    arena.advance_one_tick().expect("tick should advance");
    (ball, striker)
}

fn resolve_leg(arena: &mut ArenaSimulation) {
    for _ in 0..2_000 {
        if arena.phase() == Phase::Resolved {
            return;
        }
        arena.advance_one_tick().expect("tick should advance");
    }
    panic!("leg did not resolve within 2000 ticks");
}

fn shoot(arena: &mut ArenaSimulation, side: u8, direction: Vec2, power_milli: u16) {
    arena
        .submit_batch(&[
            ArenaCommand::StartTurn { side },
            ArenaCommand::Aim {
                direction,
                power_milli,
            },
            ArenaCommand::Release,
        ])
        .expect("shot commands should schedule");
}

#[test]
fn setup_placements_enforce_bounds_and_duplicates() {
    let mut arena = standard();
    let ball = with_ball_and_striker(&mut arena).0;
    assert_eq!(arena.phase(), Phase::Setup);
    assert_eq!(arena.body_count(), 2);
    assert!(arena.ball().is_some());

    // Aim without a turn is rejected in the Setup phase.
    arena
        .submit_batch(&[ArenaCommand::Aim {
            direction: Vec2::from_micro(1, 0),
            power_milli: 500,
        }])
        .expect("schedules");
    arena.advance_one_tick().expect("tick");
    assert!(matches!(
        arena.events().last(),
        Some(ArenaEvent::Rejected {
            reason: ArenaError::InvalidPhase
        })
    ));

    // A second ball is rejected.
    arena
        .submit_batch(&[ArenaCommand::Place {
            body: 7,
            position: Vec2::from_micro(0, 100_000),
            radius_micros: 37_000,
            side: 1,
            ball: true,
        }])
        .expect("schedules");
    arena.advance_one_tick().expect("tick");
    assert!(matches!(
        arena.events().last(),
        Some(ArenaEvent::Rejected {
            reason: ArenaError::UnknownBody
        })
    ));

    // An out-of-bounds placement is rejected.
    arena
        .submit_batch(&[ArenaCommand::Place {
            body: 7,
            position: Vec2::from_micro(5_000_000, 0),
            radius_micros: 37_000,
            side: 1,
            ball: false,
        }])
        .expect("schedules");
    arena.advance_one_tick().expect("tick");
    assert!(matches!(
        arena.events().last(),
        Some(ArenaEvent::Rejected {
            reason: ArenaError::OutOfBounds
        })
    ));

    // A striker inside bounds is accepted, and guard methods agree.
    arena
        .submit_batch(&[ArenaCommand::Place {
            body: 7,
            position: Vec2::from_micro(-400_000, -400_000),
            radius_micros: 45_000,
            side: 1,
            ball: false,
        }])
        .expect("schedules");
    arena.advance_one_tick().expect("tick");
    assert!(matches!(
        arena.events().last(),
        Some(ArenaEvent::Placed {
            body: 7,
            side: 1,
            ball: false
        })
    ));
    assert!(matches!(
        arena.validate_placement(45_000, Vec2::from_micro(5_000_000, 0)),
        Err(ArenaError::OutOfBounds)
    ));
    assert!(
        arena
            .validate_placement(45_000, Vec2::from_micro(0, 0))
            .is_ok()
    );

    // Move works in Setup.
    arena
        .submit_batch(&[ArenaCommand::Move {
            body: ball,
            position: Vec2::from_micro(10_000, 10_000),
        }])
        .expect("schedules");
    arena.advance_one_tick().expect("tick");
    assert!(matches!(
        arena.events().last(),
        Some(ArenaEvent::Moved { body: 1 })
    ));
}

#[test]
fn shot_releases_resolves_and_rests() {
    let mut arena = standard();
    with_ball_and_striker(&mut arena);
    shoot(&mut arena, 0, Vec2::from_micro(1, 0), 500);
    arena.advance_one_tick().expect("tick");
    assert!(matches!(
        arena
            .events()
            .iter()
            .find(|event| matches!(event, ArenaEvent::Released)),
        Some(ArenaEvent::Released)
    ));
    assert_eq!(arena.phase(), Phase::Releasing);
    resolve_leg(&mut arena);
    assert_eq!(
        arena.phase(),
        Phase::Resolved,
        "leg must resolve to Resolved"
    );
    assert!(
        arena.ball().expect("ball").velocity.at_rest(REST_SPEED),
        "ball must rest when the leg ends on speed, and the timeout leg must end"
    );
}

#[test]
fn walls_bounce_and_keep_bodies_inbounds() {
    let mut arena = standard();
    with_ball_and_striker(&mut arena);
    shoot(&mut arena, 0, Vec2::from_micro(0, 1), 1000);
    let mut touched_wall = false;
    for _ in 0..2_000 {
        arena.advance_one_tick().expect("tick");
        let ball = arena.ball().expect("ball");
        let z = ball.position.z.to_micro_floor();
        if z <= -510_000 || z >= 510_000 {
            touched_wall = true;
        }
        if arena.phase() == Phase::Resolved {
            break;
        }
    }
    assert!(arena.is_complete() || arena.phase() == Phase::Resolved);
    let ball = arena.ball().expect("ball");
    assert!(
        ball.position.z.to_micro_floor().abs() <= 535_000,
        "a north shot must be stopped by the wall before the pocket band"
    );
    assert!(touched_wall, "a full-power shot must reach the wall");
}

#[test]
fn collision_response_is_deterministic_across_runs() {
    let first = run_contact_scene();
    let second = run_contact_scene();
    assert_eq!(first.0, second.0, "positions must match across runs");
    assert_eq!(first.1, second.1, "velocities must match across runs");
}

fn run_contact_scene() -> (Vec2, Velocity) {
    let mut arena = ArenaSimulation::standard();
    arena
        .submit_batch(&[
            ArenaCommand::Place {
                body: 1,
                position: Vec2::from_micro(0, 0),
                radius_micros: 45_000,
                side: 0,
                ball: false,
            },
            ArenaCommand::Place {
                body: 2,
                position: Vec2::from_micro(100_000, 0),
                radius_micros: 45_000,
                side: 1,
                ball: false,
            },
        ])
        .expect("placement");
    arena.advance_one_tick().expect("tick");
    // Overlap the pair through Motion, then step physics.
    arena
        .submit_batch(&[ArenaCommand::Move {
            body: 1,
            position: Vec2::from_micro(30_000, 0),
        }])
        .expect("move");
    arena.advance_ticks(2).expect("resolve");
    let body = arena.body(2).expect("body 2");
    (body.position, body.velocity)
}

#[test]
fn goal_in_west_pocket_scores_for_side_one() {
    let mut arena = standard();
    let (ball, _) = with_ball_and_striker(&mut arena);
    arena
        .submit_batch(&[ArenaCommand::Move {
            body: ball,
            position: Vec2::from_micro(-380_000, 0),
        }])
        .expect("move");
    arena.advance_one_tick().expect("tick");
    shoot(&mut arena, 0, Vec2::from_micro(-1, 0), 500);
    let mut scored = false;
    for _ in 0..2_000 {
        arena.advance_one_tick().expect("tick");
        if arena
            .events()
            .iter()
            .any(|event| matches!(event, ArenaEvent::Goal { side: 1 }))
        {
            scored = true;
            break;
        }
    }
    assert!(scored, "west pocket must score for side 1");
    assert_eq!(arena.score(), (0, 1));
    assert!(arena.is_complete() || arena.phase() == Phase::Resolved);
}

#[test]
fn power_play_doubles_the_next_shot() {
    let mut arena = standard();
    with_ball_and_striker(&mut arena);
    shoot(&mut arena, 0, Vec2::from_micro(1, 0), 500);
    resolve_leg(&mut arena);
    assert_eq!(arena.phase(), Phase::Resolved);
    // Next leg: activate the double-shot power for side 1, then shoot.
    arena
        .submit_batch(&[
            ArenaCommand::StartTurn { side: 1 },
            ArenaCommand::Power {
                side: 1,
                handle: POWER_DOUBLE_SHOT,
            },
            ArenaCommand::Aim {
                direction: Vec2::from_micro(0, -1),
                power_milli: 500,
            },
            ArenaCommand::Release,
        ])
        .expect("power leg");
    // Advance past physics within the same tick the leg starts, so the
    // velocity the player imparts is (still) the pre-friction max.
    arena.advance_ticks(2).expect("apply");
    assert!(
        arena
            .events()
            .iter()
            .any(|event| matches!(event, ArenaEvent::PowerOn { side: 1, .. })),
        "power on expected"
    );
    let speed = arena.ball().expect("ball").velocity.speed();
    assert!(speed > Fixed::from_micro(200_000), "boosted speed expected");
    assert!(speed > Fixed::zero(), "ball must be moving");
}

#[test]
fn replay_reproduces_identical_hashes_and_state() {
    let mut source = ArenaSimulation::new(ArenaLayout::test_small(), 3).expect("valid arena");
    with_ball_and_striker(&mut source);
    shoot(&mut source, 0, Vec2::from_micro(-1, 0), 700);
    let mut goal_found = false;
    for _ in 0..2_000 {
        source.advance_one_tick().expect("tick");
        if source
            .events()
            .iter()
            .any(|event| matches!(event, ArenaEvent::Goal { .. }))
        {
            goal_found = true;
            break;
        }
    }
    assert!(goal_found, "replay fixture should contain a goal");
    source.advance_ticks(5).expect("idle");

    let log = source.replay_log();
    let rebuilt =
        ArenaSimulation::replay(ArenaLayout::test_small(), 3, &log).expect("replay must rebuild");
    assert_eq!(rebuilt.tick(), source.tick());
    assert_eq!(rebuilt.state_hash(), source.state_hash());
    assert_eq!(rebuilt.state_hash_hex(), source.state_hash_hex());
    assert_eq!(rebuilt.score(), source.score());
    assert_eq!(rebuilt.body_count(), source.body_count());
    assert_eq!(rebuilt.phase(), source.phase());
}

#[test]
fn replay_rejects_out_of_order_records() {
    let log = ReplayLog {
        final_tick: 2,
        commands: vec![
            ReplayCommand {
                scheduled_tick: 2,
                client_sequence: 2,
                batch_order: 0,
                command: ArenaCommand::Remove { body: 1 },
            },
            ReplayCommand {
                scheduled_tick: 1,
                client_sequence: 1,
                batch_order: 0,
                command: ArenaCommand::Remove { body: 1 },
            },
        ],
    };
    assert!(matches!(
        ArenaSimulation::replay(ArenaLayout::test_small(), 3, &log),
        Err(ArenaError::TickOrderViolation)
    ));
}

#[test]
fn canonical_hash_is_deterministic_across_rebuilds() {
    let mut arena = standard();
    with_ball_and_striker(&mut arena);
    arena
        .submit_batch(&[ArenaCommand::Move {
            body: 1,
            position: Vec2::from_micro(10_000, 10_000),
        }])
        .unwrap();
    arena.advance_one_tick().unwrap();
    let mut twin = ArenaSimulation::standard();
    with_ball_and_striker(&mut twin);
    twin.submit_batch(&[ArenaCommand::Move {
        body: 1,
        position: Vec2::from_micro(10_000, 10_000),
    }])
    .unwrap();
    twin.advance_one_tick().unwrap();
    assert_eq!(twin.state_hash_hex(), arena.state_hash_hex());
    let hash = arena.state_hash_hex();
    assert_eq!(hash.len(), 64, "blake3 hex digest");
}
