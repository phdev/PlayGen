import { readPlayGenState, snapshot, type HarnessSession } from './runner.js';
import type { PlayGenState, PlayGenEventKind } from '../types/playgen.js';
import type { Verdict } from '../types/manifest.js';

export interface JudgeCriteria {
  requireReady?: boolean;
  requireProgress?: boolean;
  expectEvent?: PlayGenEventKind;
  expectLoopSteps?: string[];
  minScore?: number;
  forbidErrors?: boolean;
}

export interface JudgeResult {
  verdict: Verdict;
  reason: string;
  finalState?: PlayGenState;
  screenshotPath?: string;
}

export async function judge(
  session: HarnessSession,
  label: string,
  criteria: JudgeCriteria,
): Promise<JudgeResult> {
  const state = await readPlayGenState(session);
  const screenshotPath = await snapshot(session, label);

  if (!state) {
    return {
      verdict: 'inconclusive',
      reason:
        'window.__playgen was not initialized; the instrumentation contract is missing',
      screenshotPath,
    };
  }

  if (criteria.requireReady && !state.ready) {
    return failure('game never reported ready', state, screenshotPath);
  }
  if (criteria.forbidErrors && state.lastError) {
    return failure(`runtime error: ${state.lastError}`, state, screenshotPath);
  }
  if (criteria.requireProgress && state.events.length === 0) {
    return failure('no progress events emitted', state, screenshotPath);
  }
  if (
    criteria.expectEvent !== undefined &&
    !state.events.some((e) => e.kind === criteria.expectEvent)
  ) {
    return failure(
      `expected event "${criteria.expectEvent}" not emitted`,
      state,
      screenshotPath,
    );
  }
  if (criteria.expectLoopSteps && criteria.expectLoopSteps.length > 0) {
    const firedSteps = new Set(
      state.events
        .filter((e) => e.kind === 'progress')
        .map((e) => {
          const p = e.payload as { step?: string } | undefined;
          return p?.step;
        })
        .filter((s): s is string => Boolean(s)),
    );
    const missing = criteria.expectLoopSteps.filter((s) => !firedSteps.has(s));
    if (missing.length > 0) {
      return failure(
        `loop steps not exercised: ${missing.join(', ')}`,
        state,
        screenshotPath,
      );
    }
  }
  if (criteria.minScore !== undefined && state.score < criteria.minScore) {
    return failure(
      `score ${state.score} below minimum ${criteria.minScore}`,
      state,
      screenshotPath,
    );
  }

  return {
    verdict: 'pass',
    reason: 'all criteria satisfied',
    finalState: state,
    screenshotPath,
  };
}

function failure(
  reason: string,
  finalState: PlayGenState,
  screenshotPath?: string,
): JudgeResult {
  return { verdict: 'fail', reason, finalState, screenshotPath };
}
