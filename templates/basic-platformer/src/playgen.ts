// MUST stay in sync with parent's src/types/playgen.ts and src/harness/instrumentation.ts.
// Templates are copied into games/<slug>/, so they can't import from the parent.

export interface PlayGenState {
  ready: boolean;
  isPlaying: boolean;
  score: number;
  level: string | number;
  timeSec: number;
  lastError: string | null;
  events: PlayGenEvent[];
}

export type PlayGenEventKind =
  | 'progress'
  | 'pickup'
  | 'death'
  | 'transition'
  | 'win'
  | 'lose'
  | 'error'
  | 'custom';

export interface PlayGenEvent {
  t: number;
  kind: PlayGenEventKind;
  payload?: unknown;
}

declare global {
  interface Window {
    __playgen?: PlayGenState;
  }
}

export function initPlayGen(initial?: Partial<PlayGenState>): PlayGenState {
  const state: PlayGenState = {
    ready: false,
    isPlaying: false,
    score: 0,
    level: 0,
    timeSec: 0,
    lastError: null,
    events: [],
    ...initial,
  };
  window.__playgen = state;
  return state;
}

export function emit(kind: PlayGenEventKind, payload?: unknown): void {
  const s = window.__playgen;
  if (!s) return;
  s.events.push({ t: s.timeSec, kind, payload });
}

export function setReady(): void {
  if (window.__playgen) window.__playgen.ready = true;
}

export function setPlaying(playing: boolean): void {
  if (window.__playgen) window.__playgen.isPlaying = playing;
}

export function setScore(score: number): void {
  if (window.__playgen) window.__playgen.score = score;
}

export function setLevel(level: string | number): void {
  if (window.__playgen) window.__playgen.level = level;
}

export function tick(deltaSec: number): void {
  if (window.__playgen) window.__playgen.timeSec += deltaSec;
}

export function reportError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (window.__playgen) {
    window.__playgen.lastError = msg;
    window.__playgen.events.push({
      t: window.__playgen.timeSec,
      kind: 'error',
      payload: { message: msg },
    });
  }
}
