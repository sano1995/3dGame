import * as THREE from 'three';
import './style.css';
import { Creature } from './pet/Creature.js';
import { PALETTES } from './pet/palettes.js';
import { Sfx } from './audio/sfx.js';
import { VoiceEcho } from './audio/voice.js';
import { Particles } from './fx/particles.js';
import { AR } from './ar/ar.js';
import { CameraAR } from './ar/cameraMode.js';

const AR_SCALE = 0.24; // в AR зверёк ~35 см вместе с ушками
const XR_RETRY_MS = 7 * 24 * 3600 * 1000; // если настоящий AR не завёлся, неделю сразу идём в режим камеры

// Режим: 'home' — «Домик», 'xr' — настоящий AR (ARCore), 'cam' — камера + гироскоп.
let mode = 'home';

// ---------- хранилище (может быть недоступно — тогда просто не запоминаем) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ничего */ } },
};

// ---------- сцена ----------
const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.01, 50);

scene.add(new THREE.HemisphereLight(0xffffff, 0xf3d6ff, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(-1.2, 3, 2.5);
scene.add(sun);

// Домик: коврик под зверьком (в AR прячем).
const home = new THREE.Group();
scene.add(home);
const rugMat = new THREE.MeshToonMaterial({ color: 0xffd9ea });
const rug = new THREE.Mesh(new THREE.CircleGeometry(0.86, 64).rotateX(-Math.PI / 2), rugMat);
const rugEdge = new THREE.Mesh(
  new THREE.CircleGeometry(0.94, 64).rotateX(-Math.PI / 2),
  new THREE.MeshToonMaterial({ color: 0xf6b9d6 }),
);
rugEdge.position.y = -0.004;
const rugInner = new THREE.Mesh(
  new THREE.RingGeometry(0.62, 0.66, 64).rotateX(-Math.PI / 2),
  new THREE.MeshToonMaterial({ color: 0xfff1f7 }),
);
rugInner.position.y = 0.002;
home.add(rugEdge, rug, rugInner);

// Якорь: всё, что относится к зверьку (в AR переносится на пол и уменьшается).
const anchor = new THREE.Group();
scene.add(anchor);

const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(60,30,70,0.45)');
  grad.addColorStop(0.6, 'rgba(60,30,70,0.18)');
  grad.addColorStop(1, 'rgba(60,30,70,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
);
shadow.position.y = 0.006;
shadow.renderOrder = 1;
anchor.add(shadow);

let paletteIndex = store.get('palette', 0) % PALETTES.length;
const pet = new Creature(PALETTES[paletteIndex]);
anchor.add(pet.root);
const particles = new Particles(anchor);

// ---------- звук и Повторялка ----------
const sfx = new Sfx();
const voice = new VoiceEcho(sfx);

pet.on((type, data) => {
  if (type === 'sfx') sfx.play(data);
  else if (type === 'hearts') particles.spawn('heart', pet.pointIn(anchor, 'head'), data.n);
  else if (type === 'sparkle') particles.spawn('star', pet.pointIn(anchor, data.at), data.n);
  else if (type === 'puff') {
    const from = pet.pointIn(anchor, 'nose');
    const dir = from.clone().sub(pet.pointIn(anchor, 'center')).setY(0).normalize();
    particles.spawn('puff', from, data.n, dir);
  }
});

// ---------- камера в режиме «Домик» ----------
const homeView = { yaw: 0 };
function fitCamera() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const d = Math.max(1.05 / Math.tan(vfov / 2), 0.95 / Math.tan(hfov / 2));
  camera.position.set(Math.sin(homeView.yaw) * d, 0.55 + d * 0.2, Math.cos(homeView.yaw) * d);
  camera.lookAt(0, 0.5, 0);
  camera.updateProjectionMatrix();
}
fitCamera();
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (mode === 'home') fitCamera();
  else if (mode === 'cam') camAR.fitFov();
});

// ---------- касания: тык и поглаживание ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const gesture = { active: false, part: null, t0: 0, moved: 0, lastMove: 0, petting: false, last: new THREE.Vector3() };
const tmp = new THREE.Vector3();

function hitPet() {
  const hits = raycaster.intersectObject(pet.root, true);
  for (const h of hits) if (h.object.userData.part) return h;
  return null;
}

