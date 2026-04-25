# PlayGen

Premise -> playable PlayCanvas vertical slice, validated end-to-end across keyboard/mouse, touch, and gamepad.

## Quick start

```bash
npm install
cp .env.example .env  # fill in keys
npm run validate-env
```

## Stack

- Orchestration: Claude Agent SDK
- Concept image: gpt-image-2 (FLUX.2 fallback)
- Image -> rigged glTF: Meshy
- Splat handling: `@playcanvas/splat-transform` (photogrammetry-only for v1; voxel collision via `.voxel.json`)
- Scene assembly: `playcanvas/editor-mcp-server` + REST multipart for binary asset upload
- Playtest harness: Playwright (chromium, GPU on) + `window.__playgen` instrumentation contract

See `CLAUDE.md` for architecture, decisions, and the v1 build order.
