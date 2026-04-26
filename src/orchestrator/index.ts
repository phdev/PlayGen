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

export type Phase = 'all' | 'plan' | 'build';

export interface RunOptions {
  premise: string;
  slug?: string;
  inputModes?: InputMode[];
  maxFixAttempts?: number;
  conceptPrompt?: string;
  designIntent?: DesignIntent;
  phase?: Phase;
}

interface SubagentDef {
  description: string;
  prompt: string;
  tools?: string[];
}

const SUBAGENTS: Record<string, SubagentDef> = {
  concept: {
    description:
      'Renders a concept image, decomposes panels, extracts style guide, writes everything into the manifest.',
    prompt: [
      'You are the concept artist for a PlayCanvas vertical slice.',
      'Read games/<slug>/manifest.json. If manifest.concept.prompt is already set (the player pre-approved it), use that prompt verbatim. Otherwise, compose one grounded in manifest.premise — emphasize a single hero shot, clean background, readable silhouettes.',
      'Run: `npx tsx scripts/gen-image.ts <slug> "<prompt>"` — this also extracts and saves manifest.styleGuide via Claude vision.',
      'Then run: `npx tsx scripts/decompose-concept.ts <slug>` to split the composite into 3x3 panels in games/<slug>/panels/. The planner uses these as concrete scene/asset references.',
      'Verify both scripts succeeded by reading manifest.concept.panels (should be 9 entries) and manifest.styleGuide (should be populated). Return.',
    ].join(' '),
    tools: ['Read', 'Write', 'Edit', 'Bash'],
  },
  planner: {
    description:
      'Decomposes the premise + concept into a VerticalSlicePlan and an asset list.',
    prompt: [
      'You are the slice planner.',
      'STEP 1: Use the Read tool to load games/<slug>/concept.png AND each panel in games/<slug>/panels/panel-NN.png. The SDK forwards image bytes as multimodal input so you actually see them.',
      'For each panel, write back manifest.concept.panels[i].role = one of "main-menu","gameplay","environment","character","HUD","cutscene","mechanic","detail" based on what is depicted. Use the panel roles to ground the asset list.',
      'AUTHORITATIVE INPUTS (in priority order): manifest.designIntent (genre + gameplay loop — player-confirmed, non-negotiable), manifest.premise, manifest.styleGuide (palette + mood + lighting), then the panels.',
      'STEP 2: Pick manifest.plan.template — one of "basic-platformer" or "physics-vehicle". Use "physics-vehicle" for sims, vehicle simulators, rocket/space games, anything KSP-like; use "basic-platformer" for top-down or character-driven action. The chosen template constrains the scaffold scene-assembly will edit.',
      'STEP 3: Translate manifest.designIntent.mechanics (the gameplay loop) into manifest.plan.loopSteps — an ordered array of {name, control}. Every arrow in the loop becomes one step. Step names should be short kebab-case identifiers (e.g. "throttle-up", "pitch-maneuver", "orbit-achieved").',
      'CRITICAL: every loopStep MUST be exercised in the slice. The scene-assembly subagent will wire each step so the game emits emit("progress", { step: "<name>" }) when the player triggers it. The playtest harness verifies all step names fired during a 15s play session.',
      'STEP 4: Produce manifest.plan EXACTLY in this shape — field names, types, and nesting are non-negotiable (the harness and webapp parse them):',
      '{ "template": "<basic-platformer|physics-vehicle>", "title": "<short>", "oneLineHook": "<one sentence>", "inputModes": ["keyboard","touch","gamepad"], "controls": { "keyboard": [{"action":"throttle","binding":"W"}, ...], "touch": [{"action":"throttle","binding":"drag-up"}, ...], "gamepad": [{"action":"throttle","binding":"RT"}, ...] }, "levels": [{"id":"l1","name":"<name>","description":"<short>","durationGoalSec":60,"assetIds":["asset-1"],"mechanics":["<short>"]}], "loopSteps": [{"name":"<kebab-case>","control":"W"}, ...], "winCondition":"<short sentence>", "loseCondition":"<short sentence>" }',
      'Do NOT add fields not in that shape (no "tagline", no "scene", no nested "designIntent" inside plan, no "id"/"label"/"triggerEvent" on loopSteps, no objects-with-named-keys for controls). loopSteps[].name MUST be kebab-case and match exactly the step names the game emits via emit("progress",{step}); the harness expectLoopSteps check uses these.',
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
      'IF manifest.lastFailureReport IS SET (this is a fix iteration): treat it as the source of truth. Wire emits and behaviors for every entry in lastFailureReport.missingSteps. Address every entry in lastFailureReport.scenarioFailures. Fix every entry in lastFailureReport.lastErrors. Re-build before exiting.',
      'IF manifest.lastFailureReport IS NOT SET (initial assembly):',
      'Step 1 — Clone the template the planner chose: `cp -R templates/${manifest.plan.template} games/<slug>/build`. If unset, fall back to basic-platformer.',
      'Step 2 — Mechanic snippet library at templates/_shared/mechanics/ has idiomatic implementations of common mechanics (orbital-flight, staging, pickup, wave-spawn). For each loopStep in manifest.plan.loopSteps that matches a known mechanic, copy the matching snippet to games/<slug>/build/src/mechanics/<name>.ts and import it in main.ts. Compose snippets instead of authoring physics from scratch where possible.',
      'Step 3 — Edit games/<slug>/build/src/main.ts per manifest.plan: swap the placeholder primitives for the GLB assets in games/<slug>/assets/, wire controls per manifest.plan.controls, set win/lose conditions, and CRITICALLY: for every entry in manifest.plan.loopSteps, ensure the game calls emit("progress", { step: "<name>" }) when the player triggers that step. The harness verifies all step names appear in __playgen.events.',
      'Every generated game MUST keep the window.__playgen contract intact (initPlayGen, setReady, setPlaying, emit, tick, reportError).',
      'Step 4 — Build: `cd games/<slug>/build && npm install --no-audit --no-fund && npm run build`. The resulting dist/ is what the harness and Pages serve.',
      'Step 5 — Set manifest.status = "playtest". Leave manifest.playcanvas.publishedUrl unset; playtest spawns a preview server.',
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
  const phase: Phase =
    opts.phase ?? ((process.env.PLAYGEN_PHASE as Phase | undefined) || 'all');

  const { updateManifest } = await import('./manifest.js');

  let manifest: Manifest;
  if (phase === 'build') {
    if (!opts.slug) {
      throw new Error('phase="build" requires a slug to resume from');
    }
    manifest = await loadManifest(opts.slug);

    const editedPlanRaw = process.env.PLAYGEN_EDITED_PLAN?.trim();
    if (editedPlanRaw) {
      try {
        const parsed = JSON.parse(editedPlanRaw) as {
          plan?: Manifest['plan'];
          assets?: Manifest['assets'];
        };
        await updateManifest(opts.slug, {
          ...(parsed.plan ? { plan: parsed.plan } : {}),
          ...(parsed.assets
            ? {
                assets: parsed.assets.map((a) => ({
                  ...a,
                  status: 'pending' as const,
                  attempts: 0,
                  glbPath: undefined,
                  meshyTaskId: undefined,
                  errorMessage: undefined,
                  sourceImagePath: undefined,
                })),
              }
            : {}),
        });
        manifest = await loadManifest(opts.slug);
      } catch (err) {
        process.stderr.write(
          `[orchestrator] failed to apply PLAYGEN_EDITED_PLAN: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  } else {
    manifest = await createManifest(opts.premise, opts.slug);
  }

  const conceptPrompt =
    opts.conceptPrompt?.trim() || process.env.PLAYGEN_CONCEPT_PROMPT?.trim() || '';

  const envGenre = process.env.PLAYGEN_GENRE?.trim() ?? '';
  const envMechanics = process.env.PLAYGEN_MECHANICS?.trim() ?? '';
  const designIntent: DesignIntent | undefined =
    opts.designIntent ??
    (envGenre || envMechanics
      ? { genre: envGenre, mechanics: envMechanics }
      : undefined);

  if ((conceptPrompt || designIntent) && phase !== 'build') {
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

  const phaseDirective =
    phase === 'plan'
      ? [
          'PHASE: plan-only.',
          'Run ONLY the concept + planner subagents. After planner emits manifest.plan and AssetRecords, set manifest.status = "awaiting_plan_approval" and STOP. Do NOT run asset-gen, scene-assembly, or playtest — the player will review the plan and dispatch a separate build phase.',
        ].join(' ')
      : phase === 'build'
        ? [
            'PHASE: build-only (resuming from approved plan).',
            'manifest.concept and manifest.plan are already populated. SKIP the concept and planner subagents.',
            'Run asset-gen, then scene-assembly, then playtest. On any failed playtest verdict, hand back to scene-assembly. Stop after ' +
              String(maxFixAttempts) +
              ' fix attempts.',
          ].join(' ')
        : 'PHASE: all (full pipeline).';

  const orchestratorPrompt = [
    `Build a PlayCanvas vertical slice for the premise: "${manifest.premise}".`,
    ``,
    phaseDirective,
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
    `Phases:`,
    `  1. concept         — premise -> concept.png + style guide + 9 panels`,
    `  2. planner         — manifest.plan + AssetRecord list`,
    `  3. asset-gen       — per-asset hero shot + Meshy in parallel until all done`,
    `  4. scene-assembly  — clones manifest.plan.template, wires window.__playgen + loopSteps`,
    `  5. playtest        — Playwright harness across all input modes; verifies loopSteps`,
    `  6. fix loop        — on failed verdict, hand back to scene-assembly (up to ${maxFixAttempts}x)`,
    ``,
    `Read the manifest before each phase, persist updates after.`,
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
