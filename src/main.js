import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { mulberry32, createNoise3D } from './utils/noise.js';
import { clamp, damp, dampAngle, formatTime } from './utils/math.js';
import { Atmosphere } from './world/atmosphere.js';
import { CloudSea, CloudBank, Woodsprites } from './world/ambient.js';
import { Mountains } from './world/mountains.js';
import { SoulTree } from './world/soulTree.js';
import { Track } from './track.js';
import { Player } from './player.js';
import { StormSystem } from './storm.js';
import { Particles } from './particles.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { CameraRig } from './cameraRig.js';
import { Rivals, DIFFICULTY } from './rivals.js';

const SETTINGS_KEY = 'aeloria.settings';
const BEST_KEY = 'aeloria.best';
const DEFAULTS = { quality: 'high', invertY: false, sensitivity: 1, difficulty: 'normal' };

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 无痕模式下可能不可用 */
  }
}
function loadBest() {
  try {
    const v = parseFloat(localStorage.getItem(BEST_KEY));
    return isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
function saveBest(v) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* 忽略 */
  }
}

const COL_GOLD = new THREE.Color(2.6, 1.9, 0.6);
const COL_ZAP = new THREE.Color(1.6, 1.4, 3.2);
const COL_DUST = new THREE.Color(0.7, 0.6, 0.45);

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.settings = loadSettings();
    this.best = loadBest();

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' }));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.08;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setPixelRatio(this._pixelRatio());
    r.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 14000);

    // —— 构建世界 ——
    this.rng = mulberry32(0xae10a1);
    const noise = createNoise3D(this.rng);
    this.atmo = new Atmosphere(this.scene);
    this.track = new Track(this.scene, this.rng);
    this.mountains = new Mountains(this.scene, this.rng, noise, this.track);
    this.soulTree = new SoulTree(this.scene, this.rng, this.mountains.central);
    this.cloudSea = new CloudSea(this.scene);
    this.cloudBank = new CloudBank(this.scene, this.rng, this.track);
    this.sprites = new Woodsprites(this.scene, this.rng, this.track, this.soulTree.top);
    this.particles = new Particles(this.scene);
    this.player = new Player(this.scene);
    this.rivals = new Rivals(this.scene, this.track, this.particles);
    this.storm = new StormSystem(this.scene, this.rng);
    this.storm.rivals = this.rivals.list;
    this.audio = new AudioEngine();
    this.input = new Input(this.canvas);
    this.hud = new HUD(this.track, this.mountains, this.rivals);
    this.rig = new CameraRig(this.camera);
    this._setupComposer();

    // —— 状态 ——
    this.state = 'menu';
    this.mode = 'race';
    this.totalLaps = 3;
    this.time = 0;
    this.night = 0;
    this.nightTarget = 0;
    this.autoU = 0;
    this.prevPos = new THREE.Vector3();
    this._bump = new THREE.Vector3();
    this.lastHit = -10;
    this.lastWarn = -10;
    this.lastBump = -10;
    this.standings = null;
    this._resetRaceStats();

    this.player.onFlap = (p) => this.audio.flap(p);
    this.input.onKey = (code) => this._onKey(code);
    this.input.onLockChange = (locked) => {
      if (!locked && (this.state === 'playing' || this.state === 'countdown')) this.pause();
    };
    this.input.onCanvasClick = () => {
      if (this.state === 'playing' || this.state === 'countdown') this.input.lock();
    };
    this._applySettings();
    this._bindUI();

    const start = this.track.startFrame();
    this.player.placeAt(start.pos, start.dir);
    this.autoU = this.track.nearestU(start.pos);
    this.rivals.scatter(this.autoU * this.track.length);

    window.addEventListener('resize', () => this._resize());
    this._resize();
    this.clock = new THREE.Clock();
    document.getElementById('loading').classList.add('hidden');
    this._showMenu();
    this.renderer.setAnimationLoop(() => this._tick());
  }

  _pixelRatio() {
    return this.settings.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
  }

  _setupComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.45, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this._pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _applySettings() {
    const s = this.settings;
    this.bloom.enabled = s.quality === 'high';
    this.input.invertY = s.invertY;
    this.input.sensitivity = s.sensitivity;
    this.rivals.difficulty = DIFFICULTY[s.difficulty] || 1;
    document.getElementById('optDiff').value = s.difficulty;
    document.getElementById('optQuality').checked = s.quality === 'high';
    document.getElementById('optInvert').checked = s.invertY;
    document.getElementById('optSens').value = s.sensitivity;
  }

  _bindUI() {
    const $ = (id) => document.getElementById(id);
    $('btnRace').onclick = () => this.start('race');
    $('btnFree').onclick = () => this.start('free');
    $('btnResume').onclick = () => this.resume();
    $('btnRestart').onclick = () => this.start(this.mode);
    $('btnMenu').onclick = () => this._showMenu();
    $('btnAgain').onclick = () => this.start('race');
    $('btnResMenu').onclick = () => this._showMenu();
    $('optQuality').onchange = (e) => {
      this.settings.quality = e.target.checked ? 'high' : 'low';
      saveSettings(this.settings);
      this._applySettings();
      this._resize();
    };
    $('optInvert').onchange = (e) => {
      this.settings.invertY = e.target.checked;
      saveSettings(this.settings);
      this._applySettings();
    };
    $('optDiff').onchange = (e) => {
      this.settings.difficulty = e.target.value;
      saveSettings(this.settings);
      this._applySettings();
    };
    $('optSens').oninput = (e) => {
      this.settings.sensitivity = parseFloat(e.target.value);
      saveSettings(this.settings);
      this._applySettings();
    };
  }

  _overlay(id) {
    for (const o of ['menu', 'pause', 'results']) document.getElementById(o).classList.toggle('hidden', o !== id);
  }

  _showMenu() {
    if (this.state === 'playing' || this.state === 'countdown' || this.state === 'paused') {
      this.autoU = this.track.nearestU(this.player.position);
      this.rivals.scatter(this.autoU * this.track.length);
    }
    this.state = 'menu';
    this.input.unlock();
    this.hud.setVisible(false);
    document.getElementById('menuBest').textContent = formatTime(this.best);
    this._overlay('menu');
  }

  _resetRaceStats() {
    this.raceTime = 0;
    this.flightTime = 0;
    this.lap = 1;
    this.lapStart = 0;
    this.lapTimes = [];
    this.ringsPassed = 0;
    this.ringsInLap = 0;
    this.strikes = 0;
    this.collisions = 0;
    this.finishTime = null;
  }

  start(mode) {
    this.audio.init();
    this.mode = mode;
    this._resetRaceStats();
    this.track.reset();
    const s = this.track.startFrame();
    this.player.placeAt(s.pos, s.dir);
    this.rig.snap();
    this.hud.setVisible(true);
    this._overlay(null);
    this.input.lock();
    if (mode === 'race') {
      this.rivals.gridStart();
      this.state = 'countdown';
      this.countdown = 3;
      this.hud.message('3', 0.9, 'count');
      this.audio.beep(false);
    } else {
      this.rivals.scatter(-140);
      this.state = 'playing';
      this.player.speed = 75;
      this.hud.message('自由飞行 · 探索 Aeloria', 2.2, 'info');
    }
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.input.unlock();
    this._overlay('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.prevState;
    this._overlay(null);
    this.input.lock();
    this.clock.getDelta();
  }

  _finish() {
    this.state = 'finished';
    const total = this.raceTime;
    this.finishTime = total;
    const isRecord = this.best == null || total < this.best;
    if (isRecord) {
      this.best = total;
      saveBest(total);
    }
    this.autoU = this.track.nearestU(this.player.position);
    this.input.unlock();
    this.audio.fanfare();
    document.getElementById('resTotal').textContent = formatTime(total);
    const L = this.track.length * this.totalLaps;
    const final = this.rivals.list.map((r) => ({
      name: r.def.name, color: r.def.color, me: false,
      time: r.finished ? r.finishTime : total + (L - r.s) / Math.max(r.cur, 80), est: !r.finished,
    }));
    final.push({ name: '你', color: '#ffffff', me: true, time: total, est: false });
    final.sort((a, b) => a.time - b.time);
    const place = final.findIndex((f) => f.me) + 1;
    document.getElementById('resTitle').textContent = place === 1 ? '冠军！' : '竞速完成';
    document.getElementById('resPlace').textContent = `第 ${place} 名 / ${final.length}`;
    document.getElementById('resStandings').innerHTML = final
      .map((f, i) => `<div class="row${f.me ? ' me' : ''}"><span>${i + 1}</span><span class="dot" style="background:${f.color};color:${f.color}"></span><span>${f.name}</span><span class="t">${f.est ? '≈ ' : ''}${formatTime(f.time)}</span></div>`)
      .join('');
    document.getElementById('recordBadge').classList.toggle('hidden', !isRecord);
    const rows = this.lapTimes.map((t, i) => [`第 ${i + 1} 圈`, formatTime(t)]);
    rows.push(['最佳成绩', formatTime(this.best)], ['遭受雷击', `${this.strikes} 次`], ['撞击山体', `${this.collisions} 次`]);
    document.getElementById('resGrid').innerHTML = rows.map(([k, v]) => `<div>${k}</div><div class="v">${v}</div>`).join('');
    this._overlay('results');
  }

  _onKey(code) {
    switch (code) {
      case 'KeyN':
        this.nightTarget = this.nightTarget > 0.5 ? 0 : 1;
        this.hud.message(this.nightTarget ? '夜幕降临 · 生物荧光苏醒' : '晨光重回 Aeloria', 2, 'info');
        break;
      case 'KeyT': {
        const ev = [];
        this.storm.force(ev);
        ev.forEach((e) => this._onStormEvent(e));
        if (!ev.length) this.hud.message('风暴已经在路上了……', 1.5, 'info');
        break;
      }
      case 'KeyM':
        this.audio.setMuted(!this.audio.muted);
        this.hud.message(this.audio.muted ? '已静音' : '声音已开启', 1, 'info');
        break;
      case 'KeyC':
        this.hud.message(this.rig.cycle(), 1, 'info');
        break;
      case 'KeyP':
      case 'Escape':
        if (this.state === 'paused') this.resume();
        else this.pause();
        break;
      case 'KeyR':
        if (this.state !== 'menu') this.start(this.mode);
        break;
    }
  }

  _onStormEvent(ev) {
    const inGame = this.state === 'playing' || this.state === 'countdown';
    switch (ev.type) {
      case 'phase':
        if (ev.state === 'warning') {
          if (inGame) this.hud.message('⚠ 风暴正在逼近', 2.5, 'warn');
          this.audio.thunder(1400);
        } else if (ev.state === 'storm') {
          if (inGame) this.hud.message('⛈ 雷暴来袭！', 2, 'storm');
        } else if (ev.state === 'clearing') {
          if (inGame) this.hud.message('风暴渐息', 1.8, 'info');
        }
        break;
      case 'gust':
        if (inGame) this.hud.message('强阵风！', 1.2, 'warn');
        this.audio.gust();
        break;
      case 'charge':
        if (ev.isPlayer) {
          if (inGame) this.hud.message('⚡ 雷电锁定！快闪避！', 1.0, 'danger');
          this.audio.charge();
        } else if (ev.pos.distanceTo(this.player.position) < 600) {
          if (inGame) this.hud.message(`⚡ 雷电锁定了${ev.target.def.name}`, 1.0, 'info');
          this.audio.charge();
        }
        break;
      case 'strike': {
        this.audio.thunder(ev.dist);
        const near = clamp(1 - ev.dist / 700, 0, 1);
        this.rig.shake(near * 0.6);
        this.hud.flash(near * 0.35);
        if (ev.hit && this.state === 'playing') {
          this.player.stun();
          this.strikes++;
          this.hud.message('遭受雷击！', 1.6, 'danger');
          this.hud.flash(0.9);
          this.audio.zap();
          this.rig.shake(1.3);
          this.particles.burst(this.player.position, COL_ZAP, 120, 60, 0.9);
        }
        for (const rv of ev.rivalsHit) {
          rv.stunTime = 1.4;
          rv.cur *= 0.5;
          this.particles.burst(rv.position, COL_ZAP, 80, 50, 0.8);
          if (inGame && this.mode === 'race' && !ev.hit) this.hud.message(`${rv.def.name} 被闪电击中！`, 1.4, 'storm');
        }
        break;
      }
    }
  }

  // —— 主循环 ——
  _tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.state !== 'paused') this._simulate(dt);
    this.composer.render(dt);
  }

  _simulate(dt) {
    this.time += dt;
    this.night = damp(this.night, this.nightTarget, 0.8, dt);
    const events = [];
    this.storm.update(dt, this.camera, this.player, events, this.state === 'playing');
    events.forEach((e) => this._onStormEvent(e));

    switch (this.state) {
      case 'menu':
      case 'finished':
        this._autopilot(dt);
        break;
      case 'countdown':
        this._countdown(dt);
        break;
      case 'playing':
        this._play(dt);
        break;
    }
    const rivalEvents = this.rivals.update(dt, {
      state: this.state, mode: this.mode, time: this.time, raceTime: this.raceTime, totalLaps: this.totalLaps,
      playerProgress: this.playerProgress(), wind: this.storm.wind, turbulence: this.storm.turbulence,
    });
    for (const ev of rivalEvents) {
      if (ev.type === 'rivalFinish' && this.state === 'playing') this.hud.message(`${ev.rival.def.name} 冲过了终点`, 1.6, 'info');
    }
    this.rivals.updateVisuals(this.night, this.storm.intensity);
    if (this.mode === 'race' && this.state !== 'menu') {
      this.standings = this.rivals.standings({
        progress: this.playerProgress(), finished: this.finishTime != null, time: this.finishTime,
      });
    }
    this.player.updateTrails(this.storm.intensity);
    this.rig.update(dt, this.player, this.storm.turbulence);
    this.camera.updateMatrixWorld();

    const fog = this.scene.fog;
    const pal = this.atmo.update(dt, this.camera, this.time, this.storm.intensity, this.night, this.storm.flash);
    const pointScale = (this.renderer.domElement.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
    this.cloudSea.update(this.time, this.camera, pal, fog, this.night, this.storm.flash);
    this.cloudBank.update(pal, fog);
    this.sprites.update(this.time, this.night, this.storm.intensity, fog, pointScale);
    this.track.update(this.time, dt, fog.density, pointScale);
    this.mountains.update(this.time, this.night, fog);
    this.soulTree.update(this.time, this.night, fog);
    this.player.setNight(this.night);
    this.particles.update(dt);

    const inFlight = this.state === 'playing';
    this.audio.update(clamp((this.player.speed - 30) / 200, 0, 1), this.storm.intensity, inFlight);
    if (this.state !== 'menu') this.hud.update(dt, this);
  }

  /** 玩家沿赛道的进度（与对手的 s 同一度量） */
  playerProgress() {
    if (this.finishTime != null) return this.track.length * this.totalLaps;
    const sp = this.track.length / this.track.count;
    if (this.ringsPassed === 0) return -this.player.position.distanceTo(this.track.rings[0].pos);
    const d = this.player.position.distanceTo(this.track.nextRing.pos);
    return (this.ringsPassed - 1) * sp + Math.max(0, sp - d);
  }

  _autopilot(dt) {
    this.autoU = (this.autoU + (85 / this.track.length) * dt) % 1;
    const c = this.track.curve;
    const target = c.getPointAt(this.autoU);
    target.y += Math.sin(this.time * 0.5) * 12 + 18;
    const ahead = c.getPointAt((this.autoU + 0.004) % 1);
    ahead.y += Math.sin((this.time + 0.4) * 0.5) * 12 + 18;
    const dir = ahead.sub(target).normalize();
    this.player.autopilot(dt, target, dir);
  }

  _countdown(dt) {
    const before = Math.ceil(this.countdown);
    this.countdown -= dt;
    const after = Math.ceil(this.countdown);
    if (after !== before && after > 0) {
      this.hud.message(String(after), 0.9, 'count');
      this.audio.beep(false);
    }
    if (this.countdown <= 0) {
      this.state = 'playing';
      this.player.speed = 80;
      this.hud.message('起飞！', 1.2, 'count go');
      this.audio.beep(true);
      this.audio.whoosh();
    }
    this.player.hover(dt, this.time);
  }

  _play(dt) {
    const p = this.player;
    const ctl = this.input.getControls(dt);
    const wasBoosting = p.boosting;
    this.prevPos.copy(p.position);
    p.update(dt, ctl, { wind: this.storm.wind, turbulence: this.storm.turbulence, time: this.time });
    if (p.boosting && !wasBoosting) this.audio.whoosh();

    this._limits(dt);

    const hit = this.mountains.collide(p.position, 3.2);
    if (hit) {
      const impact = p.applyCollision(hit);
      if (impact > 25 && this.time - this.lastHit > 0.6) {
        this.lastHit = this.time;
        this.collisions++;
        const k = clamp(impact / 90, 0.3, 1);
        this.hud.message('撞上山体！', 1.1, 'warn');
        this.audio.hit(k);
        this.rig.shake(k);
        this.particles.burst(p.position, COL_DUST, 40, 25, 1.2);
      }
    }

    // 与对手擦碰
    for (const r of this.rivals.list) {
      const d = p.position.distanceTo(r.position);
      if (d < 7 && d > 1e-3) {
        const n = this._bump.subVectors(p.position, r.position).normalize();
        p.position.addScaledVector(n, 7 - d);
        r.drift.x += (n.x * p.forward.z - n.z * p.forward.x) * 2; // 对手也被撞得偏开一点
        if (this.time - this.lastBump > 1) {
          this.lastBump = this.time;
          p.speed *= 0.92;
          this.audio.hit(0.3);
          this.rig.shake(0.3);
        }
      }
    }

    const idx = this.track.checkPass(this.prevPos, p.position);
    if (idx >= 0) this._onRing(idx);

    if (this.mode === 'race') this.raceTime += dt;
    else this.flightTime += dt;
  }

  _onRing(idx) {
    const ring = this.track.rings[idx];
    const p = this.player;
    this.audio.chime(this.ringsPassed);
    this.particles.burst(ring.pos, COL_GOLD, 90, 45, 1.3, p.velocity.clone().multiplyScalar(0.5));
    p.energy = Math.min(100, p.energy + 18);
    p.speed = Math.min(p.speed + 10, 240);
    this.ringsPassed++;
    this.ringsInLap = idx === 0 ? 1 : this.ringsInLap + 1;
    if (this.mode !== 'race') return;
    if (idx === 0 && this.ringsPassed > 1) {
      this.lapTimes.push(this.raceTime - this.lapStart);
      this.lapStart = this.raceTime;
      this.lap++;
      if (this.lap > this.totalLaps) {
        this._finish();
        return;
      }
      this.audio.lapChime();
      this.hud.message(this.lap === this.totalLaps ? '最后一圈！' : `第 ${this.lap} 圈`, 2, 'lap');
    }
  }

  _limits(dt) {
    const p = this.player;
    const pos = p.position;
    const warn = (msg) => {
      if (this.time - this.lastWarn > 3) {
        this.lastWarn = this.time;
        this.hud.message(msg, 1.6, 'warn');
      }
    };
    if (pos.y < -118) {
      pos.y = -118;
      p.pitch = Math.max(p.pitch, 0.35);
      p.speed *= 0.985;
      warn('云海之下是无尽深渊！');
    }
    if (pos.y > 1300) {
      p.pitch = Math.min(p.pitch, -0.15);
      warn('空气太稀薄了');
    }
    const r = Math.hypot(pos.x, pos.z);
    if (r > 3300) {
      p.yaw = dampAngle(p.yaw, Math.atan2(pos.x, pos.z), 1.5, dt);
      warn('已飞离赛区，正在返航');
    }
  }
}

// 先让“加载中”画面绘制出来，再同步生成世界
setTimeout(() => {
  try {
    window.aeloria = new Game();
  } catch (err) {
    console.error(err);
    const el = document.querySelector('#loading .loading-text');
    if (el) el.textContent = '启动失败：' + (err && err.message ? err.message : err) + '（需要支持 WebGL2 的浏览器）';
  }
}, 50);
