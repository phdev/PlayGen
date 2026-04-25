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

export {};
