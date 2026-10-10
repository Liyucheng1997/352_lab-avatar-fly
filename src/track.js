import * as THREE from 'three';

const DISC_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const DISC_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uTime, uStrength;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float edge = smoothstep(0.55, 1.0, r) * 0.35;
  float wave = smoothstep(0.08, 0.0, abs(r - fract(uTime * 0.45))) * 0.35;
  float a = (edge + wave * (1.0 - r)) * uStrength * step(r, 1.0);
  gl_FragColor = vec4(uColor, a);
}`;

const TRAIL_VS = /* glsl */ `
attribute float aU;
uniform float uTime, uScale, uNextU, uFogD;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float wave = pow(fract(aU * 60.0 - uTime * 0.8), 6.0);
  float du = fract(uNextU - aU);
  float near = smoothstep(0.05, 0.0, du);
  float dist = -mv.z;
  float fog = exp(-pow(uFogD * dist, 2.0));
  vA = (0.22 + wave * 0.6 + near * 0.6) * fog;
  gl_PointSize = clamp(uScale * 2.4 / dist, 1.0, 26.0) * (1.0 + near * 0.6);
  gl_Position = projectionMatrix * mv;
}`;
const TRAIL_FS = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vec3(0.45, 0.95, 1.25), a * vA);
}`;

const GOLD = new THREE.Color(1.0, 0.72, 0.22);
const CYAN = new THREE.Color(0.25, 0.85, 1.0);
const PINK = new THREE.Color(1.0, 0.35, 0.85);

/** 环形赛道：一条闭合样条线 + 沿线分布的光环 */
export class Track {
  constructor(scene, rng) {
    const pts = [];
    const N = 16;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      const r = 1180 + 320 * Math.sin(2 * th + 0.7) + (rng() - 0.5) * 240;
      let y = 190 + 120 * Math.sin(3 * th + 0.4) + (rng() - 0.5) * 90;
      if (i === 4) y = 360; // 高空段
      if (i === 10) y = 30; // 贴近云海的俯冲段
      pts.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
    }
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();
    this.samples = this.curve.getSpacedPoints(600);
    this.samples.pop();

    this.count = 28;
    this.next = 0;
    this.rings = [];
    const torusGeo = new THREE.TorusGeometry(1, 0.055, 10, 72);
    const outerGeo = new THREE.TorusGeometry(1.2, 0.016, 6, 72);
    const orbGeo = new THREE.SphereGeometry(0.06, 8, 6);
    const discGeo = new THREE.CircleGeometry(1, 48);

    for (let i = 0; i < this.count; i++) {
      const u = i / this.count;
      const pos = this.curve.getPointAt(u);
      const normal = this.curve.getTangentAt(u).normalize();
      const radius = i === 0 ? 26 : 20;
      const group = new THREE.Group();
      group.position.copy(pos);
      group.lookAt(pos.clone().add(normal));
      group.scale.setScalar(radius);

      const mat = new THREE.MeshBasicMaterial({ color: CYAN.clone() });
      const outerMat = new THREE.MeshBasicMaterial({ color: CYAN.clone(), transparent: true, opacity: 0.8 });
      group.add(new THREE.Mesh(torusGeo, mat));
      const spinner = new THREE.Group();
      spinner.add(new THREE.Mesh(outerGeo, outerMat));
      for (let k = 0; k < 4; k++) {
        const orb = new THREE.Mesh(orbGeo, outerMat);
        const a = (k / 4) * Math.PI * 2;
        orb.position.set(Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0);
        spinner.add(orb);
      }
      group.add(spinner);
      if (i === 0) {
        const gate = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.03, 8, 72), outerMat);
        group.add(gate);
      }
      const discMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: CYAN.clone() }, uTime: { value: 0 }, uStrength: { value: 0.2 } },
        vertexShader: DISC_VS,
        fragmentShader: DISC_FS,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      group.add(new THREE.Mesh(discGeo, discMat));
      scene.add(group);
      this.rings.push({ index: i, group, pos, normal, radius, mat, outerMat, discMat, spinner, u });
    }

    // 沿赛道的引导光点
    const trailCount = Math.floor(this.length / 7);
    const tp = this.curve.getSpacedPoints(trailCount);
    tp.pop();
    const posArr = new Float32Array(tp.length * 3);
    const uArr = new Float32Array(tp.length);
    tp.forEach((p, k) => {
      posArr.set([p.x, p.y, p.z], k * 3);
      uArr[k] = k / tp.length;
    });
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    tg.setAttribute('aU', new THREE.BufferAttribute(uArr, 1));
    this.trailUniforms = { uTime: { value: 0 }, uScale: { value: 600 }, uNextU: { value: 0 }, uFogD: { value: 0.0003 } };
    this.trail = new THREE.Points(
      tg,
      new THREE.ShaderMaterial({
        uniforms: this.trailUniforms,
        vertexShader: TRAIL_VS,
        fragmentShader: TRAIL_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
  }

  /** 起点：第 0 号光环之前 140 单位 */
  startFrame() {
    const u = 1 - 140 / this.length;
    return { pos: this.curve.getPointAt(u), dir: this.curve.getTangentAt(u).normalize() };
  }

  reset() {
    this.next = 0;
  }

  get nextRing() {
    return this.rings[this.next];
  }

  /** 检测这一帧是否按顺序穿过了下一个光环，返回光环索引或 -1 */
  checkPass(prev, cur) {
    const ring = this.rings[this.next];
    const d0 = this._tmp.subVectors(prev, ring.pos).dot(ring.normal);
    const d1 = this._tmp.subVectors(cur, ring.pos).dot(ring.normal);
    if (d0 < 0 && d1 >= 0) {
      const f = d0 / (d0 - d1);
      const hit = this._tmp2.copy(prev).lerp(cur, f);
      if (hit.distanceTo(ring.pos) < ring.radius * 1.15) {
        const idx = this.next;
        this.next = (this.next + 1) % this.count;
        return idx;
      }
    }
    return -1;
  }

  /** 最近的采样点所对应的 u（0..1） */
  nearestU(p) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const d = this.samples[i].distanceToSquared(p);
      if (d < bd) { bd = d; best = i; }
    }
    return best / this.samples.length;
  }

  update(time, dt, fogDensity, pointScale) {
    const t = this.trailUniforms;
    t.uTime.value = time;
    t.uNextU.value = this.rings[this.next].u;
    t.uFogD.value = fogDensity;
    t.uScale.value = pointScale;
    for (const ring of this.rings) {
      const rel = (ring.index - this.next + this.count) % this.count;
      ring.spinner.rotation.z += dt * (rel === 0 ? 1.4 : 0.4);
      ring.discMat.uniforms.uTime.value = time;
      let base = ring.index === 0 ? PINK : CYAN;
      let k, disc;
      if (rel === 0) {
        base = GOLD;
        k = 1.5 + 0.45 * Math.sin(time * 6);
        disc = 0.7;
      } else if (rel <= 2) {
        k = 1.1;
        disc = 0.35;
      } else {
        k = 0.6;
        disc = 0.12;
      }
      ring.mat.color.copy(base).multiplyScalar(k);
      ring.outerMat.color.copy(base).multiplyScalar(k * 0.8);
      ring.discMat.uniforms.uColor.value.copy(base);
      ring.discMat.uniforms.uStrength.value = disc;
    }
  }
}
