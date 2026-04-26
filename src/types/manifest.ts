import type { PlayGenState } from './playgen.js';

export type ManifestStatus =
  | 'init'
  | 'concept'
  | 'planning'
  | 'awaiting_plan_approval'
  | 'asset_gen'
  | 'scene_assembly'
  | 'playtest'
  | 'fixing'
  | 'complete'
  | 'failed';

export type InputMode = 'keyboard' | 'touch' | 'gamepad';

export interface DesignIntent {
  genre: string;
  mechanics: string;
}

export interface Manifest {
  slug: string;
  createdAt: string;
  updatedAt: string;
  status: ManifestStatus;
  premise: string;
  designIntent?: DesignIntent;
  concept?: ConceptArtifact;
  styleGuide?: StyleGuide;
  plan?: VerticalSlicePlan;
  assets: AssetRecord[];
  splats: SplatRecord[];
  playcanvas?: PlayCanvasProject;
  playtests: PlaytestRun[];
  errors: ManifestError[];
}

export interface ConceptPanel {
  id: string;
  path: string;
  row: number;
  col: number;
  role?: string;
}

export interface ConceptArtifact {
  prompt: string;
  model: string;
  imagePath: string;
  variants?: string[];
  panels?: ConceptPanel[];
}

export interface StyleGuide {
  palette: string[];
  lighting: string;
  perspective: string;
  scale: string;
  mood: string;
  era?: string;
}

export type Template = 'basic-platformer' | 'physics-vehicle';

export interface LoopStep {
  name: string;
  control?: string;
}

export interface VerticalSlicePlan {
  template: Template;
  title: string;
  oneLineHook: string;
  inputModes: InputMode[];
  controls: Partial<Record<InputMode, ControlBinding[]>>;
  levels: LevelSpec[];
  loopSteps: LoopStep[];
  winCondition: string;
  loseCondition: string;
}

export interface ControlBinding {
  action: string;
  binding: string;
}

export interface LevelSpec {
  id: string;
  name: string;
  description: string;
  durationGoalSec: number;
  assetIds: string[];
  mechanics: string[];
}

export type AssetKind = 'character' | 'prop' | 'environment' | 'fx';
export type AssetStatus = 'pending' | 'queued' | 'rendering' | 'done' | 'failed';

export interface AssetRecord {
  id: string;
  kind: AssetKind;
  prompt: string;
  sourceImagePath?: string;
  glbPath?: string;
  status: AssetStatus;
  meshyTaskId?: string;
  attempts: number;
  errorMessage?: string;
}

export interface SplatRecord {
  id: string;
  source: 'photogrammetry' | 'manual';
  plyPath: string;
  voxelJsonPath?: string;
  voxelBinPath?: string;
  voxelResolution?: number;
  opacityCutoff?: number;
}

export interface PlayCanvasProject {
  projectId: string;
  sceneId?: string;
  publishedUrl?: string;
}

export type Verdict = 'pass' | 'fail' | 'inconclusive';

export interface PlaytestRun {
  id: string;
  scenario: string;
  inputMode: InputMode;
  verdict: Verdict;
  durationSec: number;
  finalState?: PlayGenState;
  screenshots: string[];
  notes?: string;
}

export interface ManifestError {
  t: string;
  stage: ManifestStatus;
  message: string;
  details?: unknown;
}
