import * as pc from 'playcanvas';
import {
  emit,
  initPlayGen,
  reportError,
  setLevel,
  setPlaying,
  setReady,
  setScore,
  tick,
} from './playgen';

const canvas = document.getElementById('app') as HTMLCanvasElement;
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
  clearColor: new pc.Color(0.1, 0.1, 0.15),
  fov: 55,
});
camera.setPosition(0, 14, 14);
camera.lookAt(0, 0, 0);
app.root.addChild(camera);

const light = new pc.Entity('light');
light.addComponent('light', { type: 'directional', intensity: 1.5 });
light.setEulerAngles(45, 30, 0);
app.root.addChild(light);

const ground = new pc.Entity('ground');
ground.addComponent('render', { type: 'box' });
ground.setLocalScale(20, 0.2, 20);
app.root.addChild(ground);

const player = new pc.Entity('player');
player.addComponent('render', { type: 'box' });
player.setLocalScale(0.8, 0.8, 0.8);
player.setPosition(0, 0.5, 0);
app.root.addChild(player);

const pickup = new pc.Entity('pickup');
pickup.addComponent('render', { type: 'sphere' });
pickup.setLocalScale(0.6, 0.6, 0.6);
pickup.setPosition(5, 0.5, 5);
app.root.addChild(pickup);

const goal = new pc.Entity('goal');
goal.addComponent('render', { type: 'box' });
goal.setLocalScale(2, 0.05, 2);
goal.setPosition(0, 0.05, -8);
app.root.addChild(goal);

initPlayGen({ level: 'tutorial' });
setLevel('tutorial');

const SPEED = 6;
const BOUNDS = 11;

let score = 0;
let won = false;
let lost = false;

const touchVec = new pc.Vec3();
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
    const dx = (t.clientX - touchStart.x) / 50;
    const dy = (t.clientY - touchStart.y) / 50;
    touchVec.set(
      Math.max(-1, Math.min(1, dx)),
      0,
      Math.max(-1, Math.min(1, dy)),
    );
  },
  { passive: true },
);
canvas.addEventListener(
  'touchend',
  () => {
    touchStart = null;
    touchVec.set(0, 0, 0);
  },
  { passive: true },
);

app.on('update', (dt: number) => {
  tick(dt);
  if (won || lost) return;

  const dir = new pc.Vec3();
  const kb = app.keyboard;
  if (kb?.isPressed(pc.KEY_LEFT) || kb?.isPressed(pc.KEY_A)) dir.x -= 1;
  if (kb?.isPressed(pc.KEY_RIGHT) || kb?.isPressed(pc.KEY_D)) dir.x += 1;
  if (kb?.isPressed(pc.KEY_UP) || kb?.isPressed(pc.KEY_W)) dir.z -= 1;
  if (kb?.isPressed(pc.KEY_DOWN) || kb?.isPressed(pc.KEY_S)) dir.z += 1;

  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = pads[0];
  if (pad) {
    const ax0 = pad.axes[0] ?? 0;
    const ax1 = pad.axes[1] ?? 0;
    if (Math.abs(ax0) > 0.15) dir.x += ax0;
    if (Math.abs(ax1) > 0.15) dir.z += ax1;
    if (pad.buttons[12]?.pressed) dir.z -= 1;
    if (pad.buttons[13]?.pressed) dir.z += 1;
    if (pad.buttons[14]?.pressed) dir.x -= 1;
    if (pad.buttons[15]?.pressed) dir.x += 1;
  }

  if (touchVec.lengthSq() > 0) {
    dir.x += touchVec.x;
    dir.z += touchVec.z;
  }

  if (dir.lengthSq() > 0) {
    dir.normalize().mulScalar(SPEED * dt);
    player.translate(dir.x, 0, dir.z);
  }

  const p = player.getPosition();
  if (pickup.enabled && p.distance(pickup.getPosition()) < 1) {
    pickup.enabled = false;
    score += 10;
    setScore(score);
    emit('pickup', { id: 'pickup-1', score });
  }

  if (p.distance(goal.getPosition()) < 1.5) {
    won = true;
    emit('win', { score });
    setPlaying(false);
    return;
  }

  if (Math.abs(p.x) > BOUNDS || Math.abs(p.z) > BOUNDS) {
    lost = true;
    emit('lose', { reason: 'out_of_bounds' });
    setPlaying(false);
  }
});

setReady();
setPlaying(true);
