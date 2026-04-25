import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gameDir, loadManifest } from '../src/orchestrator/manifest.js';

interface IndexEntry {
  slug: string;
  title?: string;
  premise: string;
  status: string;
  publishedUrl?: string;
  thumbnailUrl?: string;
  createdAt?: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}

async function rmIfExists(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const [slug] = process.argv.slice(2);
  if (!slug) {
    process.stderr.write('Usage: tsx scripts/publish-slice.ts <slug>\n');
    process.exit(1);
  }

  const manifest = await loadManifest(slug);
  const dir = gameDir(slug);
  const slicesDir = path.join('webapp', 'public', 'slices', slug);
  const indexPath = path.join('webapp', 'public', 'slices.json');

  let publishedUrl: string | undefined = manifest.playcanvas?.publishedUrl;

  const buildDist = path.join(dir, 'build', 'dist');
  if (await exists(buildDist)) {
    await rmIfExists(slicesDir);
    await copyDir(buildDist, slicesDir);
    publishedUrl = `slices/${slug}/`;
  }

  let thumbnailUrl: string | undefined;
  if (manifest.concept?.imagePath) {
    const conceptSrc = path.join(dir, manifest.concept.imagePath);
    if (await exists(conceptSrc)) {
      await fs.mkdir(slicesDir, { recursive: true });
      const thumbDst = path.join(slicesDir, 'thumbnail.png');
      await fs.copyFile(conceptSrc, thumbDst);
      thumbnailUrl = `slices/${slug}/thumbnail.png`;
    }
  }

  let entries: IndexEntry[] = [];
  if (await exists(indexPath)) {
    try {
      const parsed = JSON.parse(await fs.readFile(indexPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) entries = parsed as IndexEntry[];
    } catch {
      // start fresh on parse error
    }
  }

  const entry: IndexEntry = {
    slug: manifest.slug,
    title: manifest.plan?.title,
    premise: manifest.premise,
    status: manifest.status,
    publishedUrl,
    thumbnailUrl,
    createdAt: manifest.createdAt,
  };

  const idx = entries.findIndex((e) => e.slug === slug);
  if (idx >= 0) entries[idx] = entry;
  else entries.unshift(entry);

  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(
    indexPath,
    JSON.stringify(entries, null, 2) + '\n',
    'utf8',
  );

  process.stdout.write(
    JSON.stringify(
      {
        slug: manifest.slug,
        publishedUrl: publishedUrl ?? null,
        thumbnailUrl: thumbnailUrl ?? null,
        totalEntries: entries.length,
      },
      null,
      2,
    ) + '\n',
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `publish-slice failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
