import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface VoxelCollisionOptions {
  inputPath: string;
  outputPath: string;
  voxelResolution?: number;
  opacityCutoff?: number;
}

export interface VoxelCollisionResult {
  jsonPath: string;
  binPath: string;
  voxelResolution: number;
  opacityCutoff: number;
}

const DEFAULT_RESOLUTION = 0.05;
const DEFAULT_OPACITY = 0.1;

export async function generateVoxelCollision(
  opts: VoxelCollisionOptions,
): Promise<VoxelCollisionResult> {
  if (!opts.outputPath.endsWith('.voxel.json')) {
    throw new Error(`outputPath must end in .voxel.json (got ${opts.outputPath})`);
  }
  await fs.access(opts.inputPath);
  await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });

  const resolution = opts.voxelResolution ?? DEFAULT_RESOLUTION;
  const opacity = opts.opacityCutoff ?? DEFAULT_OPACITY;

  await runSplatTransform([
    '-R', String(resolution),
    '-A', String(opacity),
    '-w',
    opts.inputPath,
    opts.outputPath,
  ]);

  const binPath = opts.outputPath.replace(/\.json$/, '.bin');
  await fs.access(opts.outputPath);
  await fs.access(binPath);

  return {
    jsonPath: opts.outputPath,
    binPath,
    voxelResolution: resolution,
    opacityCutoff: opacity,
  };
}

function runSplatTransform(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const cp = spawn('npx', ['splat-transform', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    cp.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    cp.on('error', reject);
    cp.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`splat-transform exited ${code}: ${stderr.trim()}`));
    });
  });
}
