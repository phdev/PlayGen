import path from 'node:path';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import {
  gameDir,
  updateManifest,
} from '../src/orchestrator/manifest.js';
import type { ConceptPanel } from '../src/types/manifest.js';

async function main(): Promise<void> {
  const [slug, colsArg, rowsArg] = process.argv.slice(2);
  if (!slug) {
    process.stderr.write(
      'Usage: tsx scripts/decompose-concept.ts <slug> [cols=3] [rows=3]\n',
    );
    process.exit(1);
  }
  const cols = colsArg ? Number(colsArg) : 3;
  const rows = rowsArg ? Number(rowsArg) : 3;
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) {
    throw new Error('cols and rows must be positive integers');
  }

  const dir = gameDir(slug);
  const conceptPath = path.join(dir, 'concept.png');
  const panelsDir = path.join(dir, 'panels');
  await fs.mkdir(panelsDir, { recursive: true });

  const meta = await sharp(conceptPath).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('cannot read concept image dimensions');
  }

  const w = Math.floor(meta.width / cols);
  const h = Math.floor(meta.height / rows);

  const panels: ConceptPanel[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c + 1;
      const id = `panel-${String(idx).padStart(2, '0')}`;
      const outAbs = path.join(panelsDir, `${id}.png`);
      await sharp(conceptPath)
        .extract({ left: c * w, top: r * h, width: w, height: h })
        .toFile(outAbs);
      panels.push({
        id,
        path: path.relative(dir, outAbs),
        row: r,
        col: c,
      });
    }
  }

  await updateManifest(slug, (m) => ({
    concept: m.concept ? { ...m.concept, panels } : m.concept,
  }));

  process.stdout.write(
    JSON.stringify({ panels: panels.length, cols, rows }, null, 2) + '\n',
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `decompose-concept failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
