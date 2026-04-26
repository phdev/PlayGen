import * as pc from 'playcanvas';
import { emit, emitStepOnce } from '../playgen';

export interface OrbitalFlightOptions {
  rocket: pc.Entity;
  targetAltitude?: number;
  orbitalSpeed?: number;
  thrustMagnitude?: number;
  fuelBurnRate?: number;
  pitchRateDegPerSec?: number;
}

export interface OrbitalFlightHandle {
  setThrottle(t: number): void;
  setPitch(deltaDeg: number): void;
  state: {
    throttle: number;
    fuel: number;
    altitude: number;
    angle: number;
    vx: number;
    vy: number;
    orbiting: boolean;
    crashed: boolean;
    outOfFuel: boolean;
    launched: boolean;
  };
}

export function wireOrbitalFlight(
  app: pc.Application,
  opts: OrbitalFlightOptions,
): OrbitalFlightHandle {
  const targetAlt = opts.targetAltitude ?? 200;
  const orbitalSpeed = opts.orbitalSpeed ?? 25;
  const thrustMag = opts.thrustMagnitude ?? 32;
  const fuelBurnRate = opts.fuelBurnRate ?? 9;
  const pitchRate = opts.pitchRateDegPerSec ?? 35;

  const state = {
    throttle: 0,
    fuel: 100,
    altitude: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    orbiting: false,
    crashed: false,
    outOfFuel: false,
    launched: false,
  };

  let throttleInput = 0;
  let pitchInputRate = 0;

  const handle: OrbitalFlightHandle = {
    setThrottle(t) {
      throttleInput = Math.max(0, Math.min(1, t));
    },
    setPitch(d) {
      pitchInputRate = d;
    },
    state,
  };

  app.on('update', (dt: number) => {
    if (state.orbiting || state.crashed) return;

    if (Math.abs(pitchInputRate) > 0.001) {
      state.angle = Math.max(
        -80,
        Math.min(80, state.angle + pitchInputRate * pitchRate * dt),
      );
      emitStepOnce('pitch-maneuver');
    }

    if (state.fuel > 0 && throttleInput > 0) {
      state.throttle = throttleInput;
      const angleRad = (state.angle * Math.PI) / 180;
      const thrust = state.throttle * thrustMag * dt;
      state.vx += Math.sin(angleRad) * thrust;
      state.vy += Math.cos(angleRad) * thrust;
      state.fuel = Math.max(0, state.fuel - state.throttle * fuelBurnRate * dt);
      if (state.throttle > 0.05) {
        if (!state.launched) {
          state.launched = true;
          emitStepOnce('launch');
        }
        emitStepOnce('throttle-up');
      }
      if (state.fuel === 0 && !state.outOfFuel) {
        state.outOfFuel = true;
        emitStepOnce('out-of-fuel');
      }
    } else {
      state.throttle = 0;
    }

    state.vy -= 9.8 * dt;
    state.vx *= 0.999;
    opts.rocket.translateLocal(state.vx * dt, state.vy * dt, 0);
    opts.rocket.setEulerAngles(0, 0, state.angle);
    state.altitude = Math.max(0, opts.rocket.getPosition().y);

    const horizSpeed = Math.abs(state.vx);
    if (
      !state.orbiting &&
      state.altitude > targetAlt &&
      horizSpeed > orbitalSpeed
    ) {
      state.orbiting = true;
      emitStepOnce('orbit-achieved');
      emit('win', { altitude: state.altitude });
    } else if (state.altitude <= 0 && state.vy < -2 && state.launched) {
      state.crashed = true;
      emit('lose', { reason: 'crashed' });
    } else if (
      state.outOfFuel &&
      state.altitude < targetAlt / 3 &&
      state.vy < 0
    ) {
      state.crashed = true;
      emit('lose', { reason: 'out_of_fuel' });
    }
  });

  return handle;
}
