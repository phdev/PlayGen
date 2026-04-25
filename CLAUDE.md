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
- `src/tools/playcanvas-rest.ts` — `uploadAsset()`, `listAssets()`, `deleteAsset()` against `https://playcanvas.com/api`. Fills the binary-upload gap the editor MCP server doesn't cover.
- `src/tools/playcanvas-mcp.ts` — `playcanvasMcpServerConfig()` for the Agent SDK's `mcpServers` option. Defaults to `npx -y @playcanvas/editor-mcp-server`; override via `PLAYCANVAS_MCP_SERVER_PATH` to point at a local clone. Disable entirely with `PLAYGEN_DISABLE_PLAYCANVAS_MCP=1`.
- `scripts/upload-asset.ts` — CLI: `npm run upload:asset -- <slug> <assetId>`. The `scene-assembly` subagent shells to this for GLBs/splats/voxel collision.
- Orchestrator now wires the PlayCanvas MCP into the Agent SDK via `mcpServers`. The `scene-assembly` subagent omits its `tools` allowlist so the inherited MCP tools (create_entities, add_components, set_script_text, etc.) are available to it.
- `src/harness/runner.ts` — `launchHarness()`, `snapshot()`, `readPlayGenState()`, `waitForReady()`. Chromium with `channel: 'chromium'` + GPU flags, mobile viewport + `hasTouch` + `isMobile` for touch mode, gamepad shim installed for gamepad mode.
- `src/harness/inputs/{keyboard,mouse,touch}.ts` — `tapKey`/`holdKey`/`chord`; `click`/`moveTo`/`dragFromTo`; `tap`/`swipe`/`longPress` (touch swipe via CDP `Input.dispatchTouchEvent`).
- `src/harness/judge.ts` — `judge(session, label, criteria)` reads `window.__playgen`, captures a screenshot, returns `{verdict, reason, finalState, screenshotPath}`. Supports `requireReady`, `requireProgress`, `expectEvent`, `minScore`, `forbidErrors`.
- `src/harness/scenarios/{boot,golden-path}.ts` — `runBoot(session)` waits for `__playgen.ready`; `runGoldenPath(session, {controls})` drives random inputs from the per-mode control bindings for ~15s and looks for win/lose events.
- `scripts/playtest.ts` — `npm run playtest -- <slug>`. Iterates `manifest.plan.inputModes`, runs boot + golden-path per mode, appends PlaytestRuns to `manifest.playtests`, transitions status to `complete` or `fixing`. Exits 0/1 on overall verdict.
- `templates/basic-platformer/` — first PlayCanvas project skeleton (Vite + `playcanvas` v2 engine). Ships:
  - top-down camera, ground, player cube, pickup sphere, goal pad
  - keyboard (WASD/arrows), gamepad (left stick + dpad, standard mapping), touch (drag-to-move) all wired to the same player entity
  - full `window.__playgen` contract via a hand-mirrored `src/playgen.ts` (must stay in sync with `src/types/playgen.ts`)
  - emits `pickup`, `win`, `lose`, `error` events
  The `scene-assembly` subagent copies this to `games/<slug>/build/` and edits `src/main.ts` to swap primitives for GLBs and tune mechanics per `manifest.plan`.
- `src/harness/instrumentation.ts` — `initPlayGen`, `emit`, `setReady`, `setPlaying`, `tick`, `reportError`
- `src/harness/inputs/gamepad.ts` — `installVirtualGamepad`, `pressButton`/`releaseButton`/`setAxis`/`tap` with standard-mapping constants
- `scripts/new-slice.ts` — CLI: `npm run new -- "<premise>" [--modes keyboard,touch,gamepad]`
- `scripts/validate-env.ts`

## What's next (in build order)

The five originally-planned stages have all landed. Likely next-steps when wiring this up for real:

1. End-to-end smoke test: `cp -R templates/basic-platformer games/test-slice/build && cd games/test-slice/build && npm install && npm run preview`, then point `scripts/playtest.ts` at `http://localhost:4173`.
2. `scripts/serve-build.ts` — wraps the per-slice `vite preview` lifecycle so the `playtest` script can start it implicitly when `manifest.playcanvas.publishedUrl` is missing.
3. Wire the planner subagent's prompt to actually emit a valid `manifest.plan` shape (currently it is told to but no schema validation enforces it).
4. Consider hoisting `src/types/playgen.ts` + the instrumentation helpers into a shared `packages/contract/` so templates can import instead of duplicating.
5. Editor MCP path: when the cloud editor is the publish target, scene-assembly stops copying templates and instead drives the MCP server to build scenes directly.

## Out of scope for v1

- Generative gaussian splats (no production API in 2026)
- Real-device mobile fidelity (BrowserStack/Sauce — defer)
- Audio generation
