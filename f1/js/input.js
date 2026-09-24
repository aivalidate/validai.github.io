// 입력: 키보드, 터치 버튼, 기울기(자이로), 게임패드

import { clamp } from './util.js';

export const isTouch = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false };
    this.steer = 0;
    this.tilt = null;
    this.tiltZero = 0;
    this.settings = { steerMode: 'keys', autoThrottle: false, tiltInvert: false, tiltSens: 1 };
    this.enabled = true;
    this.padPrev = [];

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      Object.keys(this.touch).forEach((k) => (this.touch[k] = false));
    });
    window.addEventListener('deviceorientation', (e) => {
      if (e.beta == null) return;
      const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
      // 가로 화면에서는 beta가 핸들 회전에 해당
      let v;
      if (ang === 90) v = e.beta;
      else if (ang === -90 || ang === 270) v = -e.beta;
      else v = e.gamma;
      this.tilt = v;
    });
  }

  async enableTilt() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        return r === 'granted';
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  calibrateTilt() {
    if (this.tilt != null) this.tiltZero = this.tilt;
  }

  // 터치 조작 버튼 구성
  buildTouch(el, onAction) {
    const s = this.settings;
    const tilt = s.steerMode === 'tilt';
    el.innerHTML = `
      <div class="pad left">
        ${tilt ? '' : '<div class="tb" data-k="left" aria-label="왼쪽">◀</div><div class="tb" data-k="right" aria-label="오른쪽">▶</div>'}
      </div>
      <div class="mid">
        <div class="tb small" data-a="drs">DRS</div>
        <div class="tb small" data-a="pit">PIT</div>
      </div>
      <div class="pad right">
        <div class="tb brake" data-k="brake">BRAKE</div>
        ${s.autoThrottle ? '' : '<div class="tb gas" data-k="gas">GAS</div>'}
      </div>`;
    el.classList.add('shift-hud');
    const bind = (node) => {
      const k = node.dataset.k;
      const a = node.dataset.a;
      const on = (e) => {
        e.preventDefault();
        node.setPointerCapture && node.setPointerCapture(e.pointerId);
        node.classList.add('active');
        if (k) this.touch[k] = true;
        if (a) onAction(a);
      };
      const off = (e) => {
        node.classList.remove('active');
        if (k) this.touch[k] = false;
      };
      node.addEventListener('pointerdown', on);
      node.addEventListener('pointerup', off);
      node.addEventListener('pointercancel', off);
      node.addEventListener('lostpointercapture', off);
    };
    el.querySelectorAll('.tb').forEach(bind);
  }

  consume(code) {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  poll(dt) {
    const K = this.keys;
    const s = this.settings;
    let target = 0;
    let throttle = 0;
    let brake = 0;
    let analog = null;
    if (K.has('ArrowLeft') || K.has('KeyA')) target -= 1;
    if (K.has('ArrowRight') || K.has('KeyD')) target += 1;
    if (K.has('ArrowUp') || K.has('KeyW')) throttle = 1;
    if (K.has('ArrowDown') || K.has('KeyS')) brake = 1;
    if (this.touch.left) target -= 1;
    if (this.touch.right) target += 1;
    if (this.touch.gas) throttle = 1;
    if (this.touch.brake) brake = 1;

    if (s.steerMode === 'tilt' && this.tilt != null) {
      const v = (this.tilt - this.tiltZero) * (s.tiltInvert ? -1 : 1);
      analog = clamp((v / 28) * s.tiltSens, -1, 1);
      if (Math.abs(analog) < 0.03) analog = 0;
    }

    // 게임패드
    const presses = { drs: false, pit: false, cam: false, pause: false, compound: false, quit: false };
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) analog = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88);
      const rt = p.buttons[7] ? p.buttons[7].value : 0;
      const lt = p.buttons[6] ? p.buttons[6].value : 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (p.buttons[0] && p.buttons[0].pressed) throttle = Math.max(throttle, 1);
      const was = this.padPrev[p.index] || [];
      const edge = (i) => p.buttons[i] && p.buttons[i].pressed && !was[i];
      if (edge(1)) presses.drs = true;
      if (edge(2)) presses.pit = true;
      if (edge(3)) presses.cam = true;
      if (edge(9)) presses.pause = true;
      if (edge(5)) presses.compound = true;
      this.padPrev[p.index] = p.buttons.map((b) => b.pressed);
    }

    if (analog != null && target === 0) this.steer = analog;
    else {
      // 디지털 조향: 부드럽게 증가, 놓으면 빠르게 복귀
      const rate = target === 0 ? 7 : Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? 9 : 3.6;
      const d = target - this.steer;
      this.steer += clamp(d, -rate * dt, rate * dt);
    }

    if (this.consume('Space') || this.consume('KeyE')) presses.drs = true;
    if (this.consume('KeyP')) presses.pit = true;
    if (this.consume('KeyC')) presses.cam = true;
    if (this.consume('Escape') || this.consume('Enter')) presses.pause = true;
    if (this.consume('KeyT')) presses.compound = true;
    if (this.consume('KeyQ')) presses.quit = true;
    if (this.consume('KeyM')) presses.mute = true;
    if (this.consume('KeyR')) presses.reset = true;
    if (this.consume('KeyL')) presses.line = true;
    this.pressed.clear();

    return {
      steer: this.enabled ? this.steer : 0,
      throttle: this.enabled ? throttle : 0,
      brake: this.enabled ? brake : 0,
      drsPress: presses.drs,
      pitPress: presses.pit,
      compoundPress: presses.compound,
      camPress: presses.cam,
      pausePress: presses.pause,
      quitPress: presses.quit,
      mutePress: presses.mute,
      resetPress: presses.reset,
      linePress: presses.line,
    };
  }
}
