import { promises as fs } from 'node:fs';
import path from 'node:path';

const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';

export interface MeshyImageTo3DOptions {
  imagePath?: string;
  imageUrl?: string;
  outputPath: string;
  topology?: 'triangle' | 'quad';
  targetPolycount?: number;
  enablePbr?: boolean;
  shouldRemesh?: boolean;
  symmetryMode?: 'off' | 'on' | 'auto';
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface MeshyResult {
  taskId: string;
  glbPath: string;
  thumbnailUrl?: string;
}

type MeshyStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'EXPIRED';

interface MeshyTask {
  id: string;
  status: MeshyStatus;
  progress?: number;
  model_urls?: { glb?: string; fbx?: string; usdz?: string };
  thumbnail_url?: string;
  task_error?: { message: string };
}

export async function generateMeshFromImage(
  opts: MeshyImageTo3DOptions,
): Promise<MeshyResult> {
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) throw new Error('MESHY_API_KEY is not set');

  const imageRef =
    opts.imageUrl ?? (opts.imagePath ? await readAsDataUrl(opts.imagePath) : null);
  if (!imageRef) throw new Error('meshy: imagePath or imageUrl is required');

  const createRes = await fetch(`${MESHY_BASE}/image-to-3d`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_url: imageRef,
      enable_pbr: opts.enablePbr ?? true,
      should_remesh: opts.shouldRemesh ?? true,
      topology: opts.topology ?? 'triangle',
      target_polycount: opts.targetPolycount ?? 30_000,
      symmetry_mode: opts.symmetryMode ?? 'auto',
    }),
  });

  if (!createRes.ok) {
    throw new Error(`meshy create ${createRes.status}: ${await safeText(createRes)}`);
  }

  const created = (await createRes.json()) as { result: string };
  const taskId = created.result;

  const final = await pollTask(
    apiKey,
    taskId,
    opts.pollIntervalMs ?? 5_000,
    opts.timeoutMs ?? 5 * 60_000,
  );

  if (final.status !== 'SUCCEEDED') {
    throw new Error(
      `meshy task ${taskId} ended ${final.status}: ${final.task_error?.message ?? 'no error message'}`,
    );
  }

  const glbUrl = final.model_urls?.glb;
  if (!glbUrl) throw new Error(`meshy task ${taskId} succeeded with no GLB URL`);

  await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });
  await downloadTo(glbUrl, opts.outputPath);

  return { taskId, glbPath: opts.outputPath, thumbnailUrl: final.thumbnail_url };
}

async function pollTask(
  apiKey: string,
  taskId: string,
  intervalMs: number,
  timeoutMs: number,
): Promise<MeshyTask> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MESHY_BASE}/image-to-3d/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`meshy poll ${res.status}: ${await safeText(res)}`);
    }
    const task = (await res.json()) as MeshyTask;
    if (
      task.status === 'SUCCEEDED' ||
      task.status === 'FAILED' ||
      task.status === 'CANCELED' ||
      task.status === 'EXPIRED'
    ) {
      return task;
    }
    await sleep(intervalMs);
  }
  throw new Error(`meshy task ${taskId} timed out after ${timeoutMs}ms`);
}

async function downloadTo(url: string, target: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
  await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
}

async function readAsDataUrl(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase() || 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
