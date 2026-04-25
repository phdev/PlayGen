# PlayGen

Premise → playable PlayCanvas vertical slice, validated end-to-end across keyboard/mouse, touch, and gamepad. **Runs entirely in the cloud** via GitHub Actions; the webapp on Pages is the author/gallery shell.

Live: https://phdev.github.io/PlayGen/

## Cloud usage

End-state UX: visitor types a premise on the webapp, clicks **Generate**, slice appears in the gallery ~5–15 min later. No PAT input, no key paste.

**One-time setup (repo owner):**

1. **Generation secrets** — Settings → Secrets and variables → Actions:
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `MESHY_API_KEY`
   - `PLAYCANVAS_API_KEY`, `PLAYCANVAS_PROJECT_ID` (optional — engine-only path doesn't need them)
2. **Dispatch worker secrets** (so the webapp can trigger generation without exposing a PAT):
   - `CLOUDFLARE_API_TOKEN` — from Cloudflare dashboard, "Edit Cloudflare Workers" template (free)
   - `GH_DISPATCH_PAT` — a GitHub PAT with `workflow` scope (+ `repo` if private)
3. Push `worker/**` (or run `Deploy worker` workflow manually). It deploys to `https://playgen-dispatch.<sub>.workers.dev` and writes `GH_DISPATCH_PAT` as a Worker secret. Copy the URL from the run logs.
4. **Wire webapp to worker** — set the URL as a repo *variable*:
   ```
   gh variable set VITE_DISPATCH_URL --body 'https://playgen-dispatch.<sub>.workers.dev'
   ```
5. Trigger `Deploy webapp to GitHub Pages` (push or workflow_dispatch) to redeploy with the URL baked in.

After that, anyone with the webapp URL can generate. Visitors never touch any keys.

## Local usage (optional)

```bash
npm install
cp .env.example .env   # same keys as the secrets above
npm run validate-env
npm run new -- "tiny-island survival, dawn lighting, low-poly"
npm run publish:slice -- <slug>   # exposes it in the gallery
```

## Stack

- Orchestration: Claude Agent SDK
- Concept image: gpt-image-2 (override via `PLAYGEN_IMAGE_MODEL`)
- Image → rigged glTF: Meshy
- Splat collision: `@playcanvas/splat-transform` `.voxel.json` (photogrammetry input; generative splats deliberately out of scope for v1)
- Scene assembly: engine-only template build (`templates/basic-platformer/`) — Vite + `playcanvas` v2; cloud-editor MCP path supported but not used in CI
- Playtest harness: Playwright (chromium, GPU on) + `window.__playgen` instrumentation contract; auto-spawns `vite preview` when no published URL is set
- Webapp: Vite + React 19 static site, GitHub Pages

See `CLAUDE.md` for architecture, decisions, and the v1 build order.
