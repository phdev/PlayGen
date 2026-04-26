import path from 'node:path';
import { generateConceptImage } from '../src/tools/image-gen.js';
import { styleGuidePromptSuffix } from '../src/tools/style-guide.js';
import {
  gameDir,
  loadManifest,
  updateManifest,
} from '../src/orchestrator/manifest.js';

async function main(): Promise<void> {
  const [slug, assetId] = process.argv.slice(2);
  if (!slug || !assetId) {
    process.stderr.write(
      'Usage: tsx scripts/gen-asset-image.ts <slug> <assetId>\n',
    );
    process.exit(1);
  }

  const manifest = await loadManifest(slug);
  const asset = manifest.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`asset "${assetId}" not in manifest`);
  if (!asset.prompt) {
    throw new Error(`asset "${assetId}" has no prompt — planner must set it`);
  }

  const dir = gameDir(slug);
  const outputPath = path.join(dir, 'assets', `${assetId}-source.png`);
  const heroPrompt =
    [
      `Single hero shot of: ${asset.prompt}.`,
      'Centered subject, plain neutral background, bold silhouette, even diffuse lighting, no text, no UI overlays.',
      'Image-to-3D-friendly: one isolated subject, clean alpha-friendly contrast against the background.',
    ].join(' ') + styleGuidePromptSuffix(manifest.styleGuide);

  const result = await generateConceptImage({
    prompt: heroPrompt,
    outputPath,
    size: '1024x1024',
  });

  const sourceRel = path.relative(dir, result.imagePath);

  await updateManifest(slug, (m) => ({
    assets: m.assets.map((a) =>
      a.id === assetId
        ? { ...a, sourceImagePath: sourceRel, errorMessage: undefined }
        : a,
    ),
  }));

  process.stdout.write(
    JSON.stringify(
      {
        assetId,
        sourceImagePath: sourceRel,
        model: result.model,
      },
      null,
      2,
    ) + '\n',
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `gen-asset-image failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
