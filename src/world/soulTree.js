import * as THREE from 'three';

const STRAND_VS = /* glsl */ `
attribute float aT;
uniform float uTime, uFogD;
varying float vT;
varying float vFog;
void main() {
  vec3 p = position;
  float k = aT * aT;
  p.x += sin(uTime * 0.9 + position.x * 0.04 + position.z * 0.03) * k * 3.5;
  p.z += cos(uTime * 0.7 + position.x * 0.05) * k * 2.5;
  vT = aT;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float f = uFogD * -mv.z;
  vFog = exp(-f * f);
  gl_Position = projectionMatrix * mv;
}`;
const STRAND_FS = /* glsl */ `
uniform vec3 uTop, uTip;
uniform float uGlow;
varying float vT;
varying float vFog;
void main() {
  vec3 c = mix(uTop, uTip, vT) * uGlow;
  gl_FragColor = vec4(c, (0.06 + vT * 0.2) * vFog);
}`;

/** 中央巨山顶上的“灵魂之树”：扭曲的树干与垂落的发光丝绦 */
export class SoulTree {
  constructor(scene, rng, spec) {
    this.top = new THREE.Vector3(spec.x + spec.lx, spec.y + spec.h, spec.z + spec.lz);
    const group = (this.group = new THREE.Group());
    group.position.copy(this.top);
    scene.add(group);

    const bark = new THREE.MeshStandardMaterial({ color: '#3b2c3a', roughness: 0.85, emissive: '#2a0f3a', emissiveIntensity: 0.3 });
    this.bark = bark;
    const tube = (pts, r, seg = 28) => {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 8), bark));
      return curve;
    };

    // 互相缠绕的主干
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const y = -10 + i * 15;
        const tw = a + i * 0.7;
        const rad = 7 * (1 - i / 9);
        pts.push([Math.cos(tw) * rad, y, Math.sin(tw) * rad]);
      }
      tube(pts, 5.5 - k * 0.4, 32);
    }

    // 拱形枝条
    const branches = [];
    const nb = 10;
    for (let k = 0; k < nb; k++) {
      const a = (k / nb) * Math.PI * 2 + rng() * 0.3;
      const y0 = 55 + rng() * 30;
      const reach = 95 + rng() * 45;
      const c = tube(
        [
          [0, y0, 0],
          [Math.cos(a) * 35, y0 + 26, Math.sin(a) * 35],
          [Math.cos(a) * reach * 0.7, y0 + 22, Math.sin(a) * reach * 0.7],
          [Math.cos(a) * reach, y0 - 6, Math.sin(a) * reach],
        ],
        2.6 + rng() * 1.2,
      );
      branches.push(c);
      // 分枝
      const b = c.getPoint(0.55);
      const a2 = a + (rng() - 0.5) * 1.2;
      branches.push(
        tube(
          [
            [b.x, b.y, b.z],
            [b.x + Math.cos(a2) * 25, b.y + 12, b.z + Math.sin(a2) * 25],
            [b.x + Math.cos(a2) * 55, b.y - 4, b.z + Math.sin(a2) * 55],
          ],
          1.4,
          16,
        ),
      );
    }

    // 发光丝绦
    const positions = [];
    const ts = [];
    const SEG = 4;
    const strands = 2600;
    for (let s = 0; s < strands; s++) {
      const curve = branches[Math.floor(rng() * branches.length)];
      const p = curve.getPoint(0.2 + rng() * 0.8);
      p.x += (rng() - 0.5) * 8;
      p.z += (rng() - 0.5) * 8;
      const L = Math.min(30 + rng() * 65, p.y - 4);
      const ph = rng() * Math.PI * 2;
      let prev = null;
      for (let k = 0; k <= SEG; k++) {
        const kk = k / SEG;
        const q = [p.x + Math.sin(kk * 2 + ph) * 1.5, p.y - L * kk, p.z + Math.cos(kk * 2 + ph) * 1.5];
        if (prev) {
          positions.push(...prev.q, ...q);
          ts.push(prev.t, kk);
        }
        prev = { q, t: kk };
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uGlow: { value: 1 },
      uFogD: { value: 0.0003 },
      uTop: { value: new THREE.Color(0.35, 0.1, 0.6) },
      uTip: { value: new THREE.Color(1.3, 0.5, 1.5) },
    };
    const strandsMesh = new THREE.LineSegments(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: STRAND_VS,
        fragmentShader: STRAND_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    strandsMesh.frustumCulled = false;
    group.add(strandsMesh);

    this.light = new THREE.PointLight('#c25cff', 0, 520, 1);
    this.light.position.set(0, 60, 0);
    group.add(this.light);
  }

  update(time, night, fog) {
    this.uniforms.uTime.value = time;
    this.uniforms.uGlow.value = 0.45 + night * 0.9 + Math.sin(time * 0.8) * 0.05;
    this.uniforms.uFogD.value = fog.density;
    this.light.intensity = 30 + night * 220;
    this.bark.emissiveIntensity = 0.25 + night * 0.9;
  }
}
