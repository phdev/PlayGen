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
  conceptPrompt?: string;
  genre?: string;
  mechanics?: string;
  phase?: 'all' | 'plan' | 'build';
  slug?: string;
  editedPlan?: string;
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
      ...(opts.conceptPrompt ? { conceptPrompt: opts.conceptPrompt } : {}),
      ...(opts.genre ? { genre: opts.genre } : {}),
      ...(opts.mechanics ? { mechanics: opts.mechanics } : {}),
      ...(opts.phase ? { phase: opts.phase } : {}),
      ...(opts.slug ? { slug: opts.slug } : {}),
      ...(opts.editedPlan ? { editedPlan: opts.editedPlan } : {}),
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

export interface ConceptResult {
  imageUrl: string;
  prompt: string;
  model: string;
  analysis?: { genre: string; mechanics: string };
}

export async function generateConcept(
  prompt: string,
  onAnalysis?: (analysis: { genre: string; mechanics: string }) => void,
): Promise<ConceptResult> {
  if (!DISPATCH_BASE) {
    throw new Error(
      'Concept generation is not configured (VITE_DISPATCH_URL is unset).',
    );
  }
  const res = await fetch(`${DISPATCH_BASE}/concept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    throw new Error(
      j.error
        ? `${j.error}${j.detail ? `: ${j.detail}` : ''}`
        : `concept failed ${res.status}`,
    );
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('text/event-stream') || !res.body) {
    // Legacy binary fallback path (kept for any older worker version).
    const blob = await res.blob();
    return {
      imageUrl: URL.createObjectURL(blob),
      prompt,
      model: res.headers.get('x-playgen-model') ?? 'gpt-image-2',
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pendingAnalysis: { genre: string; mechanics: string } | undefined;
  let resolved: ConceptResult | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = parseSseEvent(raw);
      if (!event) continue;
      if (event.event === 'ping' || event.event === 'start') continue;
      if (event.event === 'error') {
        const detail =
          (event.data && (event.data.detail as string)) ?? 'unknown error';
        throw new Error(detail);
      }
      if (event.event === 'analysis' && event.data) {
        const genre =
          typeof event.data.genre === 'string' ? event.data.genre : '';
        const mechanics =
          typeof event.data.mechanics === 'string'
            ? event.data.mechanics
            : '';
        pendingAnalysis = { genre, mechanics };
        if (resolved) resolved.analysis = pendingAnalysis;
        onAnalysis?.(pendingAnalysis);
        continue;
      }
      if (event.event === 'image') {
        const b64 = (event.data?.b64_json as string) ?? '';
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'image/png' });
        resolved = {
          imageUrl: URL.createObjectURL(blob),
          prompt: (event.data?.prompt as string) ?? prompt,
          model: (event.data?.model as string) ?? 'gpt-image-2',
          analysis: pendingAnalysis,
        };
      }
    }
  }

  if (resolved) return resolved;
  throw new Error('concept stream ended without an image event');
}

function parseSseEvent(
  raw: string,
): { event: string; data: Record<string, unknown> | null } | null {
  if (!raw.trim()) return null;
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  let data: Record<string, unknown> | null = null;
  if (dataLines.length > 0) {
    try {
      data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
    } catch {
      data = null;
    }
  }
  return { event, data };
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
