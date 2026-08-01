# Contributing

Read `PLAN.md`, `AGENTS.md`, and the active local `CURRENT_TASK.md` before editing. Work from the repository root and keep the exact tool versions and committed lockfiles intact.

Milestone work is sequential. Implement one checkpoint, run its exact verification, inspect the diff, stage only that checkpoint's files, and make one focused commit. Do not begin the next checkpoint automatically, push, or change unrelated files. If the same failure signature remains after three correction attempts, stop and report the command, evidence, and affected diff.

The Rust core is the future authority for simulation. Browser code may host lifecycle and presentation concerns, but it must not invent authoritative state. New dependencies, public entry points, architecture changes, and test exceptions require evidence and an explicit plan update.

The repository's initial control documents are local-only. Keep `PLAN.md`, `AGENTS.md`, and `CURRENT_TASK.md` excluded, unchanged, unstaged, and uncommitted.
