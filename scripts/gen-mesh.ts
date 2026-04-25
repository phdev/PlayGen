import path from 'node:path';
import { generateMeshFromImage } from '../src/tools/meshy.js';
import {
  gameDir,
  loadManifest,
  updateManifest,
} from '../src/orchestrator/manifest.js';
import type { AssetRecord } from '../src/types/manifest.js';

function patchAsset(
  assets: AssetRecord[],
  id: string,
  patch: Partial<AssetRecord>,
): AssetRecord[] {
  return assets.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

async function main(): Promise<void> {
  const [slug, assetId] = process.argv.slice(2);
  if (!slug || !assetId) {
    process.stderr.write('Usage: tsx scripts/gen-mesh.ts <slug> <assetId>\n');
    process.exit(1);
  }

  const manifest = await loadManifest(slug);
  const asset = manifest.assets.find((a) => a.id === assetId);
  if (!asset) {
    throw new Error(`asset "${assetId}" not in manifest games/${slug}/manifest.json`);
  }

  const dir = gameDir(slug);
  const sourceImage = path.join(
    dir,
    asset.sourceImagePath ?? 'concept.png',
  );
  const outputPath = path.join(dir, 'assets', `${assetId}.glb`);

  await updateManifest(slug, (m) => ({
    assets: patchAsset(m.assets, assetId, {
      status: 'rendering',
      attempts: asset.attempts + 1,
    }),
  }));

  try {
    const result = await generateMeshFromImage({
      imagePath: sourceImage,
      outputPath,
    });

    await updateManifest(slug, (m) => ({
      assets: patchAsset(m.assets, assetId, {
        status: 'done',
        glbPath: path.relative(dir, result.glbPath),
        meshyTaskId: result.taskId,
        errorMessage: undefined,
      }),
    }));

    process.stdout.write(
      JSON.stringify(
        {
          assetId,
          glbPath: path.relative(dir, result.glbPath),
          taskId: result.taskId,
        },
        null,
        2,
      ) + '\n',
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateManifest(slug, (m) => ({
      assets: patchAsset(m.assets, assetId, {
        status: 'failed',
        errorMessage: msg,
      }),
    }));
    throw err;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `gen-mesh failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
