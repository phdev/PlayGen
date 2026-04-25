import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadManifest } from '../src/orchestrator/manifest.js';

interface IndexEntry {
  slug: string;
  title?: string;
  premise: string;
  status: string;
  publishedUrl?: string;
  thumbnailUrl?: string;
  createdAt?: string;
}

async function main(): Promise<void> {
  const [slug] = process.argv.slice(2);
  if (!slug) {
    process.stderr.write('Usage: tsx scripts/publish-slice.ts <slug>\n');
    process.exit(1);
  }

  const manifest = await loadManifest(slug);
  const indexPath = path.join('webapp', 'public', 'slices.json');

  let entries: IndexEntry[] = [];
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) entries = parsed as IndexEntry[];
  } catch {
    // missing or empty — start fresh
  }

  const entry: IndexEntry = {
    slug: manifest.slug,
    title: manifest.plan?.title,
    premise: manifest.premise,
    status: manifest.status,
    publishedUrl: manifest.playcanvas?.publishedUrl,
    thumbnailUrl: manifest.concept
      ? `games/${manifest.slug}/${manifest.concept.imagePath}`
      : undefined,
    createdAt: manifest.createdAt,
  };

  const existingIdx = entries.findIndex((e) => e.slug === slug);
  if (existingIdx >= 0) entries[existingIdx] = entry;
  else entries.unshift(entry);

  await fs.writeFile(
    indexPath,
    JSON.stringify(entries, null, 2) + '\n',
    'utf8',
  );
  process.stdout.write(
    `Published ${slug} to ${indexPath} (${entries.length} total)\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `publish-slice failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
