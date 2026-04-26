import * as pc from 'playcanvas';
import { emit, emitStepOnce } from '../playgen';

export interface PickupOptions {
  app: pc.Application;
  player: pc.Entity;
  pickups: pc.Entity[];
  radius?: number;
  scoreEach?: number;
}

export interface PickupHandle {
  remaining: number;
  collected: number;
}

export function wirePickup(opts: PickupOptions): PickupHandle {
  const radius = opts.radius ?? 1.2;
  const scoreEach = opts.scoreEach ?? 10;

  const handle: PickupHandle = {
    remaining: opts.pickups.length,
    collected: 0,
  };

  opts.app.on('update', () => {
    if (handle.remaining === 0) return;
    const p = opts.player.getPosition();
    for (const pickup of opts.pickups) {
      if (!pickup.enabled) continue;
      if (p.distance(pickup.getPosition()) < radius) {
        pickup.enabled = false;
        handle.remaining -= 1;
        handle.collected += 1;
        const w = window as unknown as { __playgen?: { score: number } };
        if (w.__playgen) w.__playgen.score += scoreEach;
        emitStepOnce('pickup');
        emit('pickup', {
          id: pickup.name,
          remaining: handle.remaining,
          collected: handle.collected,
        });
      }
    }
  });

  return handle;
}
