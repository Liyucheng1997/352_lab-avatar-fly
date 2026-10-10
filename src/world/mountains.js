import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm3 } from '../utils/noise.js';
import { clamp01, smoothstep } from '../utils/math.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';

// 哈利路亚山式的剖面：(高度 t, 半径 r)，底部尖锐下垂，顶部是平台
const PROFILE = [
  [0, 0], [0.03, 0.1], [0.08, 0.22], [0.15, 0.38], [0.25, 0.55], [0.35, 0.68],
  [0.45, 0.76], [0.55, 0.8], [0.65, 0.82], [0.75, 0.84], [0.84, 0.88], [0.9, 0.93],
  [0.94, 0.96], [0.97, 0.9], [0.985, 0.7], [0.995, 0.4], [1, 0],
];

export function profileAt(t) {
  if (t <= 0 || t >= 1) return 0;
  for (let i = 1; i < PROFILE.length; i++) {
    if (t <= PROFILE[i][0]) {
      const [t0, r0] = PROFILE[i - 1];
      const [t1, r1] = PROFILE[i];
      return r0 + ((r1 - r0) * (t - t0)) / (t1 - t0);
    }
  }
  return 0;
}

function lathePoints() {
  const ts = new Set();
  for (let i = 0; i <= 40; i++) ts.add(+(i / 40).toFixed(4));
  PROFILE.forEach(([t]) => ts.add(t));
  const sorted = [...ts].sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 0.003);
  return sorted.map((t) => new THREE.Vector2(profileAt(t), t));
}
const LATHE_PTS = lathePoints();

const ROCK_D = new THREE.Color('#3b3632');
const ROCK_L = new THREE.Color('#8b8073');
const ROCK_R = new THREE.Color('#7a5440');
const MOSS = new THREE.Color('#3f8a3c');
const MOSS_D = new THREE.Color('#1f5233');
const GRASS = new THREE.Color('#58a843');
const CANOPY = ['#2f8f4e', '#3aa36a', '#1f7a63', '#5aae3c', '#2c7f8f', '#3f9b55', '#7b4fb0', '#c0508f'];
const GLOW = ['#3ff2ff', '#ff4fd8', '#8a5cff', '#7dff6a', '#38b6ff'];

const FALL_VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FALL_FS = /* glsl */ `
uniform float uTime, uFogD, uNight;
uniform vec3 uFogColor;
varying vec2 vUv;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  float s1 = snoise(vec3(vUv.x * 10.0, vUv.y * 3.0 + uTime * 1.5, 0.0)) * 0.5 + 0.5;
  float s2 = snoise(vec3(vUv.x * 28.0, vUv.y * 7.0 + uTime * 2.6, 3.0)) * 0.5 + 0.5;
  float a = smoothstep(0.3, 0.95, s1 * 0.6 + s2 * 0.55);
  float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
  float fade = smoothstep(0.0, 0.55, vUv.y);
  a = (a * 0.8 + 0.12) * edge * fade;
  vec3 col = mix(vec3(0.82, 0.92, 1.0), vec3(0.3, 1.0, 1.1), uNight * 0.6) * (0.75 + 0.45 * s2);
  float f = fogFactor(uFogD, length(vWorld - cameraPosition));
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, a * (1.0 - f * 0.6) * 0.9);
}`;

/** 悬浮群山：生成、植被、瀑布、碎石，以及碰撞体 */
export class Mountains {
  constructor(scene, rng, noise, track) {
    this.scene = scene;
    this.rng = rng;
    this.noise = noise;
    this.track = track;
    this.colliders = [];
    this.rocks = [];
    this.treeData = [];
    this.vineData = [];
    this.glowData = [];
    this.fallData = [];
    this._d = { s: 1, n1: 0, ridge: 0 };
    this._hit = { normal: new THREE.Vector3(), depth: 0 };

    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.group = new THREE.Group();
    scene.add(this.group);

    this._place();
    this._buildInstances();
    this._buildWaterfalls();
    this._buildRocks();
  }

