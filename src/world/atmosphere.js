import * as THREE from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';

// —— 调色板：白昼 / 夜晚 / 风暴（白昼与夜晚两版）——
const C = (hex) => new THREE.Color(hex);
const DAY = {
  zenith: C('#1b58a6'), horizon: C('#a3d9ea'), bottom: C('#76afc4'), fog: C('#9ccad9'),
  cloud: C('#ffffff'), sun: C('#fff0d6'), hemiSky: C('#c4e8ff'), hemiGround: C('#3b5a3c'),
  sunI: 2.7, hemiI: 1.05, fogD: 0.00024,
};
const NIGHT = {
  zenith: C('#02040f'), horizon: C('#13204b'), bottom: C('#0a1230'), fog: C('#0c1634'),
  cloud: C('#222c55'), sun: C('#8aa4ff'), hemiSky: C('#3b4fa0'), hemiGround: C('#0d1424'),
  sunI: 0.5, hemiI: 0.6, fogD: 0.0003,
};
const STORM = {
  zenith: C('#17172a'), horizon: C('#4b5168'), bottom: C('#353a4d'), fog: C('#454b5f'),
  cloud: C('#34364a'), sun: C('#9aa0b8'), hemiSky: C('#6c7494'), hemiGround: C('#22262f'),
  sunI: 0.55, hemiI: 0.8, fogD: 0.00085,
};
const COLOR_KEYS = ['zenith', 'horizon', 'bottom', 'fog', 'cloud', 'sun', 'hemiSky', 'hemiGround'];
const SCALAR_KEYS = ['sunI', 'hemiI', 'fogD'];

function clonePalette(p) {
  const o = {};
  COLOR_KEYS.forEach((k) => (o[k] = p[k].clone()));
  SCALAR_KEYS.forEach((k) => (o[k] = p[k]));
  return o;
}
function mixPalette(out, a, b, t) {
  COLOR_KEYS.forEach((k) => out[k].copy(a[k]).lerp(b[k], t));
  SCALAR_KEYS.forEach((k) => (out[k] = a[k] + (b[k] - a[k]) * t));
  return out;
}
const STORM_NIGHT = clonePalette(STORM);
COLOR_KEYS.forEach((k) => STORM_NIGHT[k].multiplyScalar(0.32));
STORM_NIGHT.sunI = 0.25;
STORM_NIGHT.hemiI = 0.5;

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FS = /* glsl */ `
uniform vec3 uZenith, uHorizon, uBottom, uCloud, uSunColor, uSunDir;
uniform float uTime, uStorm, uNight, uFlash;
varying vec3 vDir;
${NOISE_GLSL}
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uBottom, smoothstep(0.0, -0.25, h));

  float sd = max(dot(d, uSunDir), 0.0);
  float sunVis = 1.0 - uStorm * 0.92;
  col += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 64.0) * 0.5 + pow(sd, 8.0) * 0.18) * sunVis;

  if (uNight > 0.01) {
    float s = hash(floor(d * 420.0));
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 60.0);
    float starMask = smoothstep(0.0, 0.25, h) * (1.0 - uStorm);
    col += vec3(0.85, 0.9, 1.0) * step(0.9975, s) * tw * uNight * starMask * 1.6;
    float neb = fbm(d * 2.5 + vec3(0.0, uTime * 0.005, 0.0), 4);
    col += vec3(0.25, 0.06, 0.45) * smoothstep(0.1, 0.7, neb) * uNight * 0.4 * starMask;
    col += vec3(0.02, 0.2, 0.25) * smoothstep(0.2, 0.8, -neb) * uNight * 0.25 * starMask;
  }

  if (h > -0.02) {
    float hh = max(h, 0.0);
    vec2 uv = d.xz / (hh + 0.15);
    float n = fbm(vec3(uv * 0.7 + vec2(uTime * 0.006, uTime * 0.004), uTime * 0.012), 5);
    float cover = mix(0.18, -0.45, uStorm);
    float c = smoothstep(cover, cover + 0.5, n) * smoothstep(-0.02, 0.18, h);
    vec3 cc = uCloud * (0.7 + 0.45 * n);
    cc += uSunColor * pow(sd, 5.0) * 0.35 * sunVis;
    col = mix(col, cc, c * mix(0.75, 0.97, uStorm));
    col += vec3(0.75, 0.8, 1.0) * uFlash * (0.25 + c * 1.4);
  }
  col += vec3(0.6, 0.65, 0.9) * uFlash * 0.15;
  gl_FragColor = vec4(col, 1.0);
}`;

