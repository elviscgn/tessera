#![forbid(unsafe_code)]

//! Native Tessera tooling and deterministic performance harnesses.

mod arena;

use std::env;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tessera_arena::ArenaLayout;
use tessera_core::{Command, CommandEnvelope, Footprint, GridPosition, QuarterTurn, Simulation};

const OBJECT_TYPE_ID: &str = "performance/foundation";
const GAME_ID: &str = "tessera";
const SCENARIO_ID: &str = "performance";
const FRAMEWORK_VERSION: &str = "0.0.0";
const PROTOCOL_VERSION: u16 = 1;

#[derive(Clone, Debug)]
struct BenchOptions {
    entities: usize,
    ticks: u64,
    samples: usize,
    warmup: usize,
    output: PathBuf,
    compare: Option<PathBuf>,
    maximum_regression_percent: f64,
    fail_on_regression: bool,
}

#[derive(Clone, Debug)]
struct BenchSample {
    spawn_ms: f64,
    tick_ms: f64,
    hash_ms: f64,
    save_ms: f64,
    load_ms: f64,
    total_ms: f64,
    ticks_per_second: f64,
    canonical_state_bytes: usize,
    save_bytes: usize,
    entity_count: usize,
    occupied_cell_count: usize,
    state_hash_hex: String,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("tessera-cli: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args().skip(1);
    match arguments.next().as_deref() {
        Some("bench") => run_benchmark(parse_bench_options(arguments)?),
        Some("arena") => run_arena(arguments),
        Some(command) => Err(format!("unknown command: {command}").into()),
        None => Err("missing command: expected bench or arena".into()),
    }
}

fn run_arena<I>(arguments: I) -> Result<(), Box<dyn Error>>
where
    I: IntoIterator<Item = String>,
{
    let mut arguments = arguments.into_iter();
    let Some(subcommand) = arguments.next() else {
        return Err("arena requires a subcommand: play".into());
    };
    match subcommand.as_str() {
        "play" => {
            let options = parse_arena_play_options(arguments)?;
            let report = arena::run_match(&options)?;
            if let Some(output) = options.report_output.as_ref() {
                if let Some(parent) = output.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(
                    output,
                    format!(
                        "{}\n",
                        serde_json::to_string_pretty(&arena_report_json(&report))?
                    ),
                )?;
                println!("wrote arena match report to {}", output.display());
            }
            println!(
                "arena match: score {}-{} ({}), turns {}, tick {}, final hash {}",
                report.score.0,
                report.score.1,
                report
                    .winner
                    .map(|side| format!("side {side} wins"))
                    .unwrap_or_else(|| "no winner".to_owned()),
                report.turns_played,
                report.final_tick,
                report.state_hash_hex,
            );
            if !report.replay_reproduced {
                return Err("replay verification failed: rebuilt hash differs".into());
            }
            Ok(())
        }
        other => Err(format!("unknown arena subcommand: {other}").into()),
    }
}

fn parse_arena_play_options<I>(arguments: I) -> Result<arena::ArenaPlayOptions, Box<dyn Error>>
where
    I: IntoIterator<Item = String>,
{
    let mut options = arena::ArenaPlayOptions {
        layout: ArenaLayout::standard(),
        win_goals: 5,
        max_turns: 24,
        power_milli: arena::DEFAULT_POWER_MILLI,
        report_output: None,
        replay_output: None,
    };
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--win-goals" => {
                options.win_goals = parse_positive(&mut arguments, "win-goals")? as u32
            }
            "--max-turns" => {
                options.max_turns = parse_positive(&mut arguments, "max-turns")? as u32
            }
            "--power-milli" => {
                options.power_milli = parse_positive(&mut arguments, "power-milli")? as u16;
                if options.power_milli > 1_000 {
                    return Err("power-milli must be no greater than 1000".into());
                }
            }
            "--layout" => {
                let value = required_value(&mut arguments, "layout")?;
                options.layout = match value.as_str() {
                    "standard" => ArenaLayout::standard(),
                    "small" => ArenaLayout::test_small(),
                    other => return Err(format!("unknown layout: {other}").into()),
                };
            }
            "--output" => {
                options.report_output =
                    Some(PathBuf::from(required_value(&mut arguments, "output")?))
            }
            "--replay" => {
                options.replay_output =
                    Some(PathBuf::from(required_value(&mut arguments, "replay")?))
            }
            "--help" | "-h" => {
                println!(
                    "tessera-cli arena play [--win-goals N] [--max-turns N] \
                     [--power-milli N] [--layout standard|small] [--output PATH] [--replay PATH]"
                );
                std::process::exit(0);
            }
            _ => return Err(format!("unknown arena play option: {argument}").into()),
        }
    }
    Ok(options)
}

