# PlayGen

Premise → playable PlayCanvas vertical slice, validated end-to-end across keyboard/mouse, touch, and gamepad. **Runs entirely in the cloud** via GitHub Actions; the webapp on Pages is the author/gallery shell.

Live: https://phdev.github.io/PlayGen/

## Cloud usage

1. Set repo secrets (Settings → Secrets and variables → Actions): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MESHY_API_KEY`, `PLAYCANVAS_API_KEY`, `PLAYCANVAS_PROJECT_ID`.
2. Open the webapp, paste a GitHub PAT (scope `repo` for private repos, `public_repo` for public), type a premise, click **Generate in cloud**.
3. The `generate.yml` workflow runs the orchestrator, builds the slice, commits it under `webapp/public/slices/<slug>/`, and re-deploys Pages. Total time ~5–15 min.
4. Gallery refreshes automatically once the workflow finishes.

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