function gestureDown() {
  const h = hitPet();
  if (!h) return false;
  gesture.active = true;
  gesture.part = h.object.userData.part;
  gesture.t0 = performance.now();
  gesture.moved = 0;
  gesture.petting = false;
  gesture.last.copy(anchor.worldToLocal(h.point.clone()));
  hideHint();
  return true;
}

function gestureMove() {
  if (!gesture.active) return;
  const h = hitPet();
  if (!h || !Creature.isPettable(h.object.userData.part)) return;
  const p = anchor.worldToLocal(h.point.clone());
  gesture.moved += p.distanceTo(gesture.last);
  gesture.last.copy(p);
  gesture.lastMove = performance.now();
  if (gesture.moved > 0.12) gesture.petting = true;
}

function gestureUp() {
  if (!gesture.active) return;
  const quick = performance.now() - gesture.t0 < 450;
  if (!gesture.petting && quick) pet.react(gesture.part);
  gesture.active = false;
  gesture.petting = false;
}

const isPetting = () => gesture.active && gesture.petting && performance.now() - gesture.lastMove < 350;

function rayFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  rayFromEvent(e);
  if (gestureDown()) canvas.setPointerCapture(e.pointerId);
  else callToFloor(mode === 'home' ? 1.0 : 5 / AR_SCALE);
});
canvas.addEventListener('pointermove', (e) => {
  if (!gesture.active) return;
  rayFromEvent(e);
  gestureMove();
});
const up = () => gestureUp();
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);

// ---------- прогулки ----------
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const HOME_RADIUS = 0.5; // в «Домике» гуляет по коврику
// Экран телефона узкий: по бокам гуляем меньше, чем вперёд-назад.
const clampHome = (v) => {
  if (v.length() > HOME_RADIUS) v.setLength(HOME_RADIUS);
  v.x = THREE.MathUtils.clamp(v.x, -0.34, 0.34);
  return v;
};
const camFloor = new THREE.Vector3();
let followCooldown = 0;

/** Тап по полу: зверёк бежит к этому месту. maxDist — в единицах якоря. */
function callToFloor(maxDist) {
  if (mode !== 'home' && !placed) return;
  floorPlane.constant = -anchor.position.y;
  if (!raycaster.ray.intersectPlane(floorPlane, tmp)) return;
  const local = anchor.worldToLocal(tmp.clone());
  local.y = 0;
  if (local.length() > maxDist) return;
  if (mode === 'home') {
    if (local.length() > 1.05) return; // мимо коврика
    clampHome(local);
  }
  hideHint();
  const far = local.distanceTo(pet.root.position) > (mode === 'home' ? 0.35 : 2.5);
  pet.goTo(local, { run: far });
  particles.spawn('star', local.clone().setY(0.05), 6);
  sfx.play('pip');
}

pet.pickWanderPoint = () => {
  const p = new THREE.Vector3();
  if (mode === 'home') {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * HOME_RADIUS;
    return clampHome(p.set(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  if (!placed) return null;
  // В AR гуляет недалеко, но так, чтобы оставаться перед ребёнком и не лезть под ноги.
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    p.copy(pet.root.position).add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.8 + Math.random() * 1.5));
    const d = p.distanceTo(camFloor);
    if (d > 2.2 && d < 7) return p;
  }
  return null;
};

/** В AR: если ребёнок отошёл далеко, зверёк бежит следом. */
function followInAR(dt) {
  followCooldown -= dt;
  camFloor.copy(anchor.worldToLocal(camPos.clone()));
  camFloor.y = 0;
  if (followCooldown > 0 || pet.moving || pet.action) return;
  const d = camFloor.distanceTo(pet.root.position);
  if (d > 7.5) {
    const to = pet.root.position.clone().sub(camFloor).setLength(3).add(camFloor);
    pet.goTo(to, { run: true });
    followCooldown = 1.5;
  }
}

// ---------- AR ----------
const arPos = new THREE.Vector3();
const ar = new AR({
  renderer, scene, overlay,
  onSelectStart: () => {
    sfx.unlock();
    if (!placed) {
      if (ar.reticlePosition(arPos)) placePet(arPos);
      return;
    }
    ar.setRay(raycaster);
    if (!gestureDown()) callToFloor(5 / AR_SCALE);
  },
  onSelectEnd: () => gestureUp(),
  onEnd: () => leaveWorld(),
});
let placed = false;

