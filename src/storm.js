import * as THREE from 'three';
import { createNoise3D } from './utils/noise.js';
import { clamp, smoothstep } from './utils/math.js';

const RAIN_VS = /* glsl */ `
attribute float aEnd;
uniform vec3 uCam, uShift, uDir;
uniform float uBox, uLen, uIntensity;
varying float vA;
void main() {
  vec3 p = position + uShift;
  p = mod(p - uCam, uBox) - 0.5 * uBox + uCam;
  float fade = smoothstep(uBox * 0.5, uBox * 0.2, length(p - uCam));
  p -= uDir * aEnd * uLen;
  vA = uIntensity * (1.0 - aEnd * 0.75) * fade;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAIN_FS = /* glsl */ `
uniform float uBright;
varying float vA;
void main() {
  gl_FragColor = vec4(vec3(0.72, 0.78, 0.9) * uBright, vA * 0.5);
}`;

const CHARGE_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CHARGE_FS = /* glsl */ `
uniform float uTime, uProgress;
varying vec2 vUv;
void main() {
  float flick = 0.6 + 0.4 * sin(uTime * 40.0 + vUv.y * 80.0);
  float band = smoothstep(0.0, 0.1, fract(vUv.y * 12.0 - uTime * 3.0));
  float a = (0.05 + uProgress * 0.22) * flick * (0.5 + 0.5 * band);
  gl_FragColor = vec4(vec3(0.55, 0.35, 1.0), a);
}`;

const PHASE_TIME = {
  warning: () => 7,
  storm: (r) => 26 + r() * 14,
  clearing: () => 9,
  calm: (r) => 40 + r() * 25,
};

/**
 * 风暴系统：平静 → 预警 → 雷暴 → 消散 的循环。
 * 雷暴期间有强风、乱流、暴雨和闪电，其中一部分闪电会“锁定”玩家。
 */
export class StormSystem {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.noise = createNoise3D(rng);
    this.state = 'calm';
    this.timer = 25;
    this.intensity = 0;
    this.target = 0;
    this.time = 0;
    this.wind = new THREE.Vector3();
    this.windSpeed = 0;
    this.windAngle = rng() * Math.PI * 2;
    this.turbulence = 0;
    this.gust = 0;
    this.gustActive = false;
    this.flash = 0;
    this.flickers = [];
    this.nextStrike = 2;
    this.bolts = [];
    this.charges = [];
    this.rivals = [];
    this._buildRain();
    this.chargeGeo = new THREE.CylinderGeometry(5, 5, 1, 16, 1, true);
    this.chargeGeo.translate(0, 0.5, 0);
  }

  _buildRain() {
    const N = 6000;
    this.rainBox = 170;
    const pos = new Float32Array(N * 2 * 3);
    const end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = this.rng() * this.rainBox, y = this.rng() * this.rainBox, z = this.rng() * this.rainBox;
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2] = 0;
      end[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainUniforms = {
      uCam: { value: new THREE.Vector3() },
      uShift: { value: new THREE.Vector3() },
      uDir: { value: new THREE.Vector3(0, -1, 0) },
      uBox: { value: this.rainBox },
      uLen: { value: 8 },
      uIntensity: { value: 0 },
      uBright: { value: 1 },
    };
    this.rain = new THREE.LineSegments(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.rainUniforms,
        vertexShader: RAIN_VS,
        fragmentShader: RAIN_FS,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
    this.rainVel = new THREE.Vector3();
  }

  _enter(state, events) {
    this.state = state;
    this.timer = PHASE_TIME[state](this.rng);
    events.push({ type: 'phase', state });
  }

  /** 按 T 键召唤风暴 */
  force(events) {
    if (this.state === 'calm' || this.state === 'clearing') this._enter('warning', events);
    else if (this.state === 'warning') this.timer = 0;
  }

  reset() {
    this.state = 'calm';
    this.timer = 25;
  }

  update(dt, camera, player, events, allowTargeted) {
    this.time += dt;
    this.timer -= dt;
    const r = this.rng;

    switch (this.state) {
      case 'calm':
        this.target = 0;
        if (this.timer <= 0) this._enter('warning', events);
        break;
      case 'warning':
        this.target = 0.38;
        if (this.timer <= 0) this._enter('storm', events);
        break;
      case 'storm':
        this.target = 1;
        if (this.timer <= 0) this._enter('clearing', events);
        break;
      case 'clearing':
        this.target = 0;
        if (this.timer <= 0) this._enter('calm', events);
        break;
    }
    const rate = this.target > this.intensity ? 0.45 : 0.3;
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-dt * rate));
    const I = this.intensity;

    // 风与阵风
    this.windAngle += this.noise(this.time * 0.05, 1.3, 2.7) * dt * 0.5;
    const g = Math.max(0, this.noise(this.time * 0.32, 7.7, 0.4));
    this.gust = g;
    this.windSpeed = I * (16 + 62 * g * g);
    this.wind.set(Math.cos(this.windAngle), -0.18 * g, Math.sin(this.windAngle)).multiplyScalar(this.windSpeed);
    this.turbulence = I * (0.35 + g * 1.1);
    if (!this.gustActive && g > 0.55 && I > 0.6) {
      this.gustActive = true;
      events.push({ type: 'gust' });
    } else if (this.gustActive && g < 0.3) {
      this.gustActive = false;
    }

    // 闪电
    if (I > 0.6) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.nextStrike = 1.0 + r() * 3.4 * (1.5 - I);
        if (allowTargeted && r() < 0.3) {
          // 大多数锁定瞄准玩家，偶尔也会劈向对手
          const target = this.rivals.length && r() < 0.35 ? this.rivals[Math.floor(r() * this.rivals.length)] : player;
          this._charge(target, player, events);
        }
        else this._strikeRandom(camera, player, events);
      }
    }
    for (let i = this.charges.length - 1; i >= 0; i--) {
      const c = this.charges[i];
      c.t += dt;
      c.mat.uniforms.uTime.value = this.time;
      c.mat.uniforms.uProgress.value = clamp(c.t / c.dur, 0, 1);
      if (c.t >= c.dur) {
        this.scene.remove(c.mesh);
        c.mat.dispose();
        this.charges.splice(i, 1);
        this._strike(c.pos.x, c.pos.z, camera, player, events, true, c.target.position.y);
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      const k = b.life > 0.22 ? 1 : (Math.random() < 0.5 ? 0.25 : 0.9) * (b.life / 0.22);
      b.core.material.opacity = k;
      b.glow.material.opacity = k * 0.45;
      if (b.life <= 0) {
        for (const m of [b.core, b.glow]) {
          this.scene.remove(m);
          m.geometry.dispose();
          m.material.dispose();
        }
        this.bolts.splice(i, 1);
      }
    }

    // 闪光衰减与余闪
    this.flash = Math.max(0, this.flash - dt * 5);
    for (let i = this.flickers.length - 1; i >= 0; i--) {
      this.flickers[i] -= dt;
      if (this.flickers[i] <= 0) {
        this.flash = Math.max(this.flash, 0.75);
        this.flickers.splice(i, 1);
      }
    }

    // 雨
    const rain = smoothstep(0.25, 0.8, I);
    this.rain.visible = rain > 0.01;
    if (this.rain.visible) {
      this.rainVel.set(this.wind.x * 0.8, -180, this.wind.z * 0.8);
      const u = this.rainUniforms;
      const box = this.rainBox;
      const sh = u.uShift.value.addScaledVector(this.rainVel, dt);
      sh.set(((sh.x % box) + box) % box, ((sh.y % box) + box) % box, ((sh.z % box) + box) % box);
      u.uCam.value.copy(camera.position);
      u.uDir.value.copy(this.rainVel).normalize();
      u.uLen.value = 7 + this.windSpeed * 0.06;
      u.uIntensity.value = rain;
      u.uBright.value = 1 + this.flash * 1.5;
    }
  }

  _charge(target, player, events) {
    const p = target.position.clone().addScaledVector(target.velocity, 1.0);
    const a = this.rng() * Math.PI * 2, d = this.rng() * 22;
    p.x += Math.cos(a) * d;
    p.z += Math.sin(a) * d;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uProgress: { value: 0 } },
      vertexShader: CHARGE_VS,
      fragmentShader: CHARGE_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const bottom = Math.max(-140, target.position.y - 350);
    const top = Math.max(target.position.y + 520, 760);
    const mesh = new THREE.Mesh(this.chargeGeo, mat);
    mesh.position.set(p.x, bottom, p.z);
    mesh.scale.set(1, top - bottom, 1);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.charges.push({ mesh, mat, pos: p, target, t: 0, dur: 1.0 });
    events.push({ type: 'charge', pos: p, target, isPlayer: target === player });
  }

  _strikeRandom(camera, player, events) {
    const a = this.rng() * Math.PI * 2;
    const d = 150 + this.rng() * 800;
    this._strike(player.position.x + Math.cos(a) * d, player.position.z + Math.sin(a) * d, camera, player, events, false);
  }

  _strike(x, z, camera, player, events, targeted, refY = player.position.y) {
    const r = this.rng;
    const lo = Math.min(refY, player.position.y), hi = Math.max(refY, player.position.y);
    const top = new THREE.Vector3(x, Math.max(hi + 520, 760), z);
    const bottom = new THREE.Vector3(x + (r() - 0.5) * 60, Math.max(-140, lo - 300 - r() * 150), z + (r() - 0.5) * 60);
    const lines = [{ pts: this._jagged(top, bottom, 7, 70), w: 3.2 }];
    const nb = 2 + Math.floor(r() * 4);
    for (let b = 0; b < nb; b++) {
      const main = lines[0].pts;
      const start = main[Math.floor(r() * main.length * 0.7)];
      const dir = new THREE.Vector3(r() - 0.5, -0.5 - r() * 0.5, r() - 0.5).normalize();
      const len = 80 + r() * 200;
      lines.push({ pts: this._jagged(start, start.clone().addScaledVector(dir, len), 4, len * 0.25), w: 1.5 });
    }
    const cam = camera.position;
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(4, 4.2, 6), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.7, 0.5, 1.8), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const core = new THREE.Mesh(this._ribbon(lines, cam, 1), coreMat);
    const glow = new THREE.Mesh(this._ribbon(lines, cam, 5), glowMat);
    core.frustumCulled = glow.frustumCulled = false;
    this.scene.add(core, glow);
    this.bolts.push({ core, glow, life: 0.42 });

    const dx = player.position.x - x, dz = player.position.z - z;
    const dist = Math.hypot(dx, dz);
    const inColumn = player.position.y < top.y && player.position.y > bottom.y - 20;
    const hit = inColumn && dist < 30;
    const rivalsHit = this.rivals.filter((rv) => {
      const d = Math.hypot(rv.position.x - x, rv.position.z - z);
      return d < 30 && rv.position.y < top.y && rv.position.y > bottom.y - 20;
    });
    this.flash = 1;
    this.flickers.push(0.08 + r() * 0.05, 0.2 + r() * 0.1);
    events.push({ type: 'strike', pos: new THREE.Vector3(x, player.position.y, z), dist, hit, targeted, rivalsHit });
  }

  _jagged(a, b, depth, disp) {
    let pts = [a.clone(), b.clone()];
    for (let d = 0; d < depth; d++) {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const m = pts[i].clone().lerp(pts[i + 1], 0.5);
        m.x += (this.rng() - 0.5) * disp;
        m.z += (this.rng() - 0.5) * disp;
        m.y += (this.rng() - 0.5) * disp * 0.3;
        out.push(m, pts[i + 1]);
      }
      pts = out;
      disp *= 0.55;
    }
    return pts;
  }

  _ribbon(lines, cam, widthMul) {
    const arr = [];
    const dir = new THREE.Vector3(), toCam = new THREE.Vector3(), side = new THREE.Vector3();
    for (const line of lines) {
      const p = line.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        dir.subVectors(b, a);
        toCam.subVectors(cam, a);
        side.crossVectors(dir, toCam).normalize().multiplyScalar(line.w * widthMul * 0.5);
        arr.push(
          a.x - side.x, a.y - side.y, a.z - side.z,
          a.x + side.x, a.y + side.y, a.z + side.z,
          b.x + side.x, b.y + side.y, b.z + side.z,
          a.x - side.x, a.y - side.y, a.z - side.z,
          b.x + side.x, b.y + side.y, b.z + side.z,
          b.x - side.x, b.y - side.y, b.z - side.z,
        );
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    return geo;
  }
}
