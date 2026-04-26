# physics-vehicle template

Vertical-slice scaffold for KSP-like vehicle sims. The starter ships a working rocket-launch loop:

- **launch** — first time the player engages thrust
- **throttle-up** — sustained thrust input
- **pitch-maneuver** — adjusting orientation in flight
- **out-of-fuel** — fuel reaches zero
- **orbit-achieved** — altitude > 200m with horizontal speed > 25 m/s (win)

Each step emits `emit('progress', { step: '<name>' })` exactly once via the shared `emitStepOnce` helper, so the harness's loop-step verifier can confirm the loop was exercised end-to-end.

## Controls (default wiring)

| Action | Keyboard | Touch | Gamepad |
|---|---|---|---|
| Throttle | W (hold), S to release | drag up | RT |
| Pitch | A / D | drag horizontal | left stick X |

The scene-assembly subagent rewrites `src/main.ts` per `manifest.plan`: swaps the placeholder cylinder for the rocket GLB, tunes the win/lose thresholds, may add stages, mission contracts, or terrain — but must preserve the loop-step `emitStepOnce` calls (or rewire to whatever the planner emits in `manifest.plan.loopSteps`).

## Running locally

```bash
npm install
npm run dev      # :5173
npm run build    # production bundle in dist/
npm run preview  # serves dist/ on :4173
```

`vite.config.ts` ships `base: './'` so the build resolves correctly when the slice is hosted under `/PlayGen/slices/<slug>/` on Pages.

## Contract

`src/playgen.ts` is hand-mirrored from the parent's `src/types/playgen.ts` + `src/harness/instrumentation.ts`. **Must stay in sync** — the harness reads `window.__playgen` and rejects games that don't expose it.
