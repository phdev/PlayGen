import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  createManifest,
  loadManifest,
  manifestPath,
  gameDir,
} from './manifest.js';
import type {
  DesignIntent,
  InputMode,
  Manifest,
} from '../types/manifest.js';
import {
  PLAYCANVAS_MCP_SERVER_NAME,
  isPlayCanvasMcpEnabled,
  playcanvasMcpServerConfig,
} from '../tools/playcanvas-mcp.js';

export interface RunOptions {
  premise: string;
  slug?: string;
  inputModes?: InputMode[];
  maxFixAttempts?: number;
  conceptPrompt?: string;
  designIntent?: DesignIntent;
}

interface SubagentDef {
  description: string;
  prompt: string;
  tools?: string[];
}

const SUBAGENTS: Record<string, SubagentDef> = {
  concept: {
    description:
      'Renders a concept image for the premise and writes it into the manifest under .concept.',
    prompt: [
      'You are the concept artist for a PlayCanvas vertical slice.',
      'Read games/<slug>/manifest.json. If manifest.concept.prompt is already set (the player pre-approved it), use that prompt verbatim. Otherwise, compose one grounded in manifest.premise — emphasize a single hero shot, clean background, readable silhouettes.',
      'Run: `npx tsx scripts/gen-image.ts <slug> "<prompt>"`. Parse the JSON it prints to confirm imagePath.',
      'The script writes to games/<slug>/concept.png and updates manifest.concept + status. Verify, then return.',
    ].join(' '),
    tools: ['Read', 'Write', 'Edit', 'Bash'],
  },
  planner: {
    description:
      'Decomposes the premise + concept into a VerticalSlicePlan and an asset list.',
    prompt: [
      'You are the slice planner.',
      'STEP 1: Use the Read tool to load games/<slug>/concept.png — the SDK forwards image bytes as multimodal input so you can actually see the panels. Enumerate every visible panel before planning.',
      'AUTHORITATIVE INPUTS (in priority order): manifest.designIntent (genre + gameplay loop — player-confirmed, non-negotiable), manifest.premise, then the concept image (art-direction only).',
      'STEP 2: Pick manifest.plan.template — one of "basic-platformer" or "physics-vehicle". Use "physics-vehicle" for sims, vehicle simulators, rocket/space games, anything KSP-like; use "basic-platformer" for top-down or character-driven action. The chosen template constrains the scaffold scene-assembly will edit.',
      'STEP 3: Translate manifest.designIntent.mechanics (the gameplay loop) into manifest.plan.loopSteps — an ordered array of {name, control}. Every arrow in the loop becomes one step. Step names should be short kebab-case identifiers (e.g. "throttle-up", "pitch-maneuver", "orbit-achieved").',
      'CRITICAL: every loopStep MUST be exercised in the slice. The scene-assembly subagent will wire each step so the game emits emit("progress", { step: "<name>" }) when the player triggers it. The playtest harness verifies all step names fired during a 15s play session.',
      'STEP 4: Produce manifest.plan with: template, title, oneLineHook, inputModes (must include keyboard, touch, gamepad), per-mode controls that activate the chosen loop steps, exactly one level for v1, loopSteps, winCondition (mark loop completion), loseCondition (mark loop failure).',
      'STEP 5: Append AssetRecords for each character/prop/environment piece visible in the concept panels OR demanded by the chosen template. Each AssetRecord.prompt must describe ONE single subject (e.g. "weathered orange rocket capsule with heat shield, isolated, plain background"), NOT a scene. asset-gen will feed this to image-gen then to Meshy.',
      'Set status="pending" and attempts=0 on each AssetRecord. Set manifest.status -> "asset_gen".',
    ].join(' '),
    tools: ['Read', 'Write', 'Edit'],
  },
  'asset-gen': {
    description:
      'For each AssetRecord: image-gen a hero shot, then Meshy image-to-3D.',
    prompt: [
      'You are the asset producer. Two-step pipeline per asset because the concept image is a composite, not a hero shot Meshy can use:',
      'For each AssetRecord with status="pending" or status="failed" (attempts < 2):',
      '  1. `npx tsx scripts/gen-asset-image.ts <slug> <assetId>` — generates a single-subject image at games/<slug>/assets/<id>-source.png and sets manifest.assets[<id>].sourceImagePath.',
      '  2. `npx tsx scripts/gen-mesh.ts <slug> <assetId>` — Meshy reads sourceImagePath and produces the GLB.',
      'Run up to 4 assets in parallel using shell `&` and `wait`, but DO NOT parallelize the two steps within a single asset — gen-mesh depends on gen-asset-image having written sourceImagePath first.',
      'After all complete, re-read the manifest and confirm every asset is status="done" before returning.',
    ].join(' '),
    tools: ['Read', 'Write', 'Edit', 'Bash'],
  },
  'scene-assembly': {
    description: 'Builds a runnable PlayCanvas slice into games/<slug>/build/.',
    prompt: [
      'You are the scene builder. Engine-only path (works in CI, no editor required):',
      'Step 1 — Clone the template the planner chose: `cp -R templates/${manifest.plan.template} games/<slug>/build`. If manifest.plan.template is unset, fall back to basic-platformer.',
      'Step 2 — Edit games/<slug>/build/src/main.ts per manifest.plan: swap the placeholder primitives for the GLB assets in games/<slug>/assets/, wire controls per manifest.plan.controls, set win/lose conditions, and CRITICALLY: for every entry in manifest.plan.loopSteps, ensure the game calls emit("progress", { step: "<name>" }) when the player triggers that step. The harness verifies all step names appear in __playgen.events.',
      'Every generated game MUST keep the window.__playgen contract intact (initPlayGen, setReady, setPlaying, emit, tick, reportError).',
      'Step 3 — Build: `cd games/<slug>/build && npm install --no-audit --no-fund && npm run build`. The resulting dist/ is what the harness and Pages serve.',
      'Step 4 — Set manifest.status = "playtest". Leave manifest.playcanvas.publishedUrl unset; playtest will spawn a local preview server, and publish-slice will set the final hosted URL.',
      'Optional cloud path: when manifest demands cloud-hosted publishing, also run `npx tsx scripts/upload-asset.ts <slug> <assetId>` per asset to push GLBs to the PlayCanvas project — the editor MCP server cannot push binaries directly.',
    ].join(' '),
  },
  playtest: {
    description:
      'Drives the Playwright harness across configured input modes and records verdicts.',
    prompt: [
      'You are the playtester.',
      'Run: `npx tsx scripts/playtest.ts <slug>`. The script iterates manifest.plan.inputModes, runs boot + golden-path per mode, appends PlaytestRuns to manifest.playtests, and transitions status to "complete" or "fixing".',
      'After the run, read the manifest. If status = "fixing", summarize the failing runs (mode, scenario, notes) for scene-assembly to act on.',
    ].join(' '),
    tools: ['Read', 'Bash'],
  },
};