fn arena_report_json(report: &arena::ArenaMatchReport) -> serde_json::Value {
    serde_json::json!({
        "schema": "tessera.arena.match",
        "schemaVersion": 1,
        "layoutWidthMicrometres": report.layout_width_micrometres,
        "layoutDepthMicrometres": report.layout_depth_micrometres,
        "winGoals": report.win_goals,
        "maxTurns": report.max_turns,
        "turnsPlayed": report.turns_played,
        "finalTick": report.final_tick,
        "score": [report.score.0, report.score.1],
        "matchOver": report.match_over,
        "winner": report.winner,
        "goals": report.goals.iter().map(|(tick, side)| {
            serde_json::json!({ "tick": tick, "side": side })
        }).collect::<Vec<_>>(),
        "stateHashHex": report.state_hash_hex,
        "replayCommands": report.replay_commands,
        "replayReproduced": report.replay_reproduced,
    })
}

fn parse_bench_options<I>(arguments: I) -> Result<BenchOptions, Box<dyn Error>>
where
    I: IntoIterator<Item = String>,
{
    let mut options = BenchOptions {
        entities: 256,
        ticks: 100,
        samples: 5,
        warmup: 1,
        output: PathBuf::from("artifacts/performance/native.json"),
        compare: None,
        maximum_regression_percent: 25.0,
        fail_on_regression: false,
    };
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--entities" => options.entities = parse_positive(&mut arguments, "entities")?,
            "--ticks" => options.ticks = parse_positive_u64(&mut arguments, "ticks")?,
            "--samples" => options.samples = parse_positive(&mut arguments, "samples")?,
            "--warmup" => options.warmup = parse_nonnegative(&mut arguments, "warmup")?,
            "--output" => options.output = PathBuf::from(required_value(&mut arguments, "output")?),
            "--compare" => {
                options.compare = Some(PathBuf::from(required_value(&mut arguments, "compare")?))
            }
            "--max-regression-percent" => {
                options.maximum_regression_percent =
                    required_value(&mut arguments, "max-regression-percent")?.parse::<f64>()?;
                if !options.maximum_regression_percent.is_finite()
                    || options.maximum_regression_percent < 0.0
                {
                    return Err(
                        "max-regression-percent must be a finite non-negative number".into(),
                    );
                }
            }
            "--fail-on-regression" => options.fail_on_regression = true,
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            _ => return Err(format!("unknown benchmark option: {argument}").into()),
        }
    }
    if options.entities > 100_000 {
        return Err("entities must be no greater than 100000".into());
    }
    if options.ticks == 0 {
        return Err("ticks must be positive".into());
    }
    if options.samples == 0 {
        return Err("samples must be positive".into());
    }
    Ok(options)
}

fn required_value<I>(arguments: &mut I, name: &str) -> Result<String, Box<dyn Error>>
where
    I: Iterator<Item = String>,
{
    arguments
        .next()
        .ok_or_else(|| format!("--{name} requires a value").into())
}

fn parse_positive<I>(arguments: &mut I, name: &str) -> Result<usize, Box<dyn Error>>
where
    I: Iterator<Item = String>,
{
    let value = required_value(arguments, name)?.parse::<usize>()?;
    if value == 0 {
        return Err(format!("{name} must be positive").into());
    }
    Ok(value)
}

fn parse_nonnegative<I>(arguments: &mut I, name: &str) -> Result<usize, Box<dyn Error>>
where
    I: Iterator<Item = String>,
{
    Ok(required_value(arguments, name)?.parse::<usize>()?)
}

fn parse_positive_u64<I>(arguments: &mut I, name: &str) -> Result<u64, Box<dyn Error>>
where
    I: Iterator<Item = String>,
{
    let value = required_value(arguments, name)?.parse::<u64>()?;
    if value == 0 {
        return Err(format!("{name} must be positive").into());
    }
    Ok(value)
}

fn print_help() {
    println!(
        "tessera-cli bench [--entities N] [--ticks N] [--samples N] [--warmup N] \
         [--output PATH] [--compare PATH] [--max-regression-percent N] [--fail-on-regression]"
    );
}

