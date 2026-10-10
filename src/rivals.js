import * as THREE from 'three';
import { Player } from './player.js';
import { PALETTES } from './ikran.js';
import { clamp, damp, lerp } from './utils/math.js';

// 四位纳美对手：各自的配色、基础速度与飞行风格
export const RIVAL_DEFS = [
  { id: 'ralu', name: '拉鲁', color: '#ff8a3d', trail: [1.4, 0.6, 0.25], speed: 136, wander: 1.2, boostRate: 1.2 },
  { id: 'seyri', name: '塞瑞', color: '#e070ff', trail: [1.2, 0.4, 1.4], speed: 131, wander: 1.0, boostRate: 1.0 },
  { id: 'nikxa', name: '妮卡', color: '#9dff6a', trail: [0.6, 1.4, 0.4], speed: 126, wander: 0.8, boostRate: 0.9 },
  { id: 'toka', name: '托卡', color: '#a8f0ff', trail: [0.9, 1.2, 1.5], speed: 121, wander: 0.6, boostRate: 0.8 },
];

export const DIFFICULTY = { easy: 0.88, normal: 1.0, hard: 1.1 };

// 发车位置：相对起点的 (沿赛道偏移, 横向, 纵向)
const GRID = [
  [-10, -32, 4],
  [-10, 32, 4],
  [-45, -16, -3],
  [-45, 16, -3],
];
const UP = new THREE.Vector3(0, 1, 0);

class Rival extends Player {
  constructor(scene, def, index) {
    super(scene, { palette: PALETTES[def.id], trailColor: new THREE.Color(...def.trail) });
    this.def = def;
    this.index = index;
    this.grid = GRID[index];
    this.s = 0; // 沿赛道的累计距离（第 0 号光环处为 0）
    this.cur = 0; // 当前速度
    this.ph = [Math.random() * 10, Math.random() * 10, Math.random() * 10];
    this.boostTimer = 6;
    this.boostLeft = 0;
    this.blend = 1;
    this.drift = new THREE.Vector2();
    this.ringIdx = 0;
    this.finished = false;
    this.finishTime = null;
  }

  get progress() {
    return this.s;
  }
}

/** AI 对手：沿赛道样条飞行，带橡皮筋平衡、冲刺爆发，并受风暴影响 */
export class Rivals {
  constructor(scene, track, particles) {
    this.track = track;
    this.particles = particles;
    this.difficulty = 1;
    this.list = RIVAL_DEFS.map((d, i) => new Rival(scene, d, i));
    this.spacing = track.length / track.count;
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._col = new THREE.Color();
  }

  /** 菜单 / 自由飞行：在给定位置前方结伴巡航 */
  scatter(baseS) {
    this.list.forEach((r, i) => {
      r.s = baseS + 45 + i * 60;
      this._reset(r, 90, 1);
    });
  }

  /** 竞速：排到发车格 */
  gridStart() {
    this.list.forEach((r) => {
      r.s = -140 + r.grid[0];
      this._reset(r, 0, 0);
      r.boostTimer = 4 + Math.random() * 8;
    });
  }

  _reset(r, speed, blend) {
    r.cur = speed;
    r.blend = blend;
    r.finished = false;
    r.finishTime = null;
    r.stunTime = 0;
    r.boostLeft = 0;
    r.drift.set(0, 0);
    r.ringIdx = 0;
    this._compute(r, this._time || 0);
    r.position.copy(this._pos);
    r.setDirection(this._t);
    r.velocity.set(0, 0, 0);
    r._applyTransform();
    r.trails.forEach((t) => (t.init = false));
  }

  /** 根据 r.s 与横向偏移计算目标位置 this._pos，切线写入 this._t */
  _compute(r, time) {
    const L = this.track.length;
    const u = (((r.s % L) + L) % L) / L;
    const c = this.track.curve;
    c.getPointAt(u, this._p);
    c.getTangentAt(u, this._t);
    this._side.crossVectors(this._t, UP).normalize();
    this._up.crossVectors(this._side, this._t).normalize();
    const w = r.def.wander;
    const latP = (Math.sin(time * 0.23 + r.ph[0]) * 7 + Math.sin(time * 0.61 + r.ph[1]) * 3) * w;
    const verP = Math.sin(time * 0.31 + r.ph[2]) * 5 * w;
    const lat = clamp(lerp(r.grid[1], latP, r.blend) + r.drift.x, -34, 34);
    const ver = lerp(r.grid[2], verP, r.blend) + r.drift.y;
    this._pos.copy(this._p).addScaledVector(this._side, lat).addScaledVector(this._up, ver);
  }

