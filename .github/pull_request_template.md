## What changed

<!-- Describe the user-visible or engineering change in a few sentences. -->

## Why

<!-- Explain the problem this solves and link the relevant issue or milestone. -->

## Verification

- [ ] I ran the focused checks for this change.
- [ ] `pnpm check` passes, or the exception is explained below.
- [ ] Tests cover the changed behaviour and important failure paths.
- [ ] Visual changes include a screenshot or an explicit reason one is not useful.

## Architecture

- [ ] Rust remains the authority for gameplay state, entity lifecycle, occupancy, and randomness.
- [ ] Worker messages remain versioned, validated, and bounded.
- [ ] Native and Wasm behaviour stays equivalent where the change applies to both.
- [ ] Babylon and browser resources are disposable and cleaned up on `dispose()`.
- [ ] Public API or protocol changes include documentation and compatibility notes.

## Risk and follow-up

<!-- Note migration, performance, compatibility, rollback, or deliberate follow-up work. -->
