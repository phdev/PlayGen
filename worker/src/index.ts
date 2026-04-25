interface Env {
  GH_DISPATCH_PAT: string;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGINS: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW: string;
}

const GITHUB_API = 'https://api.github.com';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANALYSIS_MODEL = 'claude-haiku-4-5-20251001';
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
    genre?: unknown;
    mechanics?: unknown;
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
  const genre =
    typeof body.genre === 'string' ? body.genre.trim().slice(0, 200) : '';
  const mechanics =
    typeof body.mechanics === 'string'
      ? body.mechanics.trim().slice(0, 1000)
      : '';

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
  if (genre) inputs.genre = genre;
  if (mechanics) inputs.mechanics = mechanics;

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

  const encoder = new TextEncoder();
  const sseFrame = (event: string, data: unknown): Uint8Array =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const closeOnce = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const enqueueSafe = (chunk: Uint8Array): void => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      const ticker = setInterval(() => {
        enqueueSafe(sseFrame('ping', { ts: Date.now() }));
      }, 5000);

      enqueueSafe(sseFrame('start', { prompt, model: 'gpt-image-2' }));

      const imageJob = (async (): Promise<void> => {
        try {
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
            enqueueSafe(
              sseFrame('error', { status: res.status, detail: text }),
            );
            return;
          }

          const json = (await res.json()) as {
            data?: Array<{ b64_json?: string }>;
          };
          const item = json.data?.[0];
          if (!item?.b64_json) {
            enqueueSafe(sseFrame('error', { detail: 'no image returned' }));
            return;
          }

          enqueueSafe(
            sseFrame('image', {
              b64_json: item.b64_json,
              prompt,
              model: 'gpt-image-2',
            }),
          );
        } catch (err: unknown) {
          enqueueSafe(
            sseFrame('error', {
              detail: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      })();

      const analysisJob = (async (): Promise<void> => {
        if (!env.ANTHROPIC_API_KEY) return;
        try {
          const analysis = await analyzeIntent(prompt, env.ANTHROPIC_API_KEY);
          if (analysis) enqueueSafe(sseFrame('analysis', analysis));
        } catch {
          // analysis is optional — don't fail the whole stream
        }
      })();

      Promise.all([imageJob, analysisJob]).finally(() => {
        clearInterval(ticker);
        closeOnce();
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...cors,
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
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

async function analyzeIntent(
  prompt: string,
  apiKey: string,
): Promise<{ genre: string; mechanics: string } | null> {
  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      max_tokens: 300,
      system:
        'Extract the intended video game genre and core mechanics from the user prompt. Respond with ONLY a JSON object on a single line, no commentary, no code fences: {"genre":"<one short phrase>","mechanics":"<comma-separated 3-6 mechanic names>"}. If the prompt explicitly references another game (e.g. "mechanics from Kerbal Space Program"), expand it to that game\'s actual mechanics.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (json.content ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
  const match = text.match(/\{[^]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as {
      genre?: unknown;
      mechanics?: unknown;
    };
    const genre =
      typeof parsed.genre === 'string' ? parsed.genre.trim() : '';
    const mechanics =
      typeof parsed.mechanics === 'string' ? parsed.mechanics.trim() : '';
    if (!genre && !mechanics) return null;
    return { genre, mechanics };
  } catch {
    return null;
  }
}
