export const REPO = 'phdev/PlayGen';
export const WORKFLOW = 'generate.yml';
export const ACTIONS_URL = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;

const PAT_KEY = 'playgen.gh_pat';

export function getPat(): string {
  return localStorage.getItem(PAT_KEY) ?? '';
}

export function savePat(pat: string): void {
  if (pat) localStorage.setItem(PAT_KEY, pat);
  else localStorage.removeItem(PAT_KEY);
}

export interface DispatchOptions {
  pat: string;
  premise: string;
  modes: string[];
}

export async function dispatchGenerate(opts: DispatchOptions): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          premise: opts.premise,
          modes: opts.modes.join(','),
        },
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub dispatch ${res.status}: ${text}`);
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

export async function listRecentRuns(pat: string): Promise<RunSummary[]> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=5`,
    {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
      },
    },
  );
  if (!res.ok) throw new Error(`GitHub runs ${res.status}`);
  const json = (await res.json()) as {
    workflow_runs: Array<{
      id: number;
      status: string;
      conclusion: string | null;
      html_url: string;
      created_at: string;
      display_title: string;
    }>;
  };
  return json.workflow_runs.map((r) => ({
    id: r.id,
    status: r.status,
    conclusion: r.conclusion,
    htmlUrl: r.html_url,
    createdAt: r.created_at,
    displayTitle: r.display_title,
  }));
}
