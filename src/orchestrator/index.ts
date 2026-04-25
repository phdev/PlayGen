import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  createManifest,
  loadManifest,
  manifestPath,
  gameDir,
} from './manifest.js';
import type { InputMode, Manifest } from '../types/manifest.js';
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
      'Read games/<slug>/manifest.json. Compose a concept-art prompt grounded in manifest.premise — emphasize a single hero shot, clean background, readable silhouettes.',
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
      'For each AssetRecord with status="pending" or status="failed" (attempts < 2), run: `npx tsx scripts/gen-mesh.ts <slug> <assetId>`. The script handles status transitions and Meshy polling.',
      'Run up to 4 in parallel using shell `&` and `wait`. After all complete, re-read the manifest and confirm every asset is status="done" before returning.',
    ].join(' '),
    tools: ['Read', 'Write', 'Edit', 'Bash'],
  },
  'scene-assembly': {
    description: 'Builds a runnable PlayCanvas slice into games/<slug>/build/.',
    prompt: [
      'You are the scene builder. Engine-only path (works in CI, no editor required):',
      'Step 1 — Clone the template: `cp -R templates/basic-platformer games/<slug>/build`.',
      'Step 2 — Edit games/<slug>/build/src/main.ts per manifest.plan: swap the placeholder primitives for the GLB assets in games/<slug>/assets/, wire controls per manifest.plan.controls, tune mechanics, set win/lose conditions. Every generated game MUST keep the window.__playgen contract intact (initPlayGen, setReady, setPlaying, emit, tick, reportError).',
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

  const mcpServers = isPlayCanvasMcpEnabled()
    ? { [PLAYCANVAS_MCP_SERVER_NAME]: playcanvasMcpServerConfig() }
    : undefined;
  const permissionMode = (process.env.PLAYGEN_PERMISSION_MODE ?? 'acceptEdits') as
    | 'default'
    | 'acceptEdits'
    | 'bypassPermissions'
    | 'plan';

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
