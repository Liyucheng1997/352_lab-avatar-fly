import * as THREE from 'three';
import { clamp, formatTime } from './utils/math.js';

const STORM_TEXT = {
  warning: '⚠ 风暴正在逼近',
  storm: '⛈ 雷暴',
  clearing: '☁ 风暴正在消散',
};

/** 抬头显示：计时、圈数、速度、灵能、风暴状态、光环指示器、小地图 */
export class HUD {
  constructor(track, mountains, rivals) {
    const $ = (id) => document.getElementById(id);
    this.root = $('hud');
    this.el = {
      lap: $('lapValue'), lapLabel: $('lapLabel'), time: $('timeValue'), best: $('bestValue'), rings: $('ringValue'),
      speed: $('speedValue'), speedBar: $('speedBar'), energyBar: $('energyBar'), alt: $('altValue'),
      storm: $('stormBanner'), msg: $('message'), marker: $('ringMarker'), dist: $('ringDist'), arrow: $('ringArrow'),
      vignette: $('vignette'), flash: $('flashOverlay'), stormTint: $('stormTint'),
      place: $('placeValue'), placePanel: $('placePanel'), standings: $('standings'),
    };
    this.rivals = rivals;
    const tagsRoot = $('tags');
    this.tags = rivals.list.map((r) => {
      const el = document.createElement('div');
      el.className = 'tag';
      el.innerHTML = `<span class="p"></span><span class="dot" style="background:${r.def.color};color:${r.def.color}"></span><span>${r.def.name}</span>`;
      tagsRoot.appendChild(el);
      return { el, pos: el.querySelector('.p'), rival: r, shown: false };
    });
    this._standKey = '';
    this.track = track;
    this.mountains = mountains;
    this.mm = $('minimap');
    this.ctx = this.mm.getContext('2d');
    this.msgTimer = 0;
    this.flashV = 0;
    this._v = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this.mapScale = 92 / 1850;
  }

  setVisible(v) {
    this.root.classList.toggle('hidden', !v);
  }

  message(text, dur = 1.8, kind = '') {
    const m = this.el.msg;
    m.textContent = text;
    m.className = 'message ' + kind;
    void m.offsetWidth; // 重启 CSS 动画
    m.classList.add('show');
    this.msgTimer = dur;
  }

  flash(a) {
    this.flashV = Math.max(this.flashV, a);
  }

