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
- `templates/physics-vehicle/` — KSP-lite scaffold for vehicle/rocket sims. Ships a working launch loop with `emitStepOnce()` calls for `launch`, `throttle-up`, `pitch-maneuver`, `out-of-fuel`, `orbit-achieved`. Win = altitude + horizontal speed thresholds (orbital insertion); lose = crashed or fuel-out before orbit. Wired across keyboard / touch / gamepad. Planner picks this template when `designIntent.genre` matches sim/rocket/vehicle.
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

## Cloudflare Worker (dispatch proxy)

The webapp doesn't ask visitors for a PAT — it can't, because the static site is public and a credential in localStorage would still be exposed. Instead, the webapp calls a tiny Cloudflare Worker (`worker/`) that holds the GitHub PAT as a Workers secret. The Worker accepts only allowed Origins, validates the request, and dispatches the workflow.

Endpoints:
- `POST /dispatch` — `{premise, modes}` → triggers `generate.yml`
- `GET /runs` — recent run summaries

**Required secrets** (repo settings, used by `.github/workflows/deploy-worker.yml`):
- `CLOUDFLARE_API_TOKEN` — from Cloudflare dashboard, "Edit Cloudflare Workers" template
- `GH_DISPATCH_PAT` — GitHub PAT with `workflow` scope (and `repo` scope if private). The worker calls GitHub on behalf of the visitor.

**Wiring the webapp to the worker:**
After the worker deploys, get its URL (e.g. `https://playgen-dispatch.<sub>.workers.dev`) and set it as a repo *variable* (not secret):
```
gh variable set VITE_DISPATCH_URL --body 'https://playgen-dispatch.<sub>.workers.dev'
```
Both `deploy-pages.yml` and `generate.yml` pass it to `vite build` so the webapp baked into the Pages deploy knows where to dispatch.

If `VITE_DISPATCH_URL` is unset, the webapp falls back to showing the local-run command (no PAT input is ever surfaced).

## Cloud-first run path (default)

The whole pipeline runs on GitHub Actions. The webapp dispatches the workflow; nothing requires the user's laptop to be on.

**Required repo secrets** (Settings → Secrets and variables → Actions):
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MESHY_API_KEY`, `PLAYCANVAS_API_KEY`, `PLAYCANVAS_PROJECT_ID`. (PlayCanvas is optional for the engine-only path but the workflow exposes it.)

**Flow:**
1. Webapp Author tab dispatches `.github/workflows/generate.yml` via the GitHub REST API (uses the user's PAT — saved in localStorage, only sent to api.github.com).
2. Workflow checks out main, installs deps, installs Playwright chromium, runs `npm run new -- "<premise>"` with `PLAYGEN_PERMISSION_MODE=bypassPermissions` and `PLAYGEN_DISABLE_PLAYCANVAS_MCP=1` (the editor MCP needs a real browser + extension, not viable in CI).
3. `scripts/new-slice.ts` writes the slug to `$GITHUB_OUTPUT` *before* the orchestrator runs, so the next step always has it.
4. Orchestrator's `scene-assembly` subagent uses the **engine-only path**: clones `templates/basic-platformer` to `games/<slug>/build/`, edits `src/main.ts` per `manifest.plan`, runs `npm install && npm run build`.
5. `playtest` subagent shells to `scripts/playtest.ts` which auto-spawns `vite preview` from the build dir when `manifest.playcanvas.publishedUrl` is unset, then tears it down.
6. `scripts/publish-slice.ts` copies `games/<slug>/build/dist/` into `webapp/public/slices/<slug>/`, copies `concept.png` to `slices/<slug>/thumbnail.png`, upserts an entry in `webapp/public/slices.json` with `publishedUrl: 'slices/<slug>/'`.
7. Workflow commits the new slice + index to main using `GITHUB_TOKEN` (`contents: write`).
8. Same workflow's `deploy` job (gated on `committed == 'true'`) builds the webapp and deploys to Pages — no separate workflow trigger needed (since `GITHUB_TOKEN` pushes don't fire other workflows).

**Why the engine-only path** instead of the editor MCP path: the MCP server requires a Chrome extension + an open PlayCanvas Editor tab to be useful. CI runners don't have either. The MCP path stays as a configurable option for local dev where someone has the editor open; the CI path bakes a full Vite build into the Pages deploy.

## Webapp (GitHub Pages author + gallery shell)

- `webapp/` — Vite + React 19 static site. **Cannot run the orchestrator** (Node + Playwright + child-process dependent), but **dispatches it via GitHub Actions**. Three views:
  - **Author** (`#/`) — premise textarea + input-mode checkboxes; primary "Generate in cloud" button (PAT in `localStorage`, dispatches `generate.yml` via GitHub REST), with a recent-runs list. Secondary "run locally" panel renders the exact `npm run new` command + copy button.
  - **Gallery** (`#/gallery`) — fetches `webapp/public/slices.json`, renders cards. Each card links to `#/slice/<slug>`.
  - **Slice view** (`#/slice/<slug>`) — iframes `manifest.playcanvas.publishedUrl` (with `allow="gamepad *; fullscreen ..."`), exposes verdict buttons and a copy-share-link.
- `webapp/public/slices.json` — the index the gallery reads. Starts empty.
- `scripts/publish-slice.ts` — `npm run publish:slice -- <slug>`. Reads `games/<slug>/manifest.json`, upserts an entry into `webapp/public/slices.json`. Run after a successful generation to expose it in the gallery.
- `.github/workflows/deploy-pages.yml` — on push to `main` (paths `webapp/**`) or `workflow_dispatch`: builds `webapp/` and deploys to GitHub Pages via the official `actions/deploy-pages@v4`.
- `vite.config.ts` ships `base: '/PlayGen/'` (override with `VITE_BASE`). For Pages, **enable in repo settings: Pages > Source = "GitHub Actions"**.
- Root `package.json` adds `webapp:dev` / `webapp:build` / `webapp:typecheck` / `publish:slice`.

## What's next (when wiring up for real)

1. End-to-end smoke test: `cp -R templates/basic-platformer games/test-slice/build && cd games/test-slice/build && npm install && npm run preview`, then point `scripts/playtest.ts` at `http://localhost:4173`.
2. `scripts/serve-build.ts` — wraps the per-slice `vite preview` lifecycle so the `playtest` script can start it implicitly when `manifest.playcanvas.publishedUrl` is missing.
3. Wire the planner subagent's prompt to actually emit a valid `manifest.plan` shape (currently it's told to but no schema validation enforces it).
4. Hoist `src/types/playgen.ts` + the instrumentation helpers into a shared `packages/contract/` so templates and webapp can import it instead of duplicating.
5. Editor MCP path: when the cloud editor is the publish target, scene-assembly stops copying templates and drives the MCP server directly.
6. (Webapp) "Run via GitHub Actions" button — `workflow_dispatch` against a `generate.yml` workflow with the premise as input. Requires the user to authenticate; out of scope for v1 but a natural fit for the Author tab.

## Out of scope for v1

- Generative gaussian splats (no production API in 2026)
- Real-device mobile fidelity (BrowserStack/Sauce — defer)
- Audio generation