function placePet(pos) {
  anchor.position.copy(pos);
  anchor.visible = true;
  placed = true;
  ar.wantReticle = false;
  pet.stop();
  pet.root.position.set(0, 0, 0);
  // Сразу смотрит на ребёнка.
  const cam = (mode === 'xr' ? renderer.xr.getCamera() : camera).getWorldPosition(tmp);
  pet.root.rotation.y = Math.atan2(cam.x - pos.x, cam.z - pos.z);
  pet.play('appear');
  ui.place.hidden = false;
}

const camAR = new CameraAR({ camera, video: document.getElementById('camfeed') });

function setWorldUI() {
  home.visible = false;
  anchor.scale.setScalar(AR_SCALE);
  pet.facingBias = 0;
  ui.ar.hidden = true;
  ui.home.hidden = false;
  hideHint();
}

async function enterWorld() {
  sfx.unlock();
  const xrRecentlyFailed = Date.now() - store.get('xrFailedAt', 0) < XR_RETRY_MS;
  if (arSupported && !xrRecentlyFailed) {
    try {
      await ar.start();
      mode = 'xr';
      document.body.classList.add('ar');
      setWorldUI();
      anchor.visible = false;
      placed = false;
      ar.wantReticle = true;
      ui.place.hidden = true;
      return;
    } catch (err) {
      console.warn('AR не запустился', err);
      store.set('xrFailedAt', Date.now());
      toast(`Настоящий AR (ARCore) на этом телефоне не запустился (${err?.name || 'ошибка'}). Включаю режим камеры.`);
    }
  }
  await enterCam();
}

async function enterCam() {
  try {
    await camAR.start();
  } catch (err) {
    console.warn('Камера недоступна', err);
    toast('Нет доступа к камере. Разрешите камеру для этого сайта в настройках Chrome.');
    ui.ar.classList.add('shake');
    setTimeout(() => ui.ar.classList.remove('shake'), 600);
    return;
  }
  mode = 'cam';
  document.body.classList.add('cam');
  setWorldUI();
  anchor.visible = false;
  await camAR.waitForSensor();
  placeInFront();
}

/**
 * Режим камеры: сажаем зверька туда, куда смотрит телефон.
 * Настоящего пола мы не знаем, поэтому «пол» ставим на такой высоте,
 * чтобы зверёк оказался в центре экрана примерно в метре от телефона.
 */
function placeInFront() {
  const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const down = THREE.MathUtils.clamp(Math.asin(-look.y), 0.35, 1.2); // наклон телефона вниз
  const dist = 1.1;
  arPos.copy(camAR.forward(new THREE.Vector3())).multiplyScalar(dist);
  arPos.y = THREE.MathUtils.clamp(-dist * Math.tan(down), -1.5, -0.4);
  placePet(arPos);
}

function leaveWorld() {
  if (mode === 'cam') camAR.stop();
  mode = 'home';
  document.body.classList.remove('ar', 'cam');
  placed = false;
  home.visible = true;
  anchor.visible = true;
  anchor.position.set(0, 0, 0);
  anchor.scale.setScalar(1);
  pet.stop();
  pet.root.position.set(0, 0, 0);
  pet.root.rotation.y = HOME_FACING;
  pet.facingBias = HOME_FACING;
  ui.ar.hidden = !worldAvailable;
  ui.home.hidden = true;
  ui.place.hidden = true;
  camera.fov = 36;
  fitCamera();
}

function toast(text) {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { ui.toast.hidden = true; }, 6000);
}

// ---------- интерфейс ----------
const $ = (id) => document.getElementById(id);
const ui = {
  voice: $('btn-voice'), color: $('btn-color'), ar: $('btn-ar'),
  place: $('btn-place'), home: $('btn-home'), badge: $('badge'), hint: $('hint'), toast: $('toast'),
};
// Нажатия на кнопки не должны превращаться в «тап по миру» в AR.
$('bar').addEventListener('beforexrselect', (e) => e.preventDefault());

ui.color.addEventListener('click', () => {
  sfx.unlock();
  paletteIndex = (paletteIndex + 1) % PALETTES.length;
  store.set('palette', paletteIndex);
  pet.play('poof', { force: true });
  setTimeout(() => pet.setPalette(PALETTES[paletteIndex]), 120);
});

