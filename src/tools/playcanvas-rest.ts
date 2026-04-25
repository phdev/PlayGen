import { promises as fs } from 'node:fs';
import path from 'node:path';

const API_BASE = process.env.PLAYCANVAS_API_BASE ?? 'https://playcanvas.com/api';

export interface UploadAssetOptions {
  filePath: string;
  name?: string;
  projectId?: string;
  branchId?: string;
  parentFolderId?: string;
  preload?: boolean;
}

export interface PlayCanvasAsset {
  id: number | string;
  name: string;
  type?: string;
  size?: number;
  branchId?: string;
  file?: { url?: string; filename?: string; size?: number };
}

export async function uploadAsset(
  opts: UploadAssetOptions,
): Promise<PlayCanvasAsset> {
  const projectId = opts.projectId ?? process.env.PLAYCANVAS_PROJECT_ID;
  if (!projectId) {
    throw new Error('projectId / PLAYCANVAS_PROJECT_ID is required');
  }

  const fileBuf = await fs.readFile(opts.filePath);
  const fileName = opts.name ?? path.basename(opts.filePath);

  const form = new FormData();
  form.set('name', fileName);
  form.set('project', projectId);
  if (opts.branchId) form.set('branchId', opts.branchId);
  if (opts.parentFolderId) form.set('parent', opts.parentFolderId);
  if (opts.preload !== undefined) {
    form.set('preload', opts.preload ? 'true' : 'false');
  }
  form.set('file', new Blob([new Uint8Array(fileBuf)]), fileName);

  const res = await fetch(`${API_BASE}/assets`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    throw new Error(`playcanvas POST /assets ${res.status}: ${await safeText(res)}`);
  }
  return (await res.json()) as PlayCanvasAsset;
}

export async function listAssets(
  projectId?: string,
  branchId?: string,
): Promise<PlayCanvasAsset[]> {
  const pid = projectId ?? process.env.PLAYCANVAS_PROJECT_ID;
  if (!pid) throw new Error('projectId / PLAYCANVAS_PROJECT_ID is required');
  const url = new URL(`${API_BASE}/projects/${pid}/assets`);
  if (branchId) url.searchParams.set('branchId', branchId);
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`playcanvas GET assets ${res.status}: ${await safeText(res)}`);
  }
  const json = (await res.json()) as
    | PlayCanvasAsset[]
    | { result?: PlayCanvasAsset[] };
  return Array.isArray(json) ? json : (json.result ?? []);
}

export async function deleteAsset(
  assetId: number | string,
  branchId?: string,
): Promise<void> {
  const url = new URL(`${API_BASE}/assets/${assetId}`);
  if (branchId) url.searchParams.set('branchId', branchId);
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`playcanvas DELETE asset ${res.status}: ${await safeText(res)}`);
  }
}

function authHeaders(): HeadersInit {
  const apiKey = process.env.PLAYCANVAS_API_KEY;
  if (!apiKey) throw new Error('PLAYCANVAS_API_KEY is not set');
  return { Authorization: `Bearer ${apiKey}` };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
