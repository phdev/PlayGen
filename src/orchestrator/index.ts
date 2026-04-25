import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  createManifest,
  loadManifest,
  manifestPath,
  gameDir,
} from './manifest.js';
import type { InputMode, Manifest } from '../types/manifest.js';

export interface RunOptions {
  premise: string;
  slug?: string;
  inputModes?: InputMode[];
  maxFixAttempts?: number;
}

interface SubagentDef {
  description: string;
  prompt: string;
  tools: string[];
}

const SUBAGENTS: Record<string, SubagentDef> = {
  concept: {
    description:
      'Renders a concept image for the premise and writes it into the manifest under .concept.',
    prompt: [
      'You are the concept artist for a PlayCanvas vertical slice.',
      'Read games/<slug>/manifest.json. Compose a concept-art prompt grounded in manifest.premise.',
      'Call the image-gen tool to render it. Save the file to games/<slug>/concept.png.',
      'Update manifest.concept = { prompt, model, imagePath } and set manifest.status = "concept".',
    ].join(' '),
    tools: ['Read', 'Write', 'Edit', 'Bash'],
  },
  planner: {
    description:
      'Decomposes the premise + concept into a VerticalSlicePlan and an asset list.',
    prompt: [
      'You are the slice planner.',
      'Read the manifest and concept image. Produce manifest.plan with: title, oneLineHook, inputModes (must include keyboard, touch, gamepad), per-mode controls, exactly one level for v1, mechanics, win/lose conditions.',
      'Append AssetRecords for each character/prop/environment piece needed; status = "pending", attempts = 0.',
      'Set manifest.status = "planning" -> "asset_gen".',
    ].join(' '),
    tools: ['Read', 'Write', 'Edit'],
  },
  'asset-gen': {
    description:
      'Generates rigged glTF assets via Meshy from pending AssetRecords.',
    prompt: [
      'You are the asset producer.',
      'For each AssetRecord with status = "pending" or "failed" (attempts < 2), call the Meshy image-to-3d tool, poll for completion, download the GLB into games/<slug>/assets/<id>.glb, update glbPath + status = "done".',
      'Run up to 4 jobs in parallel. On failure, increment attempts and record errorMessage.',
    ].join(' '),
    tools: ['Read', 'Write', 'Edit', 'Bash'],
  },
  'scene-assembly': {
    description: 'Builds the PlayCanvas scene via the editor MCP server.',
    prompt: [
      'You are the scene builder.',
      'Use the playcanvas MCP tools to create entities, attach scripts, drop in assets, and wire up controls per manifest.plan.controls.',
      'Every generated game MUST initialize window.__playgen via src/types/playgen.ts and emit progress/win/lose events.',
      'Set manifest.playcanvas = { projectId, sceneId, publishedUrl }. Status -> "playtest".',
    ].join(' '),
    tools: ['Read', 'Write', 'Edit', 'Bash'],
  },
  playtest: {
    description:
      'Drives the Playwright harness across configured input modes and records verdicts.',
    prompt: [
      'You are the playtester.',
      'For each input mode in manifest.plan.inputModes, run the harness scenarios (boot, golden-path, input-parity).',
      'Append a PlaytestRun to manifest.playtests for each scenario+mode pair, with verdict, finalState (PlayGenState snapshot), and screenshot paths.',
      'If any verdict is "fail", summarize the root cause in notes and set status = "fixing"; otherwise status = "complete".',
    ].join(' '),
    tools: ['Read', 'Write', 'Edit', 'Bash'],
  },
};

export async function runOrchestrator(opts: RunOptions): Promise<Manifest> {
  const inputModes: InputMode[] =
    opts.inputModes ?? ['keyboard', 'touch', 'gamepad'];
  const maxFixAttempts = opts.maxFixAttempts ?? 3;

  const manifest = await createManifest(opts.premise, opts.slug);

  const orchestratorPrompt = [
    `Build a PlayCanvas vertical slice for the premise: "${opts.premise}".`,
    ``,
    `Manifest: ${manifestPath(manifest.slug)}`,
    `Game directory: ${gameDir(manifest.slug)}`,
    `Required input modes: ${inputModes.join(', ')}`,
    ``,
    `Run the phases in order, delegating each to the matching subagent via the Agent tool:`,
    `  1. concept         — premise -> concept.png + manifest.concept`,
    `  2. planner         — manifest.plan + AssetRecord list`,
    `  3. asset-gen       — Meshy jobs in parallel until all assets are status=done`,
    `  4. scene-assembly  — PlayCanvas scene wired to window.__playgen`,
    `  5. playtest        — Playwright harness across all input modes`,
    `  6. on any failed playtest verdict, hand back to scene-assembly. Stop after ${maxFixAttempts} fix attempts.`,
    ``,
    `Read the manifest before each phase, persist updates after. Stop when manifest.status = "complete" or "failed".`,
  ].join('\n');

  for await (const message of query({
    prompt: orchestratorPrompt,
    options: {
      allowedTools: [
        'Read',
        'Write',
        'Edit',
        'Bash',
        'Glob',
        'Grep',
        'Agent',
      ],
      agents: SUBAGENTS,
      permissionMode: 'acceptEdits',
    },
  })) {
    const m = message as { type?: string; subtype?: string; result?: unknown; session_id?: string };
    if (m.type === 'system' && m.subtype === 'init') {
      console.log(
        `[orchestrator] session=${m.session_id} slug=${manifest.slug}`,
      );
    }
    if (m.result !== undefined) {
      console.log('[orchestrator]', m.result);
    }
  }

  return loadManifest(manifest.slug);
}