ui.voice.addEventListener('click', async () => {
  sfx.unlock();
  if (voice.enabled) { voice.disable(); return; }
  try {
    await voice.enable();
    pet.play('headTilt');
  } catch (err) {
    console.warn('Микрофон недоступен', err);
    ui.voice.classList.add('shake');
    setTimeout(() => ui.voice.classList.remove('shake'), 600);
  }
});
voice.onState = (s) => {
  ui.voice.classList.toggle('on', s !== 'off');
  ui.voice.classList.toggle('hearing', s === 'recording');
};

ui.ar.addEventListener('click', enterWorld);
ui.home.addEventListener('click', () => (mode === 'xr' ? ar.end() : leaveWorld()));
ui.place.addEventListener('click', () => {
  if (mode === 'cam') { placeInFront(); return; }
  placed = false;
  anchor.visible = false;
  ar.wantReticle = true;
  ui.place.hidden = true;
});

// Подсказка-ручка: показывает, куда тыкать, пока ребёнок не потрогает зверька.
let hintOn = true;
function hideHint() {
  if (!hintOn) return;
  hintOn = false;
  ui.hint.hidden = true;
}
ui.hint.hidden = false;

let arSupported = false;
let worldAvailable = false;
AR.isSupported().then((ok) => {
  arSupported = ok;
  worldAvailable = ok || CameraAR.available;
  ui.ar.hidden = !worldAvailable;
  const xrFailed = Date.now() - store.get('xrFailedAt', 0) < XR_RETRY_MS;
  const full = ok && !xrFailed;
  ui.badge.textContent = full ? 'AR ✓' : worldAvailable ? 'AR: режим камеры' : 'AR ✗ · режим «Домик»';
  ui.badge.classList.toggle('no', !full);
  ui.badge.hidden = false;
  setTimeout(() => { ui.badge.hidden = true; }, 6000);
});

// ---------- главный цикл ----------
const HOME_FACING = -0.3; // чуть боком к камере: видно хвост
pet.root.rotation.y = HOME_FACING;
pet.facingBias = HOME_FACING;
pet.play('appear');

const timer = new THREE.Timer();
const camPos = new THREE.Vector3();
const lookPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.9);
let heartTimer = 0;

renderer.setAnimationLoop((time, frame) => {
  timer.update(time);
  const dt = Math.min(0.05, timer.getDelta());
  const inAR = renderer.xr.isPresenting;

  if (mode === 'cam') camAR.update(dt);
  if (inAR && frame) {
    ar.update(frame, time);
    if (ar.selecting && gesture.active) { ar.setRay(raycaster); gestureMove(); }
  }

  // Куда смотрит зверёк: на палец, если его трогают, иначе на ребёнка (камеру).
  (inAR ? renderer.xr.getCamera() : camera).getWorldPosition(camPos);
  if (mode === 'home' && gesture.active && raycaster.ray.intersectPlane(lookPlane, tmp)) pet.lookTarget.copy(tmp);
  else pet.lookTarget.copy(camPos);
  pet.faceTarget = camPos;
  if (mode !== 'home' && placed) followInAR(dt);

  pet.petting = isPetting();
  voice.update();
  pet.talk = voice.playLevel;
  pet.listening = voice.state === 'recording';
  pet.update(dt);

  sfx.setPurr(pet.petLevel > 0.15 ? pet.petLevel : 0);
  if (pet.petting) {
    heartTimer -= dt;
    if (heartTimer <= 0) { heartTimer = 0.45; particles.spawn('heart', pet.pointIn(anchor, 'head'), 1); }
  }
  particles.update(dt);

  // Тень меньше и бледнее, когда зверёк подпрыгивает.
  const j = pet.hop.position.y;
  const s = (0.95 - j * 0.9) * pet.hop.scale.x;
  shadow.position.set(pet.root.position.x, 0.006, pet.root.position.z);
  shadow.scale.set(s, 1, s * 0.85);
  shadow.material.opacity = Math.max(0.2, 1 - j * 2.5);

  if (hintOn && mode === 'home') {
    const p = pet.pointIn(scene, 'center').project(camera);
    ui.hint.style.left = `${(p.x * 0.5 + 0.5) * window.innerWidth}px`;
    ui.hint.style.top = `${(-p.y * 0.5 + 0.5) * window.innerHeight}px`;
  }

  renderer.render(scene, camera);
});

if (import.meta.env.DEV) window.__app = { pet, camera, scene, renderer, particles, sfx, voice, homeView, fitCamera, camAR, getMode: () => mode };