  update(dt, g) {
    const e = this.el;
    const p = g.player;
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) e.msg.classList.remove('show');
    }
    this.flashV = Math.max(0, this.flashV - dt * 2.5);
    e.flash.style.opacity = this.flashV.toFixed(3);

    const racing = g.mode === 'race';
    e.placePanel.style.display = racing ? '' : 'none';
    e.standings.style.display = racing ? '' : 'none';
    if (racing) this._standings(g);
    this._tags(g);
    if (racing) {
      e.lapLabel.textContent = '圈数';
      e.lap.textContent = `${Math.min(g.lap, g.totalLaps)} / ${g.totalLaps}`;
      e.time.textContent = formatTime(g.raceTime);
      e.best.textContent = '最佳 ' + formatTime(g.best);
      e.rings.textContent = `${g.ringsInLap} / ${this.track.count}`;
    } else {
      e.lapLabel.textContent = '模式';
      e.lap.textContent = '自由';
      e.time.textContent = formatTime(g.flightTime);
      e.best.textContent = '自由飞行';
      e.rings.textContent = String(g.ringsPassed);
    }
    e.speed.textContent = Math.round(p.speed * 1.8);
    e.speedBar.style.width = `${clamp(p.speed / 260, 0, 1) * 100}%`;
    e.speedBar.classList.toggle('boost', p.boosting);
    e.energyBar.style.width = `${p.energy}%`;
    e.energyBar.classList.toggle('low', p.energy < 20);
    e.alt.textContent = Math.round(p.position.y + 150);

    const s = g.storm;
    if (s.state !== 'calm' || s.intensity > 0.05) {
      let txt = STORM_TEXT[s.state] || '风暴余波';
      if (s.state === 'storm') txt += ` · 风速 ${Math.round(s.windSpeed * 1.8)} km/h`;
      e.storm.textContent = txt;
      e.storm.className = 'storm-banner show ' + s.state;
    } else {
      e.storm.className = 'storm-banner';
    }
    e.vignette.style.opacity = (clamp((p.speed - 120) / 140, 0, 1) * 0.55 + s.intensity * 0.35).toFixed(3);
    e.stormTint.style.opacity = (s.intensity * 0.5).toFixed(3);

    this._ringIndicator(g.camera);
    this._minimap(g);
  }

  _standings(g) {
    const rows = g.standings;
    const me = rows.findIndex((r) => r.isPlayer);
    this.el.place.textContent = `${me + 1} / ${rows.length}`;
    const myProg = rows[me].progress;
    const html = rows
      .map((r, i) => {
        let gap;
        if (r.finished) gap = `<span class="gap done">${formatTime(r.time)}</span>`;
        else if (r.isPlayer) gap = '<span class="gap"></span>';
        else {
          const d = Math.round(r.progress - myProg);
          gap = `<span class="gap">${d >= 0 ? '+' : '−'}${Math.abs(d)} m</span>`;
        }
        return `<div class="row${r.isPlayer ? ' me' : ''}"><span class="pos">${i + 1}</span><span class="dot" style="background:${r.color};color:${r.color}"></span><span>${r.name}</span>${gap}</div>`;
      })
      .join('');
    if (html !== this._standKey) {
      this._standKey = html;
      this.el.standings.innerHTML = html;
    }
  }

  _tags(g) {
    const cam = g.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const place = new Map();
    if (g.mode === 'race' && g.standings) g.standings.forEach((r, i) => r.rival && place.set(r.rival, i + 1));
    for (const t of this.tags) {
      const r = t.rival;
      this._c.copy(r.position).applyMatrix4(cam.matrixWorldInverse);
      const dist = cam.position.distanceTo(r.position);
      const visible = this._c.z < 0 && dist < 1400;
      let onScreen = false;
      if (visible) {
        this._v.copy(r.position);
        this._v.y += 5;
        this._v.project(cam);
        onScreen = Math.abs(this._v.x) < 1.05 && Math.abs(this._v.y) < 1.05;
      }
      if (!onScreen) {
        if (t.shown) {
          t.el.style.display = 'none';
          t.shown = false;
        }
        continue;
      }
      if (!t.shown) {
        t.el.style.display = 'flex';
        t.shown = true;
      }
      const x = ((this._v.x + 1) / 2) * W, y = ((1 - this._v.y) / 2) * H;
      t.el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      t.el.style.opacity = clamp(1.3 - dist / 1100, 0.25, 1).toFixed(2);
      t.pos.textContent = place.get(r) || '';
    }
  }

  _ringIndicator(camera) {
    const ring = this.track.nextRing;
    const e = this.el;
    const W = window.innerWidth, H = window.innerHeight;
    const cam = this._c.copy(ring.pos).applyMatrix4(camera.matrixWorldInverse);
    const behind = cam.z > 0;
    const v = this._v.copy(ring.pos).project(camera);
    let x = v.x, y = v.y;
    if (behind) {
      x = -x;
      y = -y;
      if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01) y = -1;
    }
    const dist = camera.position.distanceTo(ring.pos);
    if (!behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88) {
      e.marker.style.display = 'block';
      e.arrow.style.display = 'none';
      e.marker.style.transform = `translate(${((x + 1) / 2) * W}px, ${((1 - y) / 2) * H}px)`;
      e.dist.textContent = `${Math.round(dist)} m`;
    } else {
      e.marker.style.display = 'none';
      e.arrow.style.display = 'block';
      const a = Math.atan2(y, x);
      const px = ((Math.cos(a) * 0.86 + 1) / 2) * W;
      const py = ((1 - Math.sin(a) * 0.8) / 2) * H;
      e.arrow.style.transform = `translate(${px}px, ${py}px) rotate(${-a}rad)`;
    }
  }

  _minimap(g) {
    const ctx = this.ctx;
    const S = 200, C = 100, k = this.mapScale;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, 96, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(4, 18, 28, 0.62)';
    ctx.fillRect(0, 0, S, S);

    ctx.fillStyle = 'rgba(120, 190, 150, 0.28)';
    for (const m of this.mountains.colliders) {
      ctx.beginPath();
      ctx.arc(C + m.x * k, C + m.z * k, Math.max(1.4, m.r * k * 0.9), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(90, 230, 255, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.track.samples.forEach((s, i) => (i ? ctx.lineTo(C + s.x * k, C + s.z * k) : ctx.moveTo(C + s.x * k, C + s.z * k)));
    ctx.closePath();
    ctx.stroke();

    for (const r of this.track.rings) {
      const next = r.index === this.track.next;
      ctx.fillStyle = next ? '#ffc94a' : r.index === 0 ? '#ff6fd8' : 'rgba(150, 240, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(C + r.pos.x * k, C + r.pos.z * k, next ? 4 : 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const r of this.rivals.list) {
      ctx.fillStyle = r.def.color;
      ctx.beginPath();
      ctx.arc(C + r.position.x * k, C + r.position.z * k, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const p = g.player;
    const px = C + p.position.x * k, py = C + p.position.z * k;
    const a = Math.atan2(p.forward.z, p.forward.x);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, 4.5);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-5, -4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const s = g.storm;
    if (s.intensity > 0.05) {
      ctx.fillStyle = `rgba(110, 60, 160, ${s.intensity * 0.28})`;
      ctx.fillRect(0, 0, S, S);
      // 风向箭头
      const wl = clamp(s.windSpeed / 70, 0.2, 1) * 26;
      const wa = Math.atan2(s.wind.z, s.wind.x);
      ctx.save();
      ctx.translate(C, 30);
      ctx.rotate(wa);
      ctx.strokeStyle = `rgba(220, 200, 255, ${0.4 + s.intensity * 0.6})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-wl / 2, 0);
      ctx.lineTo(wl / 2, 0);
      ctx.lineTo(wl / 2 - 6, -5);
      ctx.moveTo(wl / 2, 0);
      ctx.lineTo(wl / 2 - 6, 5);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(120, 230, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(C, C, 96, 0, Math.PI * 2);
    ctx.stroke();
  }
}
