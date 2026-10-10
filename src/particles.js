import * as THREE from 'three';

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** 简单的粒子池：光环爆发、雷击电火花、撞击碎屑 */
export class Particles {
  constructor(scene, max = 1500) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3).fill(0);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -99999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 2.6, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.active = 0;
  }

  burst(p, color, count = 60, speed = 40, life = 1.2, drift = null) {
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const v = speed * (0.3 + Math.random() * 0.7);
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.vel[i * 3] = s * Math.cos(th) * v + (drift ? drift.x : 0);
      this.vel[i * 3 + 1] = u * v + (drift ? drift.y : 0);
      this.vel[i * 3 + 2] = s * Math.sin(th) * v + (drift ? drift.z : 0);
      const l = life * (0.6 + Math.random() * 0.4);
      this.life[i] = l;
      this.maxLife[i] = l;
      this.base.set([color.r, color.g, color.b], i * 3);
    }
    this.active = this.max;
  }

  update(dt) {
    if (!this.active) return;
    let alive = 0;
    const damp = Math.pow(0.97, dt * 60);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.col[j] = this.col[j + 1] = this.col[j + 2] = 0;
        this.pos[j + 1] = -99999;
        continue;
      }
      alive++;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.vel[j] *= damp;
      this.vel[j + 1] *= damp;
      this.vel[j + 2] *= damp;
      const k = this.life[i] / this.maxLife[i];
      this.col[j] = this.base[j] * k;
      this.col[j + 1] = this.base[j + 1] * k;
      this.col[j + 2] = this.base[j + 2] * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    if (!alive) this.active = 0;
  }
}
