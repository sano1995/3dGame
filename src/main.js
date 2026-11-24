import * as THREE from 'three';
import './style.css';
import { Creature } from './pet/Creature.js';
import { PALETTES } from './pet/palettes.js';
import { Sfx } from './audio/sfx.js';
import { VoiceEcho } from './audio/voice.js';
import { Particles } from './fx/particles.js';
import { AR } from './ar/ar.js';

const AR_SCALE = 0.24; // в AR зверёк ~35 см вместе с ушками

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
  fitCamera();
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
});
canvas.addEventListener('pointermove', (e) => {
  if (!gesture.active) return;
  rayFromEvent(e);
  gestureMove();
});
const up = () => gestureUp();
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);

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
    gestureDown();
  },
  onSelectEnd: () => gestureUp(),
  onEnd: () => leaveAR(),
});
let placed = false;

function placePet(pos) {
  anchor.position.copy(pos);
  anchor.visible = true;
  placed = true;
  ar.wantReticle = false;
  // Сразу смотрит на ребёнка.
  const cam = renderer.xr.getCamera().getWorldPosition(tmp);
  pet.root.rotation.y = Math.atan2(cam.x - pos.x, cam.z - pos.z);
  pet.play('appear');
  ui.place.hidden = false;
}

async function enterAR() {
  sfx.unlock();
  try {
    await ar.start();
  } catch (err) {
    console.warn('AR не запустился', err);
    ui.ar.classList.add('shake');
    setTimeout(() => ui.ar.classList.remove('shake'), 600);
    return;
  }
  document.body.classList.add('ar');
  home.visible = false;
  anchor.visible = false;
  anchor.scale.setScalar(AR_SCALE);
  pet.facingBias = 0;
  placed = false;
  ar.wantReticle = true;
  ui.ar.hidden = true;
  ui.home.hidden = false;
  ui.place.hidden = true;
  hideHint();
}

function leaveAR() {
  document.body.classList.remove('ar');
  home.visible = true;
  anchor.visible = true;
  anchor.position.set(0, 0, 0);
  anchor.scale.setScalar(1);
  pet.root.rotation.y = HOME_FACING;
  pet.facingBias = HOME_FACING;
  ui.ar.hidden = !arSupported;
  ui.home.hidden = true;
  ui.place.hidden = true;
  fitCamera();
}

// ---------- интерфейс ----------
const $ = (id) => document.getElementById(id);
const ui = {
  voice: $('btn-voice'), color: $('btn-color'), ar: $('btn-ar'),
  place: $('btn-place'), home: $('btn-home'), badge: $('badge'), hint: $('hint'),
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

ui.ar.addEventListener('click', enterAR);
ui.home.addEventListener('click', () => ar.end());
ui.place.addEventListener('click', () => {
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
AR.isSupported().then((ok) => {
  arSupported = ok;
  ui.ar.hidden = !ok;
  ui.badge.textContent = ok ? 'AR ✓' : 'AR ✗ · режим «Домик»';
  ui.badge.classList.toggle('no', !ok);
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

  if (inAR && frame) {
    ar.update(frame, time);
    if (ar.selecting && gesture.active) { ar.setRay(raycaster); gestureMove(); }
  }

  // Куда смотрит зверёк: на палец, если его трогают, иначе на ребёнка (камеру).
  (inAR ? renderer.xr.getCamera() : camera).getWorldPosition(camPos);
  if (!inAR && gesture.active && raycaster.ray.intersectPlane(lookPlane, tmp)) pet.lookTarget.copy(tmp);
  else pet.lookTarget.copy(camPos);
  pet.faceTarget = camPos;

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

  if (hintOn && !inAR) {
    const p = pet.pointIn(scene, 'center').project(camera);
    ui.hint.style.left = `${(p.x * 0.5 + 0.5) * window.innerWidth}px`;
    ui.hint.style.top = `${(-p.y * 0.5 + 0.5) * window.innerHeight}px`;
  }

  renderer.render(scene, camera);
});

if (import.meta.env.DEV) window.__app = { pet, camera, scene, renderer, particles, sfx, voice, homeView, fitCamera };
