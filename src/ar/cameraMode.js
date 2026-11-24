import * as THREE from 'three';

// Запасной «AR» для телефонов без ARCore: картинка с камеры на фоне,
// а виртуальная камера поворачивается вслед за телефоном по гироскопу.
// Пол не распознаётся, поэтому зверёк стоит на воображаемом полу на ~1 м ниже телефона.
// Повороты телефона он «держит», а шаги по комнате — нет.

const LONG_SIDE_FOV = 68; // градусов: типичная основная камера телефона по длинной стороне кадра

const Z = new THREE.Vector3(0, 0, 1);
const Q_BACK = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // камера смотрит из «спины» телефона
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();

export class CameraAR {
  static get available() { return !!navigator.mediaDevices?.getUserMedia; }

  constructor({ camera, video }) {
    this.camera = camera;
    this.video = video;
    this.active = false;
    this.hasSensor = false;
    this.target = new THREE.Quaternion();
    this._onOrient = (e) => this._orient(e);
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.active = true;
    this.hasSensor = false;
    // Пока датчики молчат, смотрим вперёд-вниз, на пол.
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.setFromEuler(new THREE.Euler(-0.75, 0, 0, 'YXZ'));
    this.target.copy(this.camera.quaternion);
    window.addEventListener('deviceorientation', this._onOrient);
    this.fitFov();
  }

  stop() {
    window.removeEventListener('deviceorientation', this._onOrient);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.active = false;
  }

  /** Ждём первые данные гироскопа (не дольше ms). */
  waitForSensor(ms = 700) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (this.hasSensor || performance.now() - t0 > ms) resolve(this.hasSensor);
        else setTimeout(tick, 50);
      };
      tick();
    });
  }

  _orient(e) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const d = THREE.MathUtils.degToRad;
    const orient = d(screen.orientation?.angle ?? window.orientation ?? 0);
    euler.set(d(e.beta), d(e.alpha), -d(e.gamma), 'YXZ');
    this.target.setFromEuler(euler).multiply(Q_BACK).multiply(q0.setFromAxisAngle(Z, -orient));
    if (!this.hasSensor) {
      this.hasSensor = true;
      this.camera.quaternion.copy(this.target);
    }
  }

  update(dt) {
    if (!this.active) return;
    // Сглаживаем дрожание датчика.
    this.camera.quaternion.slerp(this.target, 1 - Math.exp(-20 * dt));
    this.camera.updateMatrixWorld();
  }

  /** Подгоняем угол обзора 3D-камеры под картинку с камеры (object-fit: cover). */
  fitFov() {
    const vw = this.video.videoWidth || 720;
    const vh = this.video.videoHeight || 1280;
    const half = THREE.MathUtils.degToRad(LONG_SIDE_FOV / 2);
    const tanLong = Math.tan(half);
    const tanV = vh >= vw ? tanLong : tanLong * (vh / vw);
    const tanH = vh >= vw ? tanLong * (vw / vh) : tanLong;
    const screenAspect = window.innerWidth / window.innerHeight;
    const fitsHeight = vw / vh > screenAspect; // видео шире экрана: по высоте влезает целиком
    const tanScreenV = fitsHeight ? tanV : tanH / screenAspect;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanScreenV));
    this.camera.aspect = screenAspect;
    this.camera.updateProjectionMatrix();
  }

  /** Горизонтальное направление взгляда телефона. */
  forward(out) {
    out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    out.y = 0;
    if (out.lengthSq() < 1e-4) out.set(0, 0, -1);
    return out.normalize();
  }
}