// 天空中的巨型气态行星（致敬波吕斐摩斯）
const PLANET_VS = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vObj;
varying vec3 vWorld;
void main() {
  vObj = normalize(position);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const PLANET_FS = /* glsl */ `
uniform vec3 uSunDir;
uniform float uAlpha, uTime;
varying vec3 vNormalW;
varying vec3 vObj;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  float lat = vObj.y;
  float warp = snoise(vObj * 3.0 + vec3(uTime * 0.01, 0.0, 0.0)) * 1.4;
  float b1 = sin(lat * 22.0 + warp) * 0.5 + 0.5;
  float b2 = sin(lat * 57.0 + snoise(vObj * 6.0 + 5.0) * 2.0) * 0.5 + 0.5;
  vec3 c1 = vec3(0.22, 0.52, 0.74), c2 = vec3(0.62, 0.82, 0.86), c3 = vec3(0.12, 0.26, 0.52);
  vec3 col = mix(c3, c1, b1);
  col = mix(col, c2, b2 * 0.35);
  float storm = smoothstep(0.08, 0.0, length(vObj.xy - vec2(0.35, -0.25)) - 0.05);
  col = mix(col, vec3(0.85, 0.75, 0.6), storm * 0.6);
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vWorld);
  float diff = clamp(dot(n, uSunDir) * 1.1, 0.0, 1.0);
  float rim = pow(1.0 - abs(dot(n, v)), 3.0);
  col = col * (0.06 + diff * 1.15) + vec3(0.4, 0.7, 1.0) * rim * 0.45 * (0.3 + diff);
  gl_FragColor = vec4(col, uAlpha);
}`;

export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.sunDir = new THREE.Vector3(0.5, 0.38, -0.78).normalize();
    this.base = clonePalette(DAY);
    this.stormP = clonePalette(STORM);
    this.cur = clonePalette(DAY);
    this.flashColor = new THREE.Color('#c9d3ff');

    scene.fog = this.fog = new THREE.FogExp2(DAY.fog.clone(), DAY.fogD);

    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiI);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI);
    this.sun.position.copy(this.sunDir).multiplyScalar(1000);
    scene.add(this.sun);
    this.flashLight = new THREE.AmbientLight(0xc8d4ff, 0);
    scene.add(this.flashLight);

    this.skyUniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uCloud: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir },
      uTime: { value: 0 },
      uStorm: { value: 0 },
      uNight: { value: 0 },
      uFlash: { value: 0 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(9000, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        vertexShader: SKY_VS,
        fragmentShader: SKY_FS,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.planetDir = new THREE.Vector3(-0.55, 0.3, -0.78).normalize();
    this.planetUniforms = { uSunDir: { value: this.sunDir }, uAlpha: { value: 0.85 }, uTime: { value: 0 } };
    this.planet = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: this.planetUniforms,
        vertexShader: PLANET_VS,
        fragmentShader: PLANET_FS,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.planet.rotation.z = 0.35;
    this.planet.frustumCulled = false;
    scene.add(this.planet);

    this.moons = [
      { dir: new THREE.Vector3(-0.2, 0.55, -0.81).normalize(), r: 170, color: '#d8cfc2' },
      { dir: new THREE.Vector3(0.75, 0.22, 0.62).normalize(), r: 110, color: '#a9c3d6' },
    ].map((m) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(m.r, 32, 16),
        new THREE.MeshStandardMaterial({ color: m.color, roughness: 1, fog: false, transparent: true }),
      );
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, dir: m.dir };
    });
  }

  /** 每帧更新：storm 0..1，night 0..1，flash 闪电亮度 */
  update(dt, camera, time, storm, night, flash) {
    mixPalette(this.base, DAY, NIGHT, night);
    mixPalette(this.stormP, STORM, STORM_NIGHT, night);
    const cur = mixPalette(this.cur, this.base, this.stormP, storm * 0.92);

    this.fog.color.copy(cur.fog).lerp(this.flashColor, Math.min(1, flash) * 0.3);
    this.fog.density = cur.fogD;
    this.hemi.color.copy(cur.hemiSky);
    this.hemi.groundColor.copy(cur.hemiGround);
    this.hemi.intensity = cur.hemiI;
    this.sun.color.copy(cur.sun);
    this.sun.intensity = cur.sunI;
    this.flashLight.intensity = flash * 3.2;

    const u = this.skyUniforms;
    u.uZenith.value.copy(cur.zenith);
    u.uHorizon.value.copy(cur.horizon);
    u.uBottom.value.copy(cur.bottom);
    u.uCloud.value.copy(cur.cloud);
    u.uSunColor.value.copy(cur.sun);
    u.uTime.value = time;
    u.uStorm.value = storm;
    u.uNight.value = night;
    u.uFlash.value = flash;

    this.sky.position.copy(camera.position);
    this.planet.position.copy(camera.position).addScaledVector(this.planetDir, 7000);
    this.planet.rotation.y = time * 0.002;
    this.planetUniforms.uTime.value = time;
    const vis = (0.82 + night * 0.18) * (1 - storm * 0.9);
    this.planetUniforms.uAlpha.value = vis;
    this.moons.forEach((m) => {
      m.mesh.position.copy(camera.position).addScaledVector(m.dir, 7600);
      m.mesh.material.opacity = vis;
    });
    return cur;
  }
}
