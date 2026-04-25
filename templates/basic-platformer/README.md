# basic-platformer template

Minimal PlayCanvas vertical-slice skeleton with `window.__playgen` wired in. Used by the `scene-assembly` subagent as the starting point for every generated game.

## What it ships with

- Top-down camera, ground plane, player cube, one pickup sphere, one goal pad
- Three input modes wired to drive the same player:
  - **Keyboard:** WASD / arrow keys
  - **Gamepad:** left analog stick + dpad (standard mapping)
  - **Touch:** drag-anywhere virtual joystick
- Full `window.__playgen` contract: `ready`, `isPlaying`, `score`, `level`, `timeSec`, `lastError`, `events[]`
- Events emitted: `pickup`, `win`, `lose`, `error`

## Usage

```bash
npm install
npm run dev      # Vite dev server on :5173
npm run build    # Production bundle in dist/
npm run preview  # Serves dist/ on :4173
```

## Notes

`src/playgen.ts` is a hand-mirrored copy of the parent's `src/types/playgen.ts` and `src/harness/instrumentation.ts`. **It must stay in sync** — the harness reads `window.__playgen` and rejects games that don't expose the contract.

The scene-assembly subagent copies this directory into `games/<slug>/build/` and edits `src/main.ts` to:
- Replace placeholder primitives with imported GLB assets
- Adjust the controls per `manifest.plan.controls`
- Tune mechanics, win/lose conditions, level layout
