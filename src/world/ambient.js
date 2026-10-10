import * as THREE from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';

const SEA_VS = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const SEA_FS = /* glsl */ `
uniform float uTime, uFogD, uNight, uFlash;
uniform vec3 uTop, uShadow, uFogColor;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  vec2 p = vWorld.xz * 0.0009;
  float n = fbm(vec3(p + uTime * 0.004, uTime * 0.01), 4);
  float n2 = fbm(vec3(p * 3.1 - uTime * 0.006, 5.0), 2);
  float h = n * 0.7 + n2 * 0.3;
  vec3 col = mix(uShadow, uTop, smoothstep(-0.45, 0.55, h));
  col += vec3(0.0, 0.28, 0.32) * smoothstep(0.35, 0.8, n2) * uNight * 0.6;
  col += vec3(0.6, 0.65, 0.9) * uFlash * 0.4 * smoothstep(-0.2, 0.6, h);
  float f = fogFactor(uFogD * 0.75, length(vWorld - cameraPosition));
  gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
}`;

/** 群山之下无尽的云海 */
export class CloudSea {
  constructor(scene) {
    this.uniforms = {
      uTime: { value: 0 },
      uFogD: { value: 0.0003 },
      uNight: { value: 0 },
      uFlash: { value: 0 },
      uTop: { value: new THREE.Color() },
      uShadow: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
    };
    const geo = new THREE.PlaneGeometry(26000, 26000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SEA_VS, fragmentShader: SEA_FS }),
    );
    this.mesh.position.y = -150;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(time, camera, pal, fog, night, flash) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uFogD.value = fog.density;
    u.uFogColor.value.copy(fog.color);
    u.uTop.value.copy(pal.cloud).lerp(pal.horizon, 0.25).multiplyScalar(0.95);
    u.uShadow.value.copy(pal.bottom).multiplyScalar(0.75);
    u.uNight.value = night;
    u.uFlash.value = flash;
    this.mesh.position.x = camera.position.x;
    this.mesh.position.z = camera.position.z;
  }
}

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const x = 34 + Math.random() * 60, y = 44 + Math.random() * 40, r = 22 + Math.random() * 26;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 环绕山腰的云团 */
export class CloudBank {
  constructor(scene, rng, track) {
    const map = cloudTexture();
    this.mats = [0.3, 0.42, 0.55].map(
      (opacity) => new THREE.SpriteMaterial({ map, transparent: true, opacity, depthWrite: false, fog: true }),
    );
    this.group = new THREE.Group();
    scene.add(this.group);
    let placed = 0, tries = 0;
    const p = new THREE.Vector3();
    while (placed < 220 && tries < 2000) {
      tries++;
      const a = rng() * Math.PI * 2;
      const d = 250 + rng() * 3200;
      const low = rng() < 0.55;
      p.set(Math.cos(a) * d, low ? -140 + rng() * 120 : -20 + rng() * 520, Math.sin(a) * d);
      let ok = true;
      for (const s of track.samples) {
        if (s.distanceToSquared(p) < 110 * 110) { ok = false; break; }
      }
      if (!ok) continue;
      const sp = new THREE.Sprite(this.mats[Math.floor(rng() * 3)]);
      sp.position.copy(p);
      const s = 180 + rng() * 380;
      sp.scale.set(s, s * (0.45 + rng() * 0.25), 1);
      this.group.add(sp);
      placed++;
    }
  }

  update(pal, fog) {
    for (const m of this.mats) m.color.copy(pal.cloud).lerp(fog.color, 0.35);
  }
}

const SPRITE_VS = /* glsl */ `
attribute float aPhase;
uniform float uTime, uScale, uFogD;
varying float vA;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.5 + aPhase) * 6.0;
  p.y += sin(uTime * 0.7 + aPhase * 1.3) * 4.0;
  p.z += cos(uTime * 0.4 + aPhase) * 6.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  float f = uFogD * dist;
  vA = exp(-f * f) * (0.6 + 0.4 * sin(uTime * 2.0 + aPhase * 5.0));
  gl_PointSize = clamp(uScale * 2.6 / dist, 1.5, 40.0);
  gl_Position = projectionMatrix * mv;
}`;
const SPRITE_FS = /* glsl */ `
uniform float uGlow;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = smoothstep(0.5, 0.0, d);
  float rays = smoothstep(0.06, 0.0, abs(c.x)) * smoothstep(0.5, 0.1, abs(c.y))
             + smoothstep(0.06, 0.0, abs(c.y)) * smoothstep(0.5, 0.1, abs(c.x));
  float a = pow(core, 2.2) + rays * 0.35 * core;
  gl_FragColor = vec4(vec3(0.85, 1.0, 0.95) * uGlow, a * vA);
}`;

/** 漂浮的“圣树种子”（Atokirina）——夜晚尤为明亮 */
export class Woodsprites {
  constructor(scene, rng, track, treeTop) {
    const count = 1800;
    const pos = new Float32Array(count * 3);
    const ph = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = rng();
      let x, y, z;
      if (r < 0.6) {
        const s = track.samples[Math.floor(rng() * track.samples.length)];
        x = s.x + (rng() - 0.5) * 240; y = s.y + (rng() - 0.5) * 140; z = s.z + (rng() - 0.5) * 240;
      } else if (r < 0.85) {
        const a = rng() * Math.PI * 2, d = rng() * 180;
        x = treeTop.x + Math.cos(a) * d; y = treeTop.y + 5 + rng() * 120; z = treeTop.z + Math.sin(a) * d;
      } else {
        const a = rng() * Math.PI * 2, d = 300 + rng() * 2800;
        x = Math.cos(a) * d; y = -100 + rng() * 650; z = Math.sin(a) * d;
      }
      pos.set([x, y, z], i * 3);
      ph[i] = rng() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.uniforms = { uTime: { value: 0 }, uScale: { value: 600 }, uGlow: { value: 1 }, uFogD: { value: 0.0003 } };
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: SPRITE_VS,
        fragmentShader: SPRITE_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(time, night, storm, fog, pointScale) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uScale.value = pointScale;
    u.uFogD.value = fog.density;
    u.uGlow.value = (0.35 + night * 1.9) * (1 - storm * 0.6);
  }
}
