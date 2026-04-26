import { appendFile } from 'node:fs/promises';
import { runOrchestrator } from '../src/orchestrator/index.js';
import { newSlug } from '../src/orchestrator/manifest.js';
import type { InputMode } from '../src/types/manifest.js';

function parseArgs(argv: string[]): {
  premise: string;
  modes?: InputMode[];
  conceptPrompt?: string;
  genre?: string;
  mechanics?: string;
  phase?: 'all' | 'plan' | 'build';
  slug?: string;
} {
  const args = argv.slice(2);
  let modes: InputMode[] | undefined;
  let conceptPrompt: string | undefined;
  let genre: string | undefined;
  let mechanics: string | undefined;
  let phase: 'all' | 'plan' | 'build' | undefined;
  let slug: string | undefined;
  const premiseParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--modes' || a === '-m') {
      const next = args[++i];
      if (!next) throw new Error('--modes requires a comma-separated list');
      modes = next.split(',').map((s) => s.trim()) as InputMode[];
    } else if (a === '--concept-prompt') {
      const next = args[++i];
      if (!next) throw new Error('--concept-prompt requires a value');
      conceptPrompt = next;
    } else if (a === '--genre') {
      const next = args[++i];
      if (!next) throw new Error('--genre requires a value');
      genre = next;
    } else if (a === '--mechanics') {
      const next = args[++i];
      if (!next) throw new Error('--mechanics requires a value');
      mechanics = next;
    } else if (a === '--phase') {
      const next = args[++i] as 'all' | 'plan' | 'build' | undefined;
      if (!next || !['all', 'plan', 'build'].includes(next)) {
        throw new Error('--phase must be one of: all, plan, build');
      }
      phase = next;
    } else if (a === '--slug') {
      const next = args[++i];
      if (!next) throw new Error('--slug requires a value');
      slug = next;
    } else if (a === '--edited-plan') {
      const next = args[++i];
      if (!next) throw new Error('--edited-plan requires JSON');
      process.env.PLAYGEN_EDITED_PLAN = next;
    } else if (a === '--help' || a === '-h') {
      printUsageAndExit(0);
    } else {
      premiseParts.push(a);
    }
  }
  const premise = premiseParts.join(' ').trim();
  if (!premise && phase !== 'build') printUsageAndExit(1);
  return { premise, modes, conceptPrompt, genre, mechanics, phase, slug };
}

function printUsageAndExit(code: number): never {
  const msg = [
    'Usage: tsx scripts/new-slice.ts "<premise>" [--modes keyboard,touch,gamepad]',
    '',
    'Generates a PlayCanvas vertical slice from a premise and validates it end-to-end.',
  ].join('\n');
  (code === 0 ? process.stdout : process.stderr).write(msg + '\n');
  process.exit(code);
}

const {
  premise,
  modes,
  conceptPrompt,
  genre,
  mechanics,
  phase,
  slug: providedSlug,
} = parseArgs(process.argv);

const effectivePhase = phase ?? 'all';
const slug =
  effectivePhase === 'build'
    ? (providedSlug ?? (() => { throw new Error('--slug required for --phase build'); })())
    : (providedSlug ?? newSlug(premise));

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `slug=${slug}\n`);
}

const designIntent =
  genre || mechanics
    ? { genre: genre ?? '', mechanics: mechanics ?? '' }
    : undefined;

runOrchestrator({
  premise,
  slug,
  inputModes: modes,
  conceptPrompt,
  designIntent,
  phase: effectivePhase,
}).then(
  async (manifest) => {
    process.stdout.write(
      `\nDone: ${manifest.slug} (status=${manifest.status})\n` +
        `Manifest: games/${manifest.slug}/manifest.json\n`,
    );
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `status=${manifest.status}\n`,
      );
    }
  },
  (err: unknown) => {
    process.stderr.write(
      `\nFailed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  },
);
