import { clamp } from './utils/math.js';

const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** 键盘 + 鼠标（指针锁定的虚拟摇杆）+ 手柄 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.mouseL = false;
    this.mouseR = false;
    this.locked = false;
    this.sensitivity = 1;
    this.invertY = false;
    this.onKey = null;
    this.onLockChange = null;
    this.onCanvasClick = null;

    window.addEventListener('keydown', (e) => {
      if (BLOCK.has(e.code)) e.preventDefault();
      if (!e.repeat && this.onKey) this.onKey(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseL = this.mouseR = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const k = 0.0028 * this.sensitivity;
      this.stick.x = clamp(this.stick.x + e.movementX * k, -1, 1);
      this.stick.y = clamp(this.stick.y + e.movementY * k, -1, 1);
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseL = true;
      if (e.button === 2) this.mouseR = true;
      if (!this.locked && this.onCanvasClick) this.onCanvasClick();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseL = false;
      if (e.button === 2) this.mouseR = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.stick.x = this.stick.y = 0;
        this.mouseL = this.mouseR = false;
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {
      /* 某些环境不支持指针锁定，键盘仍可操作 */
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  has(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  getControls(dt) {
    const k = Math.exp(-dt * 1.6);
    this.stick.x *= k;
    this.stick.y *= k;
    let turn = 0, pitch = 0;
    if (this.has('KeyA', 'ArrowLeft')) turn -= 1;
    if (this.has('KeyD', 'ArrowRight')) turn += 1;
    if (this.has('KeyW', 'ArrowUp')) pitch += 1;
    if (this.has('KeyS', 'ArrowDown')) pitch -= 1;
    const inv = this.invertY ? -1 : 1;
    if (this.invertY) pitch = -pitch;
    turn += this.stick.x;
    pitch += -this.stick.y * inv;
    let flap = this.has('Space') || this.mouseL;
    let boost = this.has('ShiftLeft', 'ShiftRight') || this.mouseR;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      turn += dz(gp.axes[0] || 0);
      pitch += -dz(gp.axes[1] || 0) * inv;
      flap = flap || (gp.buttons[0] && gp.buttons[0].pressed);
      boost = boost || (gp.buttons[7] && gp.buttons[7].value > 0.3) || (gp.buttons[5] && gp.buttons[5].pressed);
    }
    return { turn: clamp(turn, -1, 1), pitch: clamp(pitch, -1, 1), flap, boost };
  }
}