fn run_benchmark(options: BenchOptions) -> Result<(), Box<dyn Error>> {
    let mut samples = Vec::with_capacity(options.samples);
    for _ in 0..options.warmup {
        run_sample(&options)?;
    }
    for _ in 0..options.samples {
        samples.push(run_sample(&options)?);
    }
    let report = build_report(&options, &samples)?;
    write_report(&options.output, &report)?;
    if let Some(compare) = options.compare.as_deref() {
        compare_report(
            &report,
            compare,
            options.maximum_regression_percent,
            options.fail_on_regression,
        )?;
    }
    println!(
        "wrote native performance report to {}",
        options.output.display()
    );
    Ok(())
}

fn run_sample(options: &BenchOptions) -> Result<BenchSample, Box<dyn Error>> {
    let total_start = Instant::now();
    let mut simulation = Simulation::new([7; 32]);
    let object_type = simulation
        .register_object_type(OBJECT_TYPE_ID, Footprint::single_cell())
        .map_err(boxed_debug)?;

    let spawn_start = Instant::now();
    let spawn_commands = (0..options.entities)
        .map(|index| {
            let x = i32::try_from(index.checked_mul(2).ok_or("entity coordinate overflow")?)?;
            Ok(CommandEnvelope::new(
                u64::try_from(index + 1)?,
                Command::Spawn {
                    object_type,
                    position: GridPosition::new(x, 0, 0),
                    rotation: QuarterTurn::from_index((index % 4) as u8),
                },
            ))
        })
        .collect::<Result<Vec<_>, Box<dyn Error>>>()?;
    simulation
        .submit_batch(&spawn_commands)
        .map_err(boxed_debug)?;
    simulation.advance_one_tick().map_err(boxed_debug)?;
    let spawn_ms = elapsed_ms(spawn_start.elapsed());
    let entities = simulation.entities().collect::<Vec<_>>();

    let tick_start = Instant::now();
    let mut next_sequence = u64::try_from(options.entities)?.saturating_add(1);
    for tick in 0..options.ticks {
        let z = if tick % 2 == 0 { 1 } else { 0 };
        let commands = entities
            .iter()
            .enumerate()
            .map(|(index, entity)| {
                let x = i32::try_from(index.checked_mul(2).ok_or("entity coordinate overflow")?)?;
                let command = Command::Move {
                    entity: entity.id,
                    position: GridPosition::new(x, z, 0),
                    rotation: entity.rotation,
                };
                let envelope = CommandEnvelope::new(next_sequence, command);
                next_sequence = next_sequence.checked_add(1).ok_or("sequence overflow")?;
                Ok(envelope)
            })
            .collect::<Result<Vec<_>, Box<dyn Error>>>()?;
        simulation.submit_batch(&commands).map_err(boxed_debug)?;
        simulation.advance_one_tick().map_err(boxed_debug)?;
    }
    simulation.validate_invariants().map_err(boxed_debug)?;
    let tick_ms = elapsed_ms(tick_start.elapsed());

    let hash_start = Instant::now();
    let state_hash_hex = simulation.state_hash_hex();
    let hash_ms = elapsed_ms(hash_start.elapsed());
    let canonical_state_bytes = simulation.canonical_state_bytes().len();

    let save_start = Instant::now();
    let save = simulation
        .save_json(GAME_ID, SCENARIO_ID, FRAMEWORK_VERSION, PROTOCOL_VERSION, 1)
        .map_err(boxed_debug)?;
    let save_ms = elapsed_ms(save_start.elapsed());

    let load_start = Instant::now();
    let loaded = Simulation::load_json(
        &save,
        GAME_ID,
        SCENARIO_ID,
        FRAMEWORK_VERSION,
        PROTOCOL_VERSION,
    )
    .map_err(boxed_debug)?;
    if loaded.simulation.state_hash_hex() != state_hash_hex {
        return Err("save/load benchmark changed the state hash".into());
    }
    let load_ms = elapsed_ms(load_start.elapsed());
    let total_ms = elapsed_ms(total_start.elapsed());
    let ticks_per_second = options.ticks as f64 / (tick_ms / 1_000.0).max(f64::EPSILON);

    Ok(BenchSample {
        spawn_ms,
        tick_ms,
        hash_ms,
        save_ms,
        load_ms,
        total_ms,
        ticks_per_second,
        canonical_state_bytes,
        save_bytes: save.len(),
        entity_count: simulation.entity_count(),
        occupied_cell_count: simulation.occupied_cell_count(),
        state_hash_hex,
    })
}

fn elapsed_ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

