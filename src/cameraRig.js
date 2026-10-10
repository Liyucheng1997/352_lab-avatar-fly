import * as THREE from 'three';
import { clamp, damp, dampAngle } from './utils/math.js';

const MODES = [
  { dist: 17, height: 4.5, look: 30, name: '追随视角' },
  { dist: 34, height: 9, look: 40, name: '远景视角' },
  { dist: 8.5, height: 2.4, look: 30, name: '近身视角' },
];

/** 第三人称追随相机：平滑跟随、速度感 FOV、震动 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.shakeAmp = 0;
    this.fov = 70;
    this.ready = false;
    this._look = new THREE.Vector3();
  }

  snap() {
    this.ready = false;
  }

  shake(a) {
    this.shakeAmp = Math.max(this.shakeAmp, a);
  }

  cycle() {
    this.mode = (this.mode + 1) % MODES.length;
    return MODES[this.mode].name;
  }

  update(dt, player, turbulence) {
    if (!this.ready) {
      this.yaw = player.yaw;
      this.pitch = player.pitch;
      this.ready = true;
    }
    this.yaw = dampAngle(this.yaw, player.yaw, 5.5, dt);
    this.pitch = damp(this.pitch, player.pitch, 4, dt);
    this.roll = damp(this.roll, player.roll, 3, dt);
    const m = MODES[this.mode];
    const pull = clamp((player.speed - 70) / 150, 0, 1) * 4;
    const cp = Math.cos(this.pitch * 0.6), sp = Math.sin(this.pitch * 0.6);
    const cam = this.camera;
    cam.position.set(Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp)
      .multiplyScalar(m.dist + pull)
      .add(player.position);
    cam.position.y += m.height;
    if (cam.position.y < -135) cam.position.y = -135;

    const fcp = Math.cos(this.pitch);
    this._look.set(-Math.sin(this.yaw) * fcp, Math.sin(this.pitch), -Math.cos(this.yaw) * fcp)
      .multiplyScalar(m.look)
      .add(player.position);
    this._look.y += m.height * 0.4;

    const shake = this.shakeAmp + turbulence * 0.25;
    if (shake > 0.001) {
      const t = performance.now() * 0.001;
      cam.position.x += Math.sin(t * 47) * shake * 1.2;
      cam.position.y += Math.sin(t * 59 + 1) * shake * 1.0;
      cam.position.z += Math.cos(t * 53) * shake * 1.2;
    }
    this.shakeAmp *= Math.exp(-dt * 3);

    cam.up.set(0, 1, 0);
    cam.lookAt(this._look);
    cam.rotateZ(this.roll * 0.3);

    const targetFov = 68 + clamp((player.speed - 70) / 160, 0, 1) * 20 + (player.boosting ? 5 : 0);
    this.fov = damp(this.fov, targetFov, 3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