  // —— 布局 ——
  _place() {
    const rng = this.rng;
    const samples = this.track.samples;
    const specs = [{ x: 0, z: 0, y: -380, r: 240, h: 1030, lx: 0, lz: 0, central: true }];
    let attempts = 0;
    while (specs.length < 92 && attempts < 5000) {
      attempts++;
      const r = 45 + Math.pow(rng(), 1.6) * 115;
      const h = Math.min(780, Math.max(220, r * (2.6 + rng() * 2.4)));
      let x, z, y;
      if (rng() < 0.55) {
        // 沿赛道两侧形成“峡谷”
        const i = Math.floor(rng() * samples.length);
        const s = samples[i];
        const n = samples[(i + 1) % samples.length];
        const tx = n.x - s.x, tz = n.z - s.z;
        const tl = Math.hypot(tx, tz) || 1;
        const side = rng() < 0.5 ? -1 : 1;
        const off = r * 1.25 + 50 + rng() * 130;
        x = s.x + (-tz / tl) * off * side;
        z = s.z + (tx / tl) * off * side;
        y = s.y - h * (0.25 + rng() * 0.5);
      } else {
        const a = rng() * Math.PI * 2;
        const d = 350 + rng() * 2700;
        x = Math.cos(a) * d;
        z = Math.sin(a) * d;
        y = -280 + rng() * 320;
      }
      const spec = { x, z, y, r, h, lx: (rng() - 0.5) * 0.16 * r, lz: (rng() - 0.5) * 0.16 * r };
      if (!this._clearOfTrack(spec) || !this._clearOfOthers(spec, specs)) continue;
      specs.push(spec);
    }
    specs.forEach((s, i) => this._buildMountain(s, i));
    this.central = specs[0];
  }

  _clearOfTrack(s) {
    const margin = Math.hypot(s.lx, s.lz) + 42;
    for (const p of this.track.samples) {
      const dx = p.x - s.x, dz = p.z - s.z;
      const d2 = dx * dx + dz * dz;
      const top = s.y + s.h;
      if (p.y > top - 5 && p.y < top + 70) {
        const rr = s.r * 1.1 + 40;
        if (d2 < rr * rr) return false;
      }
      if (p.y < s.y - 30 || p.y > top + 40) continue;
      const rr = profileAt(clamp01((p.y - s.y) / s.h)) * s.r * 1.22 + margin;
      if (d2 < rr * rr) return false;
    }
    return true;
  }

  _clearOfOthers(s, specs) {
    for (const o of specs) {
      if (s.y < o.y + o.h && o.y < s.y + s.h) {
        if (Math.hypot(s.x - o.x, s.z - o.z) < (s.r + o.r) * 0.95) return false;
      }
    }
    return true;
  }

  _disp(x, y, z, seed, ridgeF) {
    const n1 = fbm3(this.noise, x * 0.011 + seed, y * 0.0085, z * 0.011, 4);
    const ang = Math.atan2(z, x);
    const rn = this.noise(Math.cos(ang) * ridgeF + seed * 0.37, y * 0.004, Math.sin(ang) * ridgeF - seed * 0.21);
    const ridge = 1 - Math.abs(rn);
    const d = this._d;
    d.s = 1 + 0.17 * n1 + 0.1 * (ridge - 0.6);
    d.n1 = n1;
    d.ridge = ridge;
    return d;
  }

