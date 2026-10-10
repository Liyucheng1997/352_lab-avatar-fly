import * as THREE from 'three';
import { buildIkran, PALETTES } from './ikran.js';
import { clamp, damp, wrapAngle } from './utils/math.js';

const TRAIL_N = 40;

/** 玩家：伊卡兰坐骑 + 街机式飞行物理 */
export class Player {
  constructor(scene, opts = {}) {
    this.ikran = buildIkran(opts.palette || PALETTES.player);
    this.trailColor = opts.trailColor || new THREE.Color(0.5, 0.95, 1.3);
    this.group = new THREE.Group();
    this.group.add(this.ikran.root);
    scene.add(this.group);
    this.position = this.group.position;

    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 70;
    this.energy = 100;
    this.velocity = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.stunTime = 0;
    this.boosting = false;
    this.flapping = false;
    this.turnSmooth = 0;
    this.pitchRate = 0;
    this.onFlap = null;

    this.flapPhase = 0;
    this.flapFreq = 0.6;
    this.flapAmp = 0.1;
    this.tuck = 0;
    this.animTime = 0;

    // 翼尖尾迹
    this.trailMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.trails = this.ikran.tips.map((tip) => {
      const pos = new Float32Array(TRAIL_N * 3);
      const col = new Float32Array(TRAIL_N * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(geo, this.trailMat);
      line.frustumCulled = false;
      scene.add(line);
      return { tip, pos, col, geo, init: false };
    });
    this._v = new THREE.Vector3();
  }

  _updateForward() {
    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  setDirection(dir) {
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(clamp(dir.y, -1, 1));
  }

  placeAt(pos, dir) {
    this.position.copy(pos);
    this.setDirection(dir);
    this.roll = 0;
    this.speed = 70;
    this.energy = 100;
    this.stunTime = 0;
    this.velocity.set(0, 0, 0);
    this._updateForward();
    this._applyTransform();
    this.trails.forEach((t) => (t.init = false));
  }

  stun() {
    this.stunTime = 1.4;
    this.speed *= 0.55;
  }

  /** ctl: { turn, pitch, flap, boost }，env: { wind, turbulence, time } */
  update(dt, ctl, env) {
    let pitchIn = ctl.pitch, turnIn = ctl.turn;
    const stunned = this.stunTime > 0;
    if (stunned) {
      this.stunTime -= dt;
      pitchIn += Math.sin(env.time * 23) * 0.9;
      turnIn += Math.cos(env.time * 17) * 0.9;
    }
    const turb = env.turbulence;
    const tp = Math.sin(env.time * 1.7) * Math.sin(env.time * 0.63 + 1.2) * turb * 0.9;
    const tr = Math.sin(env.time * 2.3 + 0.5) * Math.cos(env.time * 0.81) * turb * 0.45;

    const prevPitch = this.pitch;
    this.pitch += (pitchIn * 1.25 + tp) * dt;
    if (Math.abs(pitchIn) < 0.05) this.pitch *= 1 - dt * 0.3;
    this.pitch = clamp(this.pitch, -1.3, 1.3);
    this.pitchRate = (this.pitch - prevPitch) / Math.max(dt, 1e-4);
    this.yaw = wrapAngle(this.yaw - turnIn * 1.15 * dt);
    this.turnSmooth = damp(this.turnSmooth, turnIn, 4, dt);
    this.roll = damp(this.roll, -turnIn * 0.95 + tr, 5, dt);

    // 推力 / 阻力 / 重力
    this.flapping = ctl.flap || this.speed < 48;
    let thrust = this.flapping ? 72 : 22;
    this.boosting = ctl.boost && this.energy > 1 && !stunned;
    if (this.boosting) {
      thrust += 130;
      this.energy = Math.max(0, this.energy - 28 * dt);
    } else {
      this.energy = Math.min(100, this.energy + 7 * dt);
    }
    const drag = 0.0042 * this.speed * this.speed;
    const grav = -62 * Math.sin(this.pitch);
    this.speed = clamp(this.speed + (thrust - drag + grav) * dt, 30, 260);

    this._updateForward();
    this.velocity.copy(this.forward).multiplyScalar(this.speed).add(env.wind);
    this.position.addScaledVector(this.velocity, dt);
    this._applyTransform();
    this._animate(dt);
  }

  /** 菜单 / 结算界面中的自动巡航 */
  autopilot(dt, target, dir) {
    const newYaw = Math.atan2(-dir.x, -dir.z);
    const dyaw = wrapAngle(newYaw - this.yaw);
    this.turnSmooth = damp(this.turnSmooth, clamp(-dyaw / Math.max(dt, 1e-3) * 1.2, -1, 1), 2, dt);
    this.roll = damp(this.roll, -this.turnSmooth * 0.8, 3, dt);
    this.yaw = newYaw;
    this.pitch = damp(this.pitch, Math.asin(clamp(dir.y, -1, 1)), 3, dt);
    this.position.lerp(target, 1 - Math.exp(-dt * 2));
    this.speed = 85;
    this.flapping = dir.y > 0.08 || Math.sin(this.animTime * 0.4) > 0.6;
    this.boosting = false;
    this._updateForward();
    this.velocity.copy(this.forward).multiplyScalar(this.speed);
    this._applyTransform();
    this._animate(dt);
  }

  /** 精确沿给定位置/方向飞行（AI 对手使用） */
  follow(dt, pos, dir, speed, flapping, boosting) {
    const newYaw = Math.atan2(-dir.x, -dir.z);
    const dyaw = wrapAngle(newYaw - this.yaw);
    this.turnSmooth = damp(this.turnSmooth, clamp(-dyaw / Math.max(dt, 1e-3) * 1.4, -1, 1), 3, dt);
    this.roll = damp(this.roll, -this.turnSmooth * 0.85 + (this.stunTime > 0 ? Math.sin(this.animTime * 20) * 0.5 : 0), 4, dt);
    this.yaw = newYaw;
    const prevPitch = this.pitch;
    this.pitch = damp(this.pitch, Math.asin(clamp(dir.y, -1, 1)), 6, dt);
    this.pitchRate = (this.pitch - prevPitch) / Math.max(dt, 1e-4);
    this.velocity.subVectors(pos, this.position).divideScalar(Math.max(dt, 1e-4));
    this.position.copy(pos);
    this.speed = speed;
    this.flapping = flapping;
    this.boosting = boosting;
    this._updateForward();
    this.ikran.root.position.y = 0;
    this._applyTransform();
    this._animate(dt);
  }

  /** 倒计时阶段悬停 */
  hover(dt, time) {
    this.flapping = true;
    this.boosting = false;
    this.roll = damp(this.roll, 0, 3, dt);
    this.velocity.set(0, 0, 0);
    this.ikran.root.position.y = Math.sin(time * 4.6) * 0.4;
    this._applyTransform();
    this._animate(dt, 0.75);
  }

  /** 碰撞响应，返回冲击强度 */
  applyCollision(hit) {
    const n = hit.normal;
    this.position.addScaledVector(n, hit.depth + 0.5);
    const f = this.forward;
    const into = f.dot(n);
    if (into < 0) {
      f.addScaledVector(n, -into * 1.3).normalize();
      this.setDirection(f);
    }
    const impact = -Math.min(0, into) * this.speed;
    this.speed = Math.max(30, this.speed * (0.55 + 0.4 * (1 + Math.min(0, into))));
    this._applyTransform();
    return impact;
  }

  _applyTransform() {
    this.group.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  _animate(dt, forcedAmp) {
    this.animTime += dt;
    const diving = this.pitch < -0.45 && !this.flapping;
    let tf, ta, tt;
    if (this.boosting) { tf = 3.0; ta = 0.6; tt = 0.45; }
    else if (this.flapping) { tf = 2.3; ta = 0.85; tt = 0; }
    else if (diving) { tf = 0.4; ta = 0.03; tt = 1; }
    else { tf = 0.55; ta = 0.1; tt = 0; }
    if (forcedAmp != null) { tf = 2.0; ta = forcedAmp; tt = 0; }
    this.flapFreq = damp(this.flapFreq, tf, 3, dt);
    this.flapAmp = damp(this.flapAmp, ta, 4, dt);
    this.tuck = damp(this.tuck, tt, 3, dt);

    const prev = Math.sin(this.flapPhase);
    this.flapPhase += dt * this.flapFreq * Math.PI * 2;
    const s = Math.sin(this.flapPhase);
    if (prev > 0 && s <= 0 && this.flapAmp > 0.4 && this.onFlap) this.onFlap(this.flapAmp);

    const amp = this.flapAmp, tuck = this.tuck;
    for (const w of this.ikran.wings) {
      w.inner.rotation.z = w.side * (s * amp + 0.12 - tuck * 0.1);
      w.inner.rotation.y = -w.side * tuck * 0.55;
      w.outer.rotation.z = Math.sin(this.flapPhase - 0.9) * amp * 0.75 - 0.05 + tuck * 0.1;
      w.outer.rotation.y = -tuck * 1.0;
    }
    if (forcedAmp == null) this.ikran.root.position.y = -s * amp * 0.35;

    const t = this.animTime;
    this.ikran.tail.forEach((seg, i) => {
      seg.rotation.y = Math.sin(t * 2.2 - i * 0.7) * 0.07 + this.turnSmooth * 0.1;
      seg.rotation.x = Math.sin(t * 1.6 - i * 0.5) * 0.04 + clamp(this.pitchRate, -1, 1) * 0.04;
    });
    this.ikran.head.rotation.y = -this.turnSmooth * 0.3;
    this.ikran.head.rotation.x = Math.sin(t * 1.1) * 0.05;
  }

  updateTrails(stormIntensity) {
    this.group.updateMatrixWorld(true);
    const vis = clamp((this.speed - 105) / 80, 0, 1) + (this.boosting ? 0.7 : 0) + stormIntensity * 0.3;
    for (const tr of this.trails) {
      tr.tip.getWorldPosition(this._v);
      if (!tr.init) {
        for (let i = 0; i < TRAIL_N; i++) tr.pos.set([this._v.x, this._v.y, this._v.z], i * 3);
        tr.init = true;
      }
      tr.pos.copyWithin(3, 0, (TRAIL_N - 1) * 3);
      tr.pos[0] = this._v.x;
      tr.pos[1] = this._v.y;
      tr.pos[2] = this._v.z;
      for (let i = 0; i < TRAIL_N; i++) {
        const f = Math.pow(1 - i / TRAIL_N, 1.5) * vis;
        tr.col[i * 3] = this.trailColor.r * f;
        tr.col[i * 3 + 1] = this.trailColor.g * f;
        tr.col[i * 3 + 2] = this.trailColor.b * f;
      }
      tr.geo.attributes.position.needsUpdate = true;
      tr.geo.attributes.color.needsUpdate = true;
    }
  }

  setNight(night) {
    this.ikran.wingMat.emissiveIntensity = 0.35 + night * 1.6;
    this.ikran.bodyMat.emissiveIntensity = 0.25 + night * 1.2;
    this.ikran.skin.emissiveIntensity = 0.3 + night * 0.8;
  }
}
