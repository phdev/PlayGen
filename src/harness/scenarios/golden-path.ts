import {
  readPlayGenState,
  waitForReady,
  type HarnessSession,
} from '../runner.js';
import { judge, type JudgeResult } from '../judge.js';
import type { ControlBinding } from '../../types/manifest.js';
import * as kbd from '../inputs/keyboard.js';
import * as touch from '../inputs/touch.js';
import * as gpd from '../inputs/gamepad.js';
import { STANDARD_BUTTONS } from '../inputs/gamepad.js';

export interface GoldenPathOptions {
  controls: ControlBinding[];
  durationSec?: number;
  tickIntervalMs?: number;
}

export async function runGoldenPath(
  session: HarnessSession,
  opts: GoldenPathOptions,
): Promise<JudgeResult> {
  await waitForReady(session, 30_000);

  const dur = (opts.durationSec ?? 15) * 1000;
  const tick = opts.tickIntervalMs ?? 250;
  const start = Date.now();

  while (Date.now() - start < dur) {
    await driveOneTick(session, opts.controls);
    await session.page.waitForTimeout(tick);
    const state = await readPlayGenState(session);
    if (
      state?.events.some((e) => e.kind === 'win' || e.kind === 'lose')
    ) {
      break;
    }
  }

  return judge(session, 'golden-path', {
    requireReady: true,
    requireProgress: true,
    forbidErrors: true,
  });
}

async function driveOneTick(
  session: HarnessSession,
  controls: ControlBinding[],
): Promise<void> {
  if (controls.length === 0) {
    await session.page.waitForTimeout(50);
    return;
  }
  const action = controls[Math.floor(Math.random() * controls.length)]!;

  switch (session.inputMode) {
    case 'keyboard':
      await kbd.tapKey(session.page, action.binding);
      return;
    case 'touch': {
      const parts = action.binding.split(',').map((s) => Number(s.trim()));
      const valid = parts.length === 2 && parts.every((n) => Number.isFinite(n));
      const x = valid ? parts[0]! : 200;
      const y = valid ? parts[1]! : 400;
      await touch.tap(session.page, x, y);
      return;
    }
    case 'gamepad': {
      const map = STANDARD_BUTTONS as Record<string, number>;
      const btn = map[action.binding] ?? STANDARD_BUTTONS.A;
      await gpd.tap(session.page, btn);
      return;
    }
  }
}
