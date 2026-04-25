# PlayGen — architecture & build notes

## Goal

Player gives a premise -> system returns a playable PlayCanvas vertical slice that has been validated end-to-end on mobile (touch), keyboard/mouse, and gamepad.

## Pipeline

1. Premise -> concept image (`gpt-image-2`, `FLUX.2` fallback)
2. Concept image + premise -> vertical-slice plan + asset manifest (Claude Agent SDK orchestrator)
3. Asset manifest -> rigged glTFs (Meshy `image-to-3d`)
4. Optional backdrop -> photogrammetry splat (`.ply`) -> voxel collision (`.voxel.json`) via `@playcanvas/splat-transform`
5. Plan + assets -> PlayCanvas scene via `playcanvas/editor-mcp-server` + REST multipart for binary uploads
6. Generated game -> Playwright harness validates `window.__playgen` state across three input modes
7. Failures feed back into the orchestrator's fix loop

## Key decisions

- **Claude Agent SDK over LangGraph**: subagent + MCP integration land directly on the PlayCanvas editor MCP server. Pick LangGraph later only if mid-pipeline human approval gates become load-bearing.
- **Meshes for everything the player touches; splats only as photogrammetry backdrop.** Generative splats (LGM, GaussianAnything, DiffSplat) are still research-grade with no production API in 2026.
- **Splat collision via `splat-transform` -> `.voxel.json`.** Sparse voxel octree, world-units configurable, opacity-thresholded. See `src/tools/splat-transform.ts`.
- **`window.__playgen` is the load-bearing contract**, not vision. Templates expose state; the harness reads it. Computer Use is a *fallback* judge for "does this look broken," not the primary signal.
- **Gamepad via injected `navigator.getGamepads`** — no native Playwright support exists. See `src/harness/inputs/gamepad.ts`.

## Layout

```
src/
  types/playgen.ts          contract surfaced by every generated game
  tools/splat-transform.ts  voxel collision wrapper around the CLI
  harness/
    instrumentation.ts      game-side helpers for emitting __playgen state
    inputs/gamepad.ts       virtual gamepad shim (standard mapping)
scripts/validate-env.ts     fail-fast env check
templates/                  PlayCanvas project skeletons (TBD; OpenGame Template Skill lift)
games/                      generated slices land here at runtime
```

## What exists today

- Build foundation (`package.json`, `tsconfig.json`, `.env.example`, `.gitignore`)
- `src/types/playgen.ts` — the `window.__playgen` contract
- `src/types/manifest.ts` — full `Manifest` schema (slice plan, asset records, splat records, playtest runs, errors)
- `src/orchestrator/manifest.ts` — `createManifest`, `loadManifest`, `saveManifest` (atomic), `updateManifest`, `setStatus`, `recordError`; on-disk layout: `games/<slug>/{manifest.json, concept.png, assets/, screenshots/}`
- `src/orchestrator/index.ts` — Agent SDK entry: `runOrchestrator({ premise, inputModes? })` registers five subagents (`concept`, `planner`, `asset-gen`, `scene-assembly`, `playtest`) and runs the phase loop
- `src/tools/splat-transform.ts` — `generateVoxelCollision()` shells the CLI with `-R`/`-A` flags and returns `{jsonPath, binPath}`
- `src/tools/image-gen.ts` — `generateConceptImage()` via OpenAI SDK; default model `gpt-image-2`, env override `PLAYGEN_IMAGE_MODEL`
- `src/tools/meshy.ts` — `generateMeshFromImage()` posts to `api.meshy.ai/openapi/v1/image-to-3d`, polls every 5s, downloads the GLB
- `scripts/gen-image.ts` — CLI: `npm run gen:image -- <slug> "<prompt>"`. The `concept` subagent shells to this.
- `scripts/gen-mesh.ts` — CLI: `npm run gen:mesh -- <slug> <assetId>`. The `asset-gen` subagent shells to this and parallelizes with `&`/`wait`.
- `src/harness/instrumentation.ts` — `initPlayGen`, `emit`, `setReady`, `setPlaying`, `tick`, `reportError`
- `src/harness/inputs/gamepad.ts` — `installVirtualGamepad`, `pressButton`/`releaseButton`/`setAxis`/`tap` with standard-mapping constants
- `scripts/new-slice.ts` — CLI: `npm run new -- "<premise>" [--modes keyboard,touch,gamepad]`
- `scripts/validate-env.ts`

## What's next (in build order)

1. `src/tools/{playcanvas-mcp,playcanvas-rest}.ts` — MCP client config + REST multipart upload (fills the binary-asset-upload gap the editor MCP server doesn't cover)
2. `src/harness/runner.ts` + `inputs/{keyboard,mouse,touch}.ts` + `scenarios/{boot,golden-path,input-parity}.ts` + `judge.ts`
3. `templates/basic-platformer/` — first PlayCanvas skeleton with `__playgen` wired in

## Out of scope for v1

- Generative gaussian splats (no production API in 2026)
- Real-device mobile fidelity (BrowserStack/Sauce — defer)
- Audio generation
