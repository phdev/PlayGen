const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

export interface PlanManifest {
  slug: string;
  status: string;
  premise: string;
  designIntent?: { genre: string; mechanics: string };
  concept?: { imagePath: string; panels?: Array<{ id: string; role?: string }> };
  styleGuide?: {
    palette: string[];
    lighting: string;
    perspective: string;
    scale: string;
    mood: string;
    era?: string;
  };
  plan?: {
    template: string;
    title: string;
    oneLineHook: string;
    inputModes: string[];
    controls: Record<string, Array<{ action: string; binding: string }>>;
    levels: Array<{
      id: string;
      name: string;
      description: string;
      durationGoalSec: number;
      mechanics: string[];
    }>;
    loopSteps: Array<{ name: string; control?: string }>;
    winCondition: string;
    loseCondition: string;
  };
  assets: Array<{
    id: string;
    kind: string;
    prompt: string;
    status: string;
  }>;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function normalizeControls(
  raw: unknown,
): Record<string, Array<{ action: string; binding: string }>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, Array<{ action: string; binding: string }>> = {};
  for (const [mode, value] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (Array.isArray(value)) {
      out[mode] = value
        .filter(
          (b): b is { action: string; binding: string } =>
            typeof b === 'object' && b !== null,
        )
        .map((b) => ({
          action: asString((b as { action?: unknown }).action),
          binding: asString((b as { binding?: unknown }).binding),
        }));
    } else if (value && typeof value === 'object') {
      out[mode] = Object.entries(value as Record<string, unknown>).map(
        ([action, binding]) => ({
          action,
          binding: asString(binding),
        }),
      );
    }
  }
  return out;
}

function normalizeLoopSteps(
  raw: unknown,
): Array<{ name: string; control?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const obj = s as Record<string, unknown>;
      const name = asString(obj.name) || asString(obj.id) || asString(obj.triggerEvent);
      if (!name) return null;
      let control: string | undefined;
      const ctl = obj.control;
      if (typeof ctl === 'string') control = ctl;
      else if (obj.inputHint && typeof obj.inputHint === 'object') {
        const hint = obj.inputHint as Record<string, unknown>;
        control = asString(hint.keyboard) || undefined;
      }
      return { name, ...(control ? { control } : {}) };
    })
    .filter((s): s is { name: string; control?: string } => s !== null);
}

function normalizePlan(raw: unknown): PlanManifest['plan'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  const nestedIntent = (p.designIntent ?? {}) as Record<string, unknown>;
  return {
    template: asString(p.template) || 'basic-platformer',
    title: asString(p.title),
    oneLineHook:
      asString(p.oneLineHook) ||
      asString(p.tagline) ||
      asString(p.hook),
    inputModes: Array.isArray(p.inputModes)
      ? (p.inputModes as unknown[]).map((m) => asString(m)).filter(Boolean)
      : [],
    controls: normalizeControls(p.controls),
    levels: Array.isArray(p.levels)
      ? (p.levels as unknown[]).map((lv) => {
          const l = (lv ?? {}) as Record<string, unknown>;
          return {
            id: asString(l.id),
            name: asString(l.name),
            description: asString(l.description),
            durationGoalSec: Number(l.durationGoalSec ?? 0) || 0,
            mechanics: Array.isArray(l.mechanics)
              ? (l.mechanics as unknown[]).map((m) => asString(m)).filter(Boolean)
              : [],
          };
        })
      : [],
    loopSteps: normalizeLoopSteps(p.loopSteps),
    winCondition:
      asString(p.winCondition) || asString(nestedIntent.winCondition),
    loseCondition:
      asString(p.loseCondition) || asString(nestedIntent.loseCondition),
  };
}

function normalizeManifest(raw: unknown): PlanManifest {
  const m = (raw ?? {}) as Record<string, unknown>;
  return {
    slug: asString(m.slug),
    status: asString(m.status),
    premise: asString(m.premise),
    designIntent: m.designIntent as PlanManifest['designIntent'],
    concept: m.concept as PlanManifest['concept'],
    styleGuide: m.styleGuide as PlanManifest['styleGuide'],
    plan: normalizePlan(m.plan),
    assets: Array.isArray(m.assets)
      ? (m.assets as unknown[]).map((a) => {
          const obj = (a ?? {}) as Record<string, unknown>;
          return {
            id: asString(obj.id),
            kind: asString(obj.kind) || 'prop',
            prompt: asString(obj.prompt),
            status: asString(obj.status) || 'pending',
          };
        })
      : [],
  };
}

export async function fetchPlan(slug: string): Promise<PlanManifest | null> {
  const res = await fetch(`${BASE}/plans/${slug}.json`, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`plan ${res.status}`);
  const raw = (await res.json()) as unknown;
  return normalizeManifest(raw);
}
