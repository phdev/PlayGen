import * as pc from 'playcanvas';
import { emit, emitStepOnce } from '../playgen';

export interface WaveSpawnOptions {
  app: pc.Application;
  parent: pc.Entity;
  spawnPoint: pc.Vec3;
  goalPoint: pc.Vec3;
  enemyTemplate: () => pc.Entity;
  intervalSec?: number;
  speed?: number;
  maxAlive?: number;
}

export interface WaveSpawnHandle {
  alive: pc.Entity[];
  killed: number;
  reachedGoal: number;
  killAt(entity: pc.Entity): void;
}

export function wireWaveSpawn(opts: WaveSpawnOptions): WaveSpawnHandle {
  const interval = opts.intervalSec ?? 2;
  const speed = opts.speed ?? 4;
  const maxAlive = opts.maxAlive ?? 12;

  const handle: WaveSpawnHandle = {
    alive: [],
    killed: 0,
    reachedGoal: 0,
    killAt(entity) {
      const idx = handle.alive.indexOf(entity);
      if (idx < 0) return;
      handle.alive.splice(idx, 1);
      entity.destroy();
      handle.killed += 1;
      emitStepOnce('enemy-killed');
      emit('progress', { step: 'enemy-killed', killed: handle.killed });
    },
  };

  let timer = 0;
  opts.app.on('update', (dt: number) => {
    timer += dt;
    if (timer >= interval && handle.alive.length < maxAlive) {
      timer = 0;
      const enemy = opts.enemyTemplate();
      enemy.setPosition(opts.spawnPoint);
      opts.parent.addChild(enemy);
      handle.alive.push(enemy);
      emitStepOnce('wave-spawned');
      emit('progress', { step: 'wave-spawned', alive: handle.alive.length });
    }

    for (const e of handle.alive.slice()) {
      const p = e.getPosition();
      const toGoal = new pc.Vec3()
        .copy(opts.goalPoint)
        .sub(p);
      const dist = toGoal.length();
      if (dist < 0.5) {
        const idx = handle.alive.indexOf(e);
        if (idx >= 0) handle.alive.splice(idx, 1);
        e.destroy();
        handle.reachedGoal += 1;
        emit('progress', {
          step: 'enemy-reached-goal',
          reachedGoal: handle.reachedGoal,
        });
        continue;
      }
      toGoal.normalize().mulScalar(speed * dt);
      e.translate(toGoal.x, toGoal.y, toGoal.z);
    }
  });

  return handle;
}
