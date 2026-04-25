import type { HarnessSession } from '../runner.js';
import { waitForReady } from '../runner.js';
import { judge, type JudgeResult } from '../judge.js';

export async function runBoot(
  session: HarnessSession,
  timeoutMs = 30_000,
): Promise<JudgeResult> {
  try {
    await waitForReady(session, timeoutMs);
  } catch (err: unknown) {
    return {
      verdict: 'fail',
      reason: `boot timed out: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return judge(session, 'boot', {
    requireReady: true,
    forbidErrors: true,
  });
}
