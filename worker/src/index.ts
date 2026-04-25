interface Env {
  GH_DISPATCH_PAT: string;
  OPENAI_API_KEY: string;
  ALLOWED_ORIGINS: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW: string;
}

const GITHUB_API = 'https://api.github.com';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const MAX_PREMISE_LEN = 500;
const MAX_CONCEPT_PROMPT_LEN = 2000;

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
    if (url.pathname === '/concept' && req.method === 'POST') {
      return concept(req, env, cors);
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
  let body: {
    premise?: unknown;
    modes?: unknown;
    conceptPrompt?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { error: 'invalid json' }, cors);
  }

  const premise =
    typeof body.premise === 'string' ? body.premise.trim() : '';
  const modesRaw =
    typeof body.modes === 'string' && body.modes.trim().length > 0
      ? body.modes.trim()
      : 'keyboard,touch,gamepad';
  const conceptPrompt =
    typeof body.conceptPrompt === 'string' ? body.conceptPrompt.trim() : '';

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
  if (conceptPrompt.length > MAX_CONCEPT_PROMPT_LEN) {
    return jsonResponse(
      400,
      { error: `concept prompt too long (max ${MAX_CONCEPT_PROMPT_LEN})` },
      cors,
    );
  }

  const inputs: Record<string, string> = { premise, modes: modesRaw };
  if (conceptPrompt) inputs.concept_prompt = conceptPrompt;

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
      body: JSON.stringify({ ref: 'main', inputs }),
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

async function concept(
  req: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  if (!env.OPENAI_API_KEY) {
    return jsonResponse(
      503,
      { error: 'OPENAI_API_KEY not configured on the worker' },
      cors,
    );
  }
  let body: { prompt?: unknown };
  try {
    body = (await req.json()) as { prompt?: unknown };
  } catch {
    return jsonResponse(400, { error: 'invalid json' }, cors);
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return jsonResponse(400, { error: 'prompt required' }, cors);
  if (prompt.length > MAX_CONCEPT_PROMPT_LEN) {
    return jsonResponse(
      400,
      { error: `prompt too long (max ${MAX_CONCEPT_PROMPT_LEN})` },
      cors,
    );
  }

  const res = await fetch(OPENAI_IMAGES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      size: '1024x1024',
      quality: 'low',
      n: 1,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return jsonResponse(
      res.status,
      { error: 'openai image gen failed', detail: text },
      cors,
    );
  }

  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const item = json.data?.[0];
  if (!item?.b64_json) {
    return jsonResponse(502, { error: 'no image returned' }, cors);
  }

  const bytes = Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    status: 200,
    headers: {
      ...cors,
      'content-type': 'image/png',
      'content-length': String(bytes.byteLength),
      'cache-control': 'no-store',
      'x-playgen-model': 'gpt-image-2',
      'x-playgen-prompt': encodeURIComponent(prompt),
    },
  });
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