  _buildMountain(spec, idx) {
    const rng = this.rng;
    const R = spec.r, H = spec.h;
    const seed = idx * 17.31 + 3.7;
    const ridgeF = 1.6 + rng() * 2.2;

    let geo = new THREE.LatheGeometry(LATHE_PTS, spec.central ? 72 : 40);
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    geo = mergeVertices(geo, 1e-4);
    const pos = geo.attributes.position;
    const n = pos.count;
    const n1s = new Float32Array(n), ridges = new Float32Array(n), ts = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ux = pos.getX(i), t = pos.getY(i), uz = pos.getZ(i);
      const d = this._disp(ux * R, t * H, uz * R, seed, ridgeF);
      let y = t * H;
      if (t > 0.97) y += d.n1 * H * 0.006;
      pos.setXYZ(i, ux * R * d.s + spec.lx * t * t, y, uz * R * d.s + spec.lz * t * t);
      n1s[i] = d.n1;
      ridges[i] = d.ridge;
      ts[i] = t;
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;

    const colors = new Float32Array(n * 3);
    const c = new THREE.Color(), tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const t = ts[i], ny = nor.getY(i), n1 = n1s[i], ridge = ridges[i];
      const wy = pos.getY(i);
      c.copy(ROCK_D).lerp(ROCK_L, clamp01(0.5 + n1 * 0.9));
      const strata = Math.sin(wy * 0.08 + n1 * 4) * 0.5 + 0.5;
      c.lerp(ROCK_R, strata * 0.3);
      c.multiplyScalar(0.72 + 0.4 * ridge);
      let moss = smoothstep(0.15, 0.65, ny) + smoothstep(0.82, 0.95, t) * 0.5;
      if (n1 > 0.12 && t > 0.3) moss += (n1 - 0.12) * 1.6;
      moss = clamp01(moss);
      tmp.copy(MOSS).lerp(MOSS_D, clamp01(0.5 - n1 * 1.5));
      c.lerp(tmp, moss * 0.85);
      if (t > 0.975 && ny > 0.5) c.lerp(GRASS, 0.8);
      c.multiplyScalar(0.5 + 0.5 * smoothstep(0.0, 0.5, t));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(spec.x, spec.y, spec.z);
    this.group.add(mesh);
    this.colliders.push(spec);

    const topX = spec.x + spec.lx, topZ = spec.z + spec.lz;

    // 顶部的潘多拉树林
    const treeCount = Math.floor(R * 0.2 + rng() * 6) + (spec.central ? 30 : 0);
    for (let k = 0; k < treeCount; k++) {
      const a = rng() * Math.PI * 2;
      const rho = Math.sqrt(rng()) * 0.6 * R;
      if (spec.central && rho < 0.42 * R) continue;
      const x = topX + Math.cos(a) * rho, z = topZ + Math.sin(a) * rho;
      const y = spec.y + H * (1 - (0.015 * rho) / (0.7 * R)) - 2;
      const th = 10 + rng() * 26, cw = 5 + rng() * 9;
      this.treeData.push({ x, y, z, th, tw: 0.8 + rng() * 1.3, cw, ch: cw * (0.32 + rng() * 0.25) });
      if (rng() < 0.35) this.glowData.push({ x, y: y + th * 0.8, z, s: 0.7 + rng() * 0.6, c: GLOW[Math.floor(rng() * GLOW.length)] });
    }

    // 垂落的藤蔓
    const vineCount = Math.floor(10 + R * 0.25);
    for (let k = 0; k < vineCount; k++) {
      const a = rng() * Math.PI * 2;
      const t = 0.935;
      const pr = profileAt(t);
      const ux = Math.cos(a) * pr, uz = Math.sin(a) * pr;
      const d = this._disp(ux * R, t * H, uz * R, seed, ridgeF);
      this.vineData.push({
        x: spec.x + ux * R * d.s * 1.01 + spec.lx * t * t,
        y: spec.y + t * H,
        z: spec.z + uz * R * d.s * 1.01 + spec.lz * t * t,
        len: 15 + rng() * rng() * 95,
        w: 0.8 + rng() * 1.3,
      });
    }

    // 山体表面的生物荧光
    const glowCount = Math.floor(R * (spec.central ? 0.8 : 0.35));
    for (let k = 0; k < glowCount; k++) {
      const vi = Math.floor(rng() * n);
      if (ts[vi] < 0.25 || nor.getY(vi) < -0.3) continue;
      const col = GLOW[Math.floor(rng() * GLOW.length)];
      const cluster = 1 + Math.floor(rng() * 3);
      for (let q = 0; q < cluster; q++) {
        this.glowData.push({
          x: spec.x + pos.getX(vi) + nor.getX(vi) * 0.4 + (rng() - 0.5) * 3,
          y: spec.y + pos.getY(vi) + nor.getY(vi) * 0.4 + (rng() - 0.5) * 3,
          z: spec.z + pos.getZ(vi) + nor.getZ(vi) * 0.4 + (rng() - 0.5) * 3,
          s: 0.5 + rng() * (spec.central ? 2.2 : 1.5),
          c: col,
        });
      }
    }

    // 瀑布
    const fallChance = spec.central ? 3 : R > 60 && rng() < 0.3 && this.fallData.length < 18 ? 1 : 0;
    for (let k = 0; k < fallChance; k++) {
      const a = rng() * Math.PI * 2;
      const t = 0.935;
      const pr = profileAt(t);
      const ux = Math.cos(a) * pr, uz = Math.sin(a) * pr;
      const d = this._disp(ux * R, t * H, uz * R, seed, ridgeF);
      this.fallData.push({
        x: spec.x + ux * R * d.s + spec.lx * t * t,
        y: spec.y + t * H + 2,
        z: spec.z + uz * R * d.s + spec.lz * t * t,
        ax: Math.cos(a),
        az: Math.sin(a),
        w: 6 + R * 0.1,
        h: H * (0.5 + rng() * 0.4),
      });
    }
  }

