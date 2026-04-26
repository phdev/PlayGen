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

export async function fetchPlan(slug: string): Promise<PlanManifest | null> {
  const res = await fetch(`${BASE}/plans/${slug}.json`, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`plan ${res.status}`);
  return (await res.json()) as PlanManifest;
}
