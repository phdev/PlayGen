# Mechanic snippet library

Idiomatic PlayCanvas + `__playgen` implementations of common gameplay mechanics. The `scene-assembly` subagent **composes** these into `games/<slug>/build/src/main.ts` instead of re-authoring physics for every slice — reduces the LLM's surface area for catastrophic bugs and makes loop-steps verifiable by construction.

## Usage pattern

For each `loopStep` in `manifest.plan.loopSteps` that matches a snippet here, scene-assembly:

1. Copies the snippet file into `games/<slug>/build/src/mechanics/<name>.ts`
2. Imports it in `main.ts`
3. Calls the exported `wireXxx(app, options)` function during scene setup

Each snippet:
- Takes a `pc.Application` and config
- Adds entities, attaches input handlers, registers update callbacks
- Emits the `progress` events the planner expects (`emit('progress', { step: 'name' })`) so the harness can verify the loop step fired

## Available snippets

| File | Step name(s) emitted | Use for |
|---|---|---|
| `orbital-flight.ts` | `throttle-up`, `pitch-maneuver`, `orbit-achieved` | Rocket / vehicle sims (KSP-likes) |
| `staging.ts` | `staging` | Drop-fuel-tank mechanics extending `orbital-flight` |
| `pickup.ts` | `pickup` | Proximity-triggered item collection |
| `wave-spawn.ts` | `wave-spawned`, `enemy-killed` | Tower defense, horde shooters |

## Adding a new snippet

1. Create `templates/_shared/mechanics/<name>.ts`
2. Export a single `wire<Name>(app, options)` function
3. Inside, call `emit('progress', { step: '<step-name>' })` once per relevant trigger
4. Add a row to the table above
5. Optionally update the planner subagent prompt with the new step names

The snippets live outside the templates so any template can pull them in. They expect the same `__playgen` helpers (`emit`, `emitStepOnce`, `setScore`, etc.) that the templates ship in `src/playgen.ts`.