  _buildInstances() {
    const rng = this.rng;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const e = new THREE.Euler();
    const col = new THREE.Color();

    const trunkGeo = new THREE.CylinderGeometry(0.45, 1, 1, 6, 1);
    trunkGeo.translate(0, 0.5, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#4a3a33', roughness: 0.9 }), this.treeData.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, flatShading: true }), this.treeData.length);
    this.treeData.forEach((t, i) => {
      p.set(t.x, t.y - 3, t.z);
      q.setFromEuler(e.set((rng() - 0.5) * 0.15, rng() * Math.PI * 2, (rng() - 0.5) * 0.15));
      s.set(t.tw, t.th + 3, t.tw);
      trunks.setMatrixAt(i, m.compose(p, q, s));
      p.set(t.x, t.y + t.th, t.z);
      q.setFromEuler(e.set(0, rng() * Math.PI, 0));
      s.set(t.cw, t.ch, t.cw);
      canopies.setMatrixAt(i, m.compose(p, q, s));
      const pick = rng() < 0.9 ? Math.floor(rng() * 6) : 6 + Math.floor(rng() * 2);
      col.set(CANOPY[pick]).multiplyScalar(0.8 + rng() * 0.35);
      canopies.setColorAt(i, col);
    });

    const vineGeo = new THREE.CylinderGeometry(0.5, 0.12, 1, 4, 1, true);
    vineGeo.translate(0, -0.5, 0);
    const vines = new THREE.InstancedMesh(vineGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, side: THREE.DoubleSide }), this.vineData.length);
    this.vineData.forEach((v, i) => {
      p.set(v.x, v.y, v.z);
      q.setFromEuler(e.set((rng() - 0.5) * 0.08, rng() * Math.PI, (rng() - 0.5) * 0.08));
      s.set(v.w, v.len, v.w);
      vines.setMatrixAt(i, m.compose(p, q, s));
      col.set(rng() < 0.85 ? '#2b5e2e' : '#3d7a52').multiplyScalar(0.7 + rng() * 0.5);
      vines.setColorAt(i, col);
    });

