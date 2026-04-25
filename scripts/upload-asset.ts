import path from 'node:path';
import { uploadAsset } from '../src/tools/playcanvas-rest.js';
import {
  gameDir,
  loadManifest,
  updateManifest,
} from '../src/orchestrator/manifest.js';

async function main(): Promise<void> {
  const [slug, assetId] = process.argv.slice(2);
  if (!slug || !assetId) {
    process.stderr.write(
      'Usage: tsx scripts/upload-asset.ts <slug> <assetId>\n',
    );
    process.exit(1);
  }

  const manifest = await loadManifest(slug);
  const asset = manifest.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`asset "${assetId}" not in manifest`);
  if (!asset.glbPath) throw new Error(`asset "${assetId}" has no glbPath yet`);

  const filePath = path.join(gameDir(slug), asset.glbPath);
  const projectId =
    manifest.playcanvas?.projectId ?? process.env.PLAYCANVAS_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      'manifest.playcanvas.projectId or PLAYCANVAS_PROJECT_ID is required',
    );
  }

  const uploaded = await uploadAsset({
    filePath,
    name: `${assetId}.glb`,
    projectId,
  });

  await updateManifest(slug, (m) => ({
    playcanvas: { ...(m.playcanvas ?? { projectId }), projectId },
    assets: m.assets.map((a) =>
      a.id === assetId
        ? {
            ...a,
            errorMessage: undefined,
          }
        : a,
    ),
  }));

  process.stdout.write(
    JSON.stringify(
      {
        assetId,
        playcanvasAssetId: uploaded.id,
        size: uploaded.size,
      },
      null,
      2,
    ) + '\n',
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `upload-asset failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
