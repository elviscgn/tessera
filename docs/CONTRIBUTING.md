# Contributing

Tessera is being built in small, reviewable increments. The most useful contribution is a focused change that explains its purpose, respects the Rust/browser boundary, and leaves the repository easy to run.

## Before you change code

Start at the repository root and check the current milestone in [ROADMAP.md](ROADMAP.md). If a change affects the public API, protocol, crate boundaries, or ownership model, record the decision in [DECISIONS.md](DECISIONS.md) before implementation rather than letting it emerge accidentally in code.

Keep the pinned tool versions and both lockfiles intact. Generated Wasm output is a build artifact; regenerate it with the repository script instead of editing it by hand.

## Development workflow

1. Choose one small piece of work and state what “done” means.
2. Make the smallest coherent change. Keep unrelated cleanup in a separate change.
3. Add or update deterministic tests with the implementation.
4. Run the checks that cover the change, then run `pnpm check` before asking for review.
5. Review the diff, including generated files and package contents, before committing.

Use a short commit subject in the imperative mood, for example `add camera coordinate helpers` or `tighten snapshot validation`.

## Design boundaries

- Rust owns authoritative simulation state and gameplay-affecting behaviour.
- TypeScript owns browser lifecycle, Worker communication, input translation, persistence adapters, and presentation state.
- Babylon.js is a replaceable renderer. A mesh must never become the source of truth for entity existence or gameplay.
- Commands and events cross the Worker boundary in versioned batches. Do not add per-entity calls or JSON to a hot path.
- Consumer object definitions use stable string IDs. Rust assigns the handles and remains the authority for footprint expansion, placement validity, and command rejection; a browser preview is never a substitute for command validation.
- Public consumers use declared entry points. Do not import internal files from examples or tests that represent consumer behaviour.

New dependencies need a clear reason, a licence check, and an explanation of their runtime or build impact. New public exports need tests and documentation. If a proposed change conflicts with the architecture, pause and write down the trade-off before proceeding.

## Verification

The standard repository gate is:

```sh
pnpm check
```

For a narrower change, use the focused commands in [TESTING.md](TESTING.md). Tests should assert state, hashes, protocol records, and diagnostics wherever possible. Screenshots are useful for visual work, but they should not be the only proof of behaviour.

## Pull requests

GitHub supplies a checklist from `.github/pull_request_template.md`. Keep it honest: a checked box should point to a command, test, screenshot, or reviewable diff that provides the evidence.

A useful pull request says:

- what changed and why;
- which milestone or design decision it belongs to;
- which commands were run and whether they passed;
- what remains deliberately out of scope;
- any follow-up work or risks.

Keep the implementation and its documentation in the same change when the public behaviour or developer workflow changes.