    const glows = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), this.glowMat, this.glowData.length);
    this.glowData.forEach((g, i) => {
      p.set(g.x, g.y, g.z);
      q.identity();
      s.setScalar(g.s);
      glows.setMatrixAt(i, m.compose(p, q, s));
      glows.setColorAt(i, col.set(g.c));
    });

    for (const im of [trunks, canopies, vines, glows]) {
      im.frustumCulled = false;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.group.add(im);
    }
  }

  _buildWaterfalls() {
    this.fallUniforms = {
      uTime: { value: 0 },
      uFogD: { value: 0.0003 },
      uNight: { value: 0 },
      uFogColor: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.fallUniforms,
      vertexShader: FALL_VS,
      fragmentShader: FALL_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const f of this.fallData) {
      const geo = new THREE.PlaneGeometry(f.w, f.h, 1, 12);
      geo.translate(0, -f.h / 2, 0);
      const pa = geo.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const k = -pa.getY(i) / f.h;
        pa.setX(i, pa.getX(i) * (1 + k * 1.1));
        pa.setZ(i, k * k * f.h * 0.07);
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(f.x + f.ax * 1.5, f.y, f.z + f.az * 1.5);
      mesh.lookAt(mesh.position.x + f.ax, mesh.position.y, mesh.position.z + f.az);
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
  }

  _buildRocks() {
    const rng = this.rng;
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const pa = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i);
      const k = 1 + 0.35 * this.noise(v.x * 1.7, v.y * 1.7, v.z * 1.7) + 0.12 * this.noise(v.x * 4, v.y * 4, v.z * 4);
      v.multiplyScalar(k);
      v.y *= 0.75;
      pa.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    const colors = new Float32Array(pa.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pa.count; i++) {
      c.copy(ROCK_D).lerp(ROCK_L, 0.4 + 0.3 * this.noise(pa.getX(i) * 3, pa.getY(i) * 3, 0));
      c.lerp(MOSS, smoothstep(0.3, 0.8, nor.getY(i)) * 0.8);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const target = 420;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const e = new THREE.Euler();
    let tries = 0;
    while (this.rocks.length < target && tries < 4000) {
      tries++;
      const size = 3 + rng() * rng() * 24;
      if (rng() < 0.4) {
        const mt = this.colliders[Math.floor(rng() * this.colliders.length)];
        const a = rng() * Math.PI * 2;
        const d = mt.r * (0.9 + rng() * 0.8);
        p.set(mt.x + Math.cos(a) * d, mt.y - 60 + rng() * (mt.h * 0.4 + 60), mt.z + Math.sin(a) * d);
      } else {
        const a = rng() * Math.PI * 2;
        const d = 200 + rng() * 3000;
        p.set(Math.cos(a) * d, -100 + rng() * 750, Math.sin(a) * d);
      }
      let ok = true;
      const clear = size * 1.3 + 30;
      for (const sp of this.track.samples) {
        if (sp.distanceToSquared(p) < clear * clear) { ok = false; break; }
      }
      if (!ok || this._collideMountains(p, size)) continue;
      this.rocks.push({ x: p.x, y: p.y, z: p.z, r: size });
    }
    const rocks = new THREE.InstancedMesh(geo, this.material, this.rocks.length);
    this.rocks.forEach((r, i) => {
      p.set(r.x, r.y, r.z);
      q.setFromEuler(e.set(rng() * 0.6, rng() * Math.PI * 2, rng() * 0.6));
      s.setScalar(r.r);
      rocks.setMatrixAt(i, m.compose(p, q, s));
    });
    rocks.frustumCulled = false;
    this.group.add(rocks);
  }

  _collideMountains(p, radius) {
    const out = this._hit;
    for (const c of this.colliders) {
      const t = (p.y - c.y) / c.h;
      if (t < -0.01 || t > 1.01) continue;
      const tc = clamp01(t);
      const cx = c.x + c.lx * tc * tc, cz = c.z + c.lz * tc * tc;
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      const rr = profileAt(tc) * c.r * 0.9 + radius;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      if (t > 0.955 && d < profileAt(0.955) * c.r * 0.75) {
        out.normal.set(0, 1, 0);
        out.depth = c.y + c.h + radius - p.y;
      } else if (d < 1e-3) {
        out.normal.set(1, 0, 0);
        out.depth = rr;
      } else {
        out.normal.set(dx / d, 0, dz / d);
        out.depth = rr - d;
      }
      return out;
    }
    return null;
  }

  /** 与群山和碎石的碰撞：返回 { normal, depth } 或 null */
  collide(p, radius) {
    const hit = this._collideMountains(p, radius);
    if (hit) return hit;
    const out = this._hit;
    for (const r of this.rocks) {
      const dx = p.x - r.x, dy = p.y - r.y, dz = p.z - r.z;
      const rr = r.r * 0.85 + radius;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-3;
        out.normal.set(dx / d, dy / d, dz / d);
        out.depth = rr - d;
        return out;
      }
    }
    return null;
  }

  update(time, night, fog) {
    const pulse = 0.85 + 0.15 * Math.sin(time * 1.3);
    this.glowMat.color.setScalar((0.45 + night * 2.6) * pulse);
    const u = this.fallUniforms;
    u.uTime.value = time;
    u.uNight.value = night;
    u.uFogD.value = fog.density;
    u.uFogColor.value.copy(fog.color);
  }
}
