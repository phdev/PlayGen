const REPO = 'phdev/PlayGen';
const WORKFLOW = 'generate.yml';

export const ACTIONS_URL = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;

const DISPATCH_BASE = (
  import.meta.env.VITE_DISPATCH_URL as string | undefined
)?.replace(/\/$/, '');

export function isDispatchConfigured(): boolean {
  return Boolean(DISPATCH_BASE);
}

export interface DispatchOptions {
  premise: string;
  modes: string[];
}

export async function dispatchGenerate(opts: DispatchOptions): Promise<void> {
  if (!DISPATCH_BASE) {
    throw new Error(
      'Cloud generation is not configured (VITE_DISPATCH_URL is unset).',
    );
  }
  const res = await fetch(`${DISPATCH_BASE}/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      premise: opts.premise,
      modes: opts.modes.join(','),
    }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    throw new Error(
      j.error
        ? `${j.error}${j.detail ? `: ${j.detail}` : ''}`
        : `dispatch failed ${res.status}`,
    );
  }
}

export interface RunSummary {
  id: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  displayTitle: string;
}

export async function listRecentRuns(): Promise<RunSummary[]> {
  if (!DISPATCH_BASE) return [];
  const res = await fetch(`${DISPATCH_BASE}/runs`);
  if (!res.ok) throw new Error(`runs ${res.status}`);
  const j = (await res.json()) as { runs?: RunSummary[] };
  return j.runs ?? [];
}
