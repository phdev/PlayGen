import { emit, emitStepOnce } from '../playgen';

export interface StagingOptions {
  flightState: {
    fuel: number;
    vy: number;
    angle: number;
  };
  fuelPerStage?: number;
  maxStages?: number;
  thrustBoost?: number;
}

export interface StagingHandle {
  trigger(): boolean;
  stagesRemaining: number;
}

export function wireStaging(opts: StagingOptions): StagingHandle {
  const fuelPerStage = opts.fuelPerStage ?? 60;
  const maxStages = opts.maxStages ?? 3;
  let stagesRemaining = maxStages;

  const handle: StagingHandle = {
    trigger() {
      if (stagesRemaining <= 0) return false;
      stagesRemaining -= 1;
      opts.flightState.fuel = Math.min(100, opts.flightState.fuel + fuelPerStage);
      opts.flightState.vy += opts.thrustBoost ?? 5;
      emitStepOnce('staging');
      emit('progress', {
        step: 'staging',
        stagesRemaining,
        fuel: opts.flightState.fuel,
      });
      return true;
    },
    get stagesRemaining() {
      return stagesRemaining;
    },
  };

  return handle;
}
