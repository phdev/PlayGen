import * as pc from 'playcanvas';
import {
  emit,
  emitStepOnce,
  initPlayGen,
  reportError,
  setLevel,
  setPlaying,
  setReady,
  setScore,
  tick,
} from './playgen';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;

const app = new pc.Application(canvas, {
  keyboard: new pc.Keyboard(window),
  touch: 'ontouchstart' in window ? new pc.TouchDevice(canvas) : undefined,
});

window.addEventListener('error', (ev) => reportError(ev.error ?? ev.message));
window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason));

app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.start();

const camera = new pc.Entity('camera');
camera.addComponent('camera', {
  clearColor: new pc.Color(0.02, 0.04, 0.1),
  fov: 55,
});
camera.setPosition(0, 30, 90);
camera.lookAt(0, 30, 0);
app.root.addChild(camera);

const sun = new pc.Entity('sun');
sun.addComponent('light', { type: 'directional', intensity: 1.4 });
sun.setEulerAngles(45, -30, 0);
app.root.addChild(sun);

const ground = new pc.Entity('ground');
ground.addComponent('render', { type: 'box' });
ground.setLocalScale(120, 1, 60);
ground.setPosition(0, -0.5, 0);
app.root.addChild(ground);

const pad = new pc.Entity('pad');
pad.addComponent('render', { type: 'cylinder' });
pad.setLocalScale(8, 0.4, 8);
pad.setPosition(0, 0.2, 0);
app.root.addChild(pad);

const rocket = new pc.Entity('rocket');
rocket.addComponent('render', { type: 'cylinder' });
rocket.setLocalScale(1.5, 6, 1.5);
rocket.setPosition(0, 3, 0);
app.root.addChild(rocket);

const TARGET_ALTITUDE = 200;
const ORBITAL_SPEED = 25;

const STATE = {
  vx: 0,
  vy: 0,
  angle: 0,
  throttle: 0,
  fuel: 100,
  altitude: 0,
  orbiting: false,
  crashed: false,
  outOfFuel: false,
  launched: false,
};

initPlayGen({ level: 'launch' });
setLevel('launch');

function applyThrust(intensity: number, dt: number): void {
  if (STATE.fuel <= 0 || intensity <= 0) return;
  STATE.throttle = Math.min(intensity, 1);
  const angleRad = (STATE.angle * Math.PI) / 180;
  const thrust = STATE.throttle * 32 * dt;
  STATE.vx += Math.sin(angleRad) * thrust;
  STATE.vy += Math.cos(angleRad) * thrust;
  STATE.fuel = Math.max(0, STATE.fuel - STATE.throttle * 9 * dt);
  if (STATE.throttle > 0.05) {
    if (!STATE.launched) {
      STATE.launched = true;
      emitStepOnce('launch');
    }
    emitStepOnce('throttle-up');
  }
  if (STATE.fuel === 0 && !STATE.outOfFuel) {
    STATE.outOfFuel = true;
    emitStepOnce('out-of-fuel');
  }
}

function applyPitch(delta: number): void {
  if (Math.abs(delta) < 0.001) return;
  STATE.angle = Math.max(-80, Math.min(80, STATE.angle + delta));
  emitStepOnce('pitch-maneuver');
}

const touchVec = { x: 0, y: 0 };
let touchStart: { x: number; y: number } | null = null;
canvas.addEventListener(
  'touchstart',
  (ev) => {
    const t = ev.touches[0];
    if (t) touchStart = { x: t.clientX, y: t.clientY };
  },
  { passive: true },
);
canvas.addEventListener(
  'touchmove',
  (ev) => {
    const t = ev.touches[0];
    if (!t || !touchStart) return;
    touchVec.x = Math.max(-1, Math.min(1, (t.clientX - touchStart.x) / 60));
    touchVec.y = Math.max(-1, Math.min(1, (touchStart.y - t.clientY) / 60));
  },
  { passive: true },
);
canvas.addEventListener(
  'touchend',
  () => {
    touchStart = null;
    touchVec.x = 0;
    touchVec.y = 0;
  },
  { passive: true },
);

app.on('update', (dt: number) => {
  tick(dt);
  if (STATE.orbiting || STATE.crashed) return;

  const kb = app.keyboard;
  let throttleInput = 0;
  let pitchInput = 0;

  if (kb?.isPressed(pc.KEY_W)) throttleInput = 1;
  if (kb?.isPressed(pc.KEY_S)) throttleInput = Math.max(throttleInput - 1, 0);
  if (kb?.isPressed(pc.KEY_A)) pitchInput -= 1;
  if (kb?.isPressed(pc.KEY_D)) pitchInput += 1;

  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads[0];
  if (gp) {
    const rt = gp.buttons[7]?.value ?? 0;
    if (rt > 0.05) throttleInput = Math.max(throttleInput, rt);
    const stickX = gp.axes[0] ?? 0;
    if (Math.abs(stickX) > 0.15) pitchInput += stickX;
  }

  if (touchVec.y > 0.05) throttleInput = Math.max(throttleInput, touchVec.y);
  if (Math.abs(touchVec.x) > 0.05) pitchInput += touchVec.x;

  applyPitch(pitchInput * 35 * dt);
  applyThrust(throttleInput, dt);
  if (throttleInput < 0.05) STATE.throttle = 0;

  STATE.vy -= 9.8 * dt;
  STATE.vx *= 0.999;
  rocket.translateLocal(STATE.vx * dt, STATE.vy * dt, 0);
  rocket.setEulerAngles(0, 0, STATE.angle);
  STATE.altitude = Math.max(0, rocket.getPosition().y);

  const rp = rocket.getPosition();
  camera.setPosition(rp.x, rp.y + 20, 90);
  camera.lookAt(rp.x, rp.y, 0);

  setScore(Math.floor(STATE.altitude));
  hud.textContent = `ALT ${STATE.altitude.toFixed(0)}m  V ${Math.hypot(STATE.vx, STATE.vy).toFixed(1)}m/s  FUEL ${STATE.fuel.toFixed(0)}%  PITCH ${STATE.angle.toFixed(0)}°`;

  const horizSpeed = Math.abs(STATE.vx);
  if (
    !STATE.orbiting &&
    STATE.altitude > TARGET_ALTITUDE &&
    horizSpeed > ORBITAL_SPEED
  ) {
    STATE.orbiting = true;
    emitStepOnce('orbit-achieved');
    emit('win', {
      altitude: STATE.altitude,
      score: Math.floor(STATE.altitude),
    });
    setPlaying(false);
    return;
  }

  if (STATE.altitude <= 0 && STATE.vy < -2 && STATE.launched) {
    STATE.crashed = true;
    emit('lose', { reason: 'crashed', altitude: STATE.altitude });
    setPlaying(false);
    return;
  }

  if (STATE.outOfFuel && STATE.altitude < TARGET_ALTITUDE / 3 && STATE.vy < 0) {
    STATE.crashed = true;
    emit('lose', { reason: 'out_of_fuel' });
    setPlaying(false);
  }
});

setReady();
setPlaying(true);
