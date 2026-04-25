import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Manifest, ManifestStatus } from '../types/manifest.js';

export const GAMES_ROOT = path.resolve(process.cwd(), 'games');

export function gameDir(slug: string): string {
  return path.join(GAMES_ROOT, slug);
}

export function manifestPath(slug: string): string {
  return path.join(gameDir(slug), 'manifest.json');
}

export function newSlug(premise: string): string {
  const stub = premise
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = randomUUID().slice(0, 6);
  return stub ? `${stub}-${suffix}` : `slice-${suffix}`;
}

export async function createManifest(
  premise: string,
  slug: string = newSlug(premise),
): Promise<Manifest> {
  const now = new Date().toISOString();
  const manifest: Manifest = {
    slug,
    createdAt: now,
    updatedAt: now,
    status: 'init',
    premise,
    assets: [],
    splats: [],
    playtests: [],
    errors: [],
  };
  await fs.mkdir(path.join(gameDir(slug), 'assets'), { recursive: true });
  await fs.mkdir(path.join(gameDir(slug), 'screenshots'), { recursive: true });
  await saveManifest(manifest);
  return manifest;
}

export async function loadManifest(slug: string): Promise<Manifest> {
  const raw = await fs.readFile(manifestPath(slug), 'utf8');
  return JSON.parse(raw) as Manifest;
}

export async function saveManifest(manifest: Manifest): Promise<void> {
  manifest.updatedAt = new Date().toISOString();
  const target = manifestPath(manifest.slug);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.rename(tmp, target);
}

export async function updateManifest(
  slug: string,
  patch:
    | Partial<Manifest>
    | ((current: Manifest) => Partial<Manifest> | Manifest),
): Promise<Manifest> {
  const current = await loadManifest(slug);
  const computed = typeof patch === 'function' ? patch(current) : patch;
  const next: Manifest = { ...current, ...computed };
  await saveManifest(next);
  return next;
}

export async function setStatus(
  slug: string,
  status: ManifestStatus,
): Promise<Manifest> {
  return updateManifest(slug, { status });
}

export async function recordError(
  slug: string,
  stage: ManifestStatus,
  message: string,
  details?: unknown,
): Promise<Manifest> {
  return updateManifest(slug, (m) => ({
    errors: [
      ...m.errors,
      { t: new Date().toISOString(), stage, message, details },
    ],
  }));
}
