import * as THREE from 'three';

// AR через WebXR: Chrome на Android сам использует ARCore.
// Ищем пол или стол (hit-test), показываем кружок, по тапу сажаем туда зверька.

export class AR {
  static async isSupported() {
    try {
      return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar')));
    } catch {
      return false;
    }
  }

  constructor({ renderer, scene, overlay, onSelectStart, onSelectEnd, onEnd }) {
    this.renderer = renderer;
    this.overlay = overlay;
    this.onEnd = onEnd;
    this.session = null;
    this.hitSource = null;
    this.selecting = false;
    this.wantReticle = true;
    this._m = new THREE.Matrix4();

    this.reticle = new THREE.Group();
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    );
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.025, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff8fc0 }),
    );
    this.reticle.add(ring, dot);
    this.ring = ring;
    scene.add(this.reticle);

    this.controller = renderer.xr.getController(0);
    this.controller.addEventListener('selectstart', () => { this.selecting = true; onSelectStart(); });
    this.controller.addEventListener('selectend', () => { this.selecting = false; onSelectEnd(); });
    scene.add(this.controller);
  }

  get active() { return !!this.session; }

  async start() {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: this.overlay },
    });
    this.renderer.xr.setReferenceSpaceType('local');
    await this.renderer.xr.setSession(session);
    this.session = session;
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitSource = await session.requestHitTestSource({ space: viewer });
    session.addEventListener('end', () => {
      this.hitSource = null;
      this.session = null;
      this.selecting = false;
      this.reticle.visible = false;
      this.onEnd?.();
    });
  }

  end() { this.session?.end(); }

  /** Вызывается каждый кадр в AR: обновляет кружок-прицел. */
  update(frame, time) {
    if (!this.hitSource) return;
    const results = frame.getHitTestResults(this.hitSource);
    const pose = results.length ? results[0].getPose(this.renderer.xr.getReferenceSpace()) : null;
    // Берём только горизонтальные поверхности (пол, стол).
    let ok = false;
    if (pose) {
      this.reticle.matrix.fromArray(pose.transform.matrix);
      ok = this.reticle.matrix.elements[5] > 0.75;
    }
    this.reticle.visible = ok && this.wantReticle;
    const s = 1 + 0.08 * Math.sin(time * 0.006);
    this.ring.scale.set(s, 1, s);
  }

  /** Точка прицела, если он сейчас на поверхности. */
  reticlePosition(out) {
    if (!this.reticle.visible) return null;
    return out.setFromMatrixPosition(this.reticle.matrix);
  }

  /** Луч от пальца на экране (WebXR присылает его как «контроллер»). */
  setRay(raycaster) {
    this._m.identity().extractRotation(this.controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(this.controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._m);
  }
}