fn build_report(
    options: &BenchOptions,
    samples: &[BenchSample],
) -> Result<serde_json::Value, Box<dyn Error>> {
    let sample_values = samples
        .iter()
        .map(|sample| {
            serde_json::json!({
                "spawnMs": sample.spawn_ms,
                "tickMs": sample.tick_ms,
                "hashMs": sample.hash_ms,
                "saveMs": sample.save_ms,
                "loadMs": sample.load_ms,
                "totalMs": sample.total_ms,
                "ticksPerSecond": sample.ticks_per_second,
                "canonicalStateBytes": sample.canonical_state_bytes,
                "saveBytes": sample.save_bytes,
                "entityCount": sample.entity_count,
                "occupiedCellCount": sample.occupied_cell_count,
            })
        })
        .collect::<Vec<_>>();
    let summary = summarize(
        &sample_values,
        [
            "spawnMs",
            "tickMs",
            "hashMs",
            "saveMs",
            "loadMs",
            "totalMs",
            "ticksPerSecond",
        ],
    )?;
    let last = samples.last().ok_or("benchmark produced no samples")?;
    let mut seed_hex = String::with_capacity(64);
    for byte in [7; 32] {
        seed_hex.push_str(&format!("{byte:02x}"));
    }
    let final_tick = options.ticks.checked_add(1).ok_or("tick count overflow")?;
    Ok(serde_json::json!({
        "schema": "tessera.performance.native",
        "schemaVersion": 1,
        "runner": {
            "os": env::consts::OS,
            "arch": env::consts::ARCH,
            "family": env::consts::FAMILY,
        },
        "workload": {
            "entities": options.entities,
            "ticks": options.ticks,
            "samples": options.samples,
            "warmup": options.warmup,
            "seedHex": seed_hex,
            "objectType": OBJECT_TYPE_ID,
            "tickRateHz": 20,
        },
        "samples": sample_values,
        "summary": summary,
        "state": {
            "tick": final_tick,
            "entityCount": last.entity_count,
            "occupiedCellCount": last.occupied_cell_count,
            "stateHashHex": last.state_hash_hex,
        },
        "notes": [
            "Timings are observations for trend comparison, not release budgets.",
            "Compare only like-for-like runner and workload settings.",
        ],
    }))
}

fn boxed_debug<E>(error: E) -> Box<dyn Error>
where
    E: std::fmt::Debug,
{
    format!("{error:?}").into()
}

fn summarize(
    samples: &[serde_json::Value],
    fields: [&str; 7],
) -> Result<serde_json::Value, Box<dyn Error>> {
    let mut summary = serde_json::Map::new();
    for field in fields {
        let mut values = samples
            .iter()
            .map(|sample| {
                sample[field]
                    .as_f64()
                    .ok_or_else(|| format!("sample field {field} is not numeric"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        values.sort_by(f64::total_cmp);
        let median = percentile(&values, 0.5);
        let p95 = percentile(&values, 0.95);
        summary.insert(
            field.to_owned(),
            serde_json::json!({ "median": median, "p95": p95 }),
        );
    }
    Ok(serde_json::Value::Object(summary))
}

fn percentile(values: &[f64], quantile: f64) -> f64 {
    if values.len() == 1 {
        return values[0];
    }
    let position = (values.len() - 1) as f64 * quantile;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    if lower == upper {
        return values[lower];
    }
    values[lower] + (values[upper] - values[lower]) * (position - lower as f64)
}

fn write_report(path: &Path, report: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, format!("{}\n", serde_json::to_string_pretty(report)?))?;
    Ok(())
}

fn compare_report(
    report: &serde_json::Value,
    baseline_path: &Path,
    maximum_regression_percent: f64,
    fail_on_regression: bool,
) -> Result<(), Box<dyn Error>> {
    let baseline: serde_json::Value = serde_json::from_slice(&fs::read(baseline_path)?)?;
    let current = report["summary"]["totalMs"]["median"]
        .as_f64()
        .ok_or("current report has no totalMs median")?;
    let previous = baseline["summary"]["totalMs"]["median"]
        .as_f64()
        .ok_or("baseline has no totalMs median")?;
    let regression = if previous == 0.0 {
        if current == 0.0 { 0.0 } else { f64::INFINITY }
    } else {
        ((current - previous) / previous) * 100.0
    };
    eprintln!(
        "native total median: current {:.3} ms, baseline {:.3} ms, change {:+.2}%",
        current, previous, regression
    );
    if fail_on_regression && regression > maximum_regression_percent {
        return Err(format!(
            "native total median regression {regression:.2}% exceeds {maximum_regression_percent:.2}%"
        )
        .into());
    }
    Ok(())
}
