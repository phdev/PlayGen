export interface SliceEntry {
  slug: string;
  title?: string;
  premise: string;
  genre?: string;
  gameplayLoop?: string;
  status: string;
  publishedUrl?: string;
  thumbnailUrl?: string;
  createdAt?: string;
}

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

export async function fetchSlices(): Promise<SliceEntry[]> {
  const res = await fetch(`${BASE}/slices.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`slices.json: ${res.status}`);
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) {
    throw new Error('slices.json must be an array');
  }
  return json as SliceEntry[];
}
