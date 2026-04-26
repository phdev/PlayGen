import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gameDir, loadManifest } from '../src/orchestrator/manifest.js';

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const [slug] = process.argv.slice(2);
  if (!slug) {
    process.stderr.write('Usage: tsx scripts/publish-plan.ts <slug>\n');
    process.exit(1);
  }

  const manifest = await loadManifest(slug);
  const plansDir = path.join('webapp', 'public', 'plans');
  await fs.mkdir(plansDir, { recursive: true });

  const dir = gameDir(slug);
  const targetDir = path.join('webapp', 'public', 'slices', slug);
  await fs.mkdir(targetDir, { recursive: true });

  if (manifest.concept?.imagePath) {
    const conceptSrc = path.join(dir, manifest.concept.imagePath);
    if (await exists(conceptSrc)) {
      await fs.copyFile(conceptSrc, path.join(targetDir, 'thumbnail.png'));
    }
  }

  await fs.writeFile(
    path.join(plansDir, `${slug}.json`),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );

  process.stdout.write(
    JSON.stringify(
      {
        slug,
        plansFile: `webapp/public/plans/${slug}.json`,
        thumbnail: `webapp/public/slices/${slug}/thumbnail.png`,
      },
      null,
      2,
    ) + '\n',
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `publish-plan failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
