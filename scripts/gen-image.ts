import path from 'node:path';
import { generateConceptImage } from '../src/tools/image-gen.js';
import { extractStyleGuide } from '../src/tools/style-guide.js';
import {
  gameDir,
  updateManifest,
} from '../src/orchestrator/manifest.js';

async function main(): Promise<void> {
  const [slug, ...rest] = process.argv.slice(2);
  if (!slug || rest.length === 0) {
    process.stderr.write(
      'Usage: tsx scripts/gen-image.ts <slug> "<prompt>"\n',
    );
    process.exit(1);
  }
  const prompt = rest.join(' ');
  const outputPath = path.join(gameDir(slug), 'concept.png');

  const result = await generateConceptImage({ prompt, outputPath });

  const styleGuide = await extractStyleGuide(result.imagePath).catch(
    () => null,
  );

  await updateManifest(slug, (m) => ({
    status: m.status === 'init' ? 'concept' : m.status,
    concept: {
      prompt: result.prompt,
      model: result.model,
      imagePath: 'concept.png',
      variants: result.variantPaths.map((p) => path.basename(p)),
    },
    ...(styleGuide ? { styleGuide } : {}),
  }));

  process.stdout.write(
    JSON.stringify(
      {
        imagePath: path.relative(gameDir(slug), result.imagePath),
        model: result.model,
        variants: result.variantPaths.map((p) => path.basename(p)),
        styleGuide: styleGuide ?? null,
      },
      null,
      2,
    ) + '\n',
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `gen-image failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
