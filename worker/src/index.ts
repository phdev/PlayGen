interface Env {
  GH_DISPATCH_PAT: string;
  ALLOWED_ORIGINS: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW: string;
}

const GITHUB_API = 'https://api.github.com';
const MAX_PREMISE_LEN = 500;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const isAllowed = allowed.includes(origin);
    const cors = isAllowed ? corsHeaders(origin) : {};

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (!isAllowed) {
      return jsonResponse(403, { error: 'origin not allowed' }, {});
    }

    const url = new URL(req.url);
    if (url.pathname === '/dispatch' && req.method === 'POST') {
      return dispatch(req, env, cors);
    }
    if (url.pathname === '/runs' && req.method === 'GET') {
      return listRuns(env, cors);
    }
    return jsonResponse(404, { error: 'not found' }, cors);
  },
};

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

async function dispatch(
  req: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  let body: { premise?: unknown; modes?: unknown };
  try {
    body = (await req.json()) as { premise?: unknown; modes?: unknown };
  } catch {
    return jsonResponse(400, { error: 'invalid json' }, cors);
  }

  const premise =
    typeof body.premise === 'string' ? body.premise.trim() : '';
  const modesRaw =
    typeof body.modes === 'string' && body.modes.trim().length > 0
      ? body.modes.trim()
      : 'keyboard,touch,gamepad';

  if (!premise) {
    return jsonResponse(400, { error: 'premise required' }, cors);
  }
  if (premise.length > MAX_PREMISE_LEN) {
    return jsonResponse(
      400,
      { error: `premise too long (max ${MAX_PREMISE_LEN})` },
      cors,
    );
  }

  const res = await fetch(
    `${GITHUB_API}/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GH_DISPATCH_PAT}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'playgen-dispatch-worker',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { premise, modes: modesRaw },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    return jsonResponse(
      res.status,
      { error: 'github dispatch failed', detail: text },
      cors,
    );
  }
  return jsonResponse(202, { ok: true }, cors);
}

async function listRuns(
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const res = await fetch(
    `${GITHUB_API}/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/runs?per_page=5`,
    {
      headers: {
        Authorization: `Bearer ${env.GH_DISPATCH_PAT}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'playgen-dispatch-worker',
      },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    return jsonResponse(
      res.status,
      { error: 'github runs failed', detail: text },
      cors,
    );
  }
  const json = (await res.json()) as {
    workflow_runs?: Array<{
      id: number;
      status: string;
      conclusion: string | null;
      html_url: string;
      created_at: string;
      display_title: string;
    }>;
  };
  const runs = (json.workflow_runs ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    conclusion: r.conclusion,
    htmlUrl: r.html_url,
    createdAt: r.created_at,
    displayTitle: r.display_title,
  }));
  return jsonResponse(
    200,
    { runs },
    { ...cors, 'cache-control': 'no-store' },
  );
}

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}