export async function runOrchestrator(opts: RunOptions): Promise<Manifest> {
  const inputModes: InputMode[] =
    opts.inputModes ?? ['keyboard', 'touch', 'gamepad'];
  const maxFixAttempts = opts.maxFixAttempts ?? 3;

  const manifest = await createManifest(opts.premise, opts.slug);
  const conceptPrompt =
    opts.conceptPrompt?.trim() || process.env.PLAYGEN_CONCEPT_PROMPT?.trim() || '';

  const envGenre = process.env.PLAYGEN_GENRE?.trim() ?? '';
  const envMechanics = process.env.PLAYGEN_MECHANICS?.trim() ?? '';
  const designIntent: DesignIntent | undefined =
    opts.designIntent ??
    (envGenre || envMechanics
      ? { genre: envGenre, mechanics: envMechanics }
      : undefined);

  const { updateManifest } = await import('./manifest.js');
  if (conceptPrompt || designIntent) {
    await updateManifest(manifest.slug, {
      ...(conceptPrompt
        ? {
            concept: {
              prompt: conceptPrompt,
              model: 'gpt-image-2',
              imagePath: '',
            },
          }
        : {}),
      ...(designIntent ? { designIntent } : {}),
    });
  }

  const orchestratorPrompt = [
    `Build a PlayCanvas vertical slice for the premise: "${opts.premise}".`,
    ``,
    `Manifest: ${manifestPath(manifest.slug)}`,
    `Game directory: ${gameDir(manifest.slug)}`,
    `Required input modes: ${inputModes.join(', ')}`,
    conceptPrompt
      ? `Pre-approved concept prompt: "${conceptPrompt}" (the concept subagent must use it verbatim, not compose a new one).`
      : '',
    designIntent
      ? `Player-confirmed design intent (AUTHORITATIVE): genre="${designIntent.genre}", core mechanics="${designIntent.mechanics}". The planner must build manifest.plan around these; the concept image is art-direction only.`
      : '',
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
  ]
    .filter((line) => line !== '')
    .join('\n');

  const mcpServers = isPlayCanvasMcpEnabled()
    ? { [PLAYCANVAS_MCP_SERVER_NAME]: playcanvasMcpServerConfig() }
    : undefined;
  const permissionMode = (process.env.PLAYGEN_PERMISSION_MODE ?? 'acceptEdits') as
    | 'default'
    | 'acceptEdits'
    | 'bypassPermissions'
    | 'plan';
  const pathToClaudeCodeExecutable = process.env.CLAUDE_CODE_BIN || undefined;

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
      permissionMode,
      ...(mcpServers ? { mcpServers } : {}),
      ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
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