  /**
   * ctx: { state, mode, time, raceTime, totalLaps, playerProgress, wind, turbulence }
   * 返回事件数组（对手完赛等）
   */
  update(dt, ctx) {
    const events = [];
    this._time = ctx.time;
    const L = this.track.length;
    for (const r of this.list) {
      if (ctx.state === 'countdown') {
        r.hover(dt, ctx.time + r.index * 0.7);
        continue;
      }
      const racing = ctx.mode === 'race' && ctx.state === 'playing' && !r.finished;
      this._compute(r, ctx.time);
      const slope = this._t.y;
      let target;
      if (racing) {
        target = r.def.speed * this.difficulty;
        target *= 1 - slope * 0.35;
        target += ctx.wind.dot(this._t) * 0.4;
        target *= 1 - ctx.turbulence * 0.06;
        // 橡皮筋：领先太多稍稍放慢，落后太多稍稍追赶
        const gap = r.s - ctx.playerProgress;
        if (gap > 250) target *= 1 - Math.min(0.12, (gap - 250) / 2500);
        else if (gap < -250) target *= 1 + Math.min(0.12, (-gap - 250) / 2500);
        r.boostTimer -= dt * r.def.boostRate;
        if (r.boostTimer <= 0 && r.boostLeft <= 0) {
          r.boostLeft = 1.5 + Math.random() * 1.5;
          r.boostTimer = 6 + Math.random() * 9;
        }
        if (r.boostLeft > 0) {
          r.boostLeft -= dt;
          target += 55;
        }
      } else {
        target = 90;
        r.boostLeft = 0;
      }
      if (r.stunTime > 0) {
        r.stunTime -= dt;
        target *= 0.45;
      }
      r.cur = damp(r.cur, target, 1.2, dt);
      r.s += r.cur * dt;
      r.blend = Math.min(1, r.blend + dt / 5);

      // 风把对手推离航线，再慢慢修正回来
      r.drift.x += ctx.wind.dot(this._side) * 0.35 * dt;
      r.drift.y += ctx.wind.y * 0.3 * dt;
      r.drift.multiplyScalar(Math.exp(-dt * 0.8));
      r.drift.x = clamp(r.drift.x, -10, 10);
      r.drift.y = clamp(r.drift.y, -8, 8);

      if (racing && r.s >= ctx.totalLaps * L) {
        r.finished = true;
        r.finishTime = ctx.raceTime - (r.s - ctx.totalLaps * L) / Math.max(r.cur, 1);
        events.push({ type: 'rivalFinish', rival: r });
      }
      if (racing && r.s >= 0) {
        const k = Math.floor(r.s / this.spacing);
        if (k >= r.ringIdx) {
          r.ringIdx = k + 1;
          this._col.set(r.def.color).multiplyScalar(2);
          this.particles.burst(r.position, this._col, 22, 25, 0.8);
        }
      }

      this._compute(r, ctx.time);
      this._dir.subVectors(this._pos, r.position);
      if (this._dir.lengthSq() > 1e-4) this._dir.normalize();
      else this._dir.copy(this._t);
      const flapping = r.cur < target - 4 || r.boostLeft > 0 || slope > 0.12;
      r.follow(dt, this._pos, this._dir, r.cur, flapping, r.boostLeft > 0);
    }
    return events;
  }

  /** 排名：完赛者按用时，其余按赛道进度 */
  standings(player) {
    const rows = this.list.map((r) => ({
      name: r.def.name, color: r.def.color, isPlayer: false, rival: r,
      progress: r.s, finished: r.finished, time: r.finishTime,
    }));
    rows.push({ name: '你', color: '#ffffff', isPlayer: true, progress: player.progress, finished: player.finished, time: player.time });
    rows.sort((a, b) => {
      if (a.finished && b.finished) return a.time - b.time;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    return rows;
  }

  updateVisuals(night, stormIntensity) {
    for (const r of this.list) {
      r.setNight(night);
      r.updateTrails(stormIntensity);
    }
  }
}
