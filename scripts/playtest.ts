import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { launchHarness } from '../src/harness/runner.js';
import { runBoot } from '../src/harness/scenarios/boot.js';
import { runGoldenPath } from '../src/harness/scenarios/golden-path.js';
import type { JudgeResult } from '../src/harness/judge.js';
import {
  gameDir,
  loadManifest,
  updateManifest,
} from '../src/orchestrator/manifest.js';
import type {
  InputMode,
  PlaytestRun,
  Verdict,
} from '../src/types/manifest.js';

function judgeToRun(
  scenario: string,
  inputMode: InputMode,
  durationSec: number,
  j: JudgeResult,
): PlaytestRun {
  return {
    id: randomUUID().slice(0, 8),
    scenario,
    inputMode,
    verdict: j.verdict,
    durationSec,
    finalState: j.finalState,
    screenshots: j.screenshotPath ? [j.screenshotPath] : [],
    notes: j.reason,
  };
}

function rollUp(runs: PlaytestRun[]): Verdict {
  if (runs.length === 0) return 'inconclusive';
  if (runs.some((r) => r.verdict === 'fail')) return 'fail';
  if (runs.every((r) => r.verdict === 'pass')) return 'pass';
  return 'inconclusive';
}

async function main(): Promise<void> {
  const [slug] = process.argv.slice(2);
  if (!slug) {
    process.stderr.write('Usage: tsx scripts/playtest.ts <slug>\n');
    process.exit(1);
  }

  const manifest = await loadManifest(slug);
  const url = manifest.playcanvas?.publishedUrl;
  if (!url) {
    throw new Error(
      `manifest.playcanvas.publishedUrl is not set for slug=${slug}`,
    );
  }
  const modes: InputMode[] =
    manifest.plan?.inputModes ?? ['keyboard', 'touch', 'gamepad'];
  const screenshotDir = path.join(gameDir(slug), 'screenshots');
  const runs: PlaytestRun[] = [];

  for (const mode of modes) {
    const session = await launchHarness({
      url,
      inputMode: mode,
      screenshotDir,
    });
    try {
      const bootStart = Date.now();
      const boot = await runBoot(session);
      runs.push(
        judgeToRun('boot', mode, (Date.now() - bootStart) / 1000, boot),
      );
      if (boot.verdict !== 'pass') continue;

      const goldenStart = Date.now();
      const controls = manifest.plan?.controls?.[mode] ?? [];
      const golden = await runGoldenPath(session, { controls });
      runs.push(
        judgeToRun(
          'golden-path',
          mode,
          (Date.now() - goldenStart) / 1000,
          golden,
        ),
      );
    } finally {
      await session.close();
    }
  }

  const overall = rollUp(runs);

  await updateManifest(slug, (m) => ({
    playtests: [...m.playtests, ...runs],
    status: overall === 'pass' ? 'complete' : 'fixing',
  }));

  process.stdout.write(
    JSON.stringify({ overall, runs }, null, 2) + '\n',
  );
  process.exit(overall === 'pass' ? 0 : 1);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `playtest failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
