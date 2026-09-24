// 게임 진입점: 상태 관리, 메인 루프, 세션 흐름(예선 → 결승 → 결과), 커리어 저장

import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input, isTouch } from './input.js';
import { Sound } from './audio.js';
import { Menu } from './ui.js';
import { TRACKS, buildTrack } from './tracks.js';
import { Session, simulateQuali, PLAYER_ID } from './race.js';
import { TEAMS, DRIVERS, COMPOUNDS, teamById } from './data.js';
import { storage, fmtTime, hexToRgb } from './util.js';

const CALENDAR = ['albion', 'riviera', 'parco', 'sakura', 'maple', 'oasis'];

class App {
  constructor() {
    this.touch = isTouch();
    const defaults = {
      steerMode: this.touch ? 'buttons' : 'keys',
      autoThrottle: this.touch,
      tiltInvert: false,
      brakeAssist: 1,
      steerAssist: this.touch,
      racingLine: 'brake',
      autoDrs: this.touch,
      difficulty: 1,
      laps: 5,
      camera: 'chase',
      quality: this.touch ? 'mid' : 'high',
      sound: true,
    };
    this.settings = { ...defaults, ...storage.get('settings', {}) };
    this.profile = { name: '플레이어', code: 'PLY', team: 'taurus', ...storage.get('profile', {}) };
    this.career = storage.get('career', null);
    this.trackCache = {};
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas);
    this.hud = new Hud();
    this.input = new Input();
    this.sound = new Sound();
    this.menu = new Menu(this);
    this.state = 'menu';
    this.paused = false;
    this.S = null;
    this.touchPress = {};
    this.applySettings();
    this.applyAccent(this.profile.team);

    window.addEventListener('resize', () => {
      this.renderer.resize();
      if (this.S) this.hud.prepMinimap(this.S.track);
      this.checkRotate();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'race' && !this.paused) this.pause();
    });
    document.getElementById('btn-pause').addEventListener('click', () => (this.paused ? this.resume() : this.pause()));
    document.getElementById('btn-cam').addEventListener('click', () => this.cycleCamera());
    document.getElementById('rotate-ok').addEventListener('click', () => {
      this.rotateDismissed = true;
      this.checkRotate();
    });

    this.last = performance.now();
    this.finishTimer = -1;
    const params = new URLSearchParams(location.search);
    if (params.get('autotest')) this.autotest(params);
    else this.toMenu();
    document.getElementById('loading').hidden = true;
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------------------------------------------------------------------------
  getTrack(id) {
    if (!this.trackCache[id]) this.trackCache[id] = buildTrack(TRACKS.find((t) => t.id === id) || TRACKS[0]);
    return this.trackCache[id];
  }

  saveSettings() {
    storage.set('settings', this.settings);
    this.applySettings();
  }

  saveProfile() {
    storage.set('profile', this.profile);
  }

  applySettings() {
    const s = this.settings;
    Object.assign(this.input.settings, { steerMode: this.touch ? s.steerMode : 'keys', autoThrottle: this.touch && s.autoThrottle, tiltInvert: s.tiltInvert });
    if (this.renderer.quality !== s.quality) this.renderer.setQuality(s.quality);
    this.renderer.camMode = s.camera;
    this.sound.setMuted(!s.sound);
    if (this.S) this.S.opts.assists = { brake: s.brakeAssist, steer: s.steerAssist, autoThrottle: this.touch && s.autoThrottle, autoDrs: s.autoDrs };
  }

  applyAccent(teamId) {
    const t = teamById(teamId) || TEAMS[0];
    const lum = (hex) => {
      const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const pick = [t.accent, t.trim, t.color].find((c) => lum(c) > 0.2 && lum(c) < 0.9) || '#e4202e';
    document.documentElement.style.setProperty('--accent', pick);
    document.documentElement.style.setProperty('--accent-ink', lum(pick) > 0.55 ? '#0d1116' : '#ffffff');
  }

  previewTeam(teamId) {
    this.applyAccent(teamId);
    this.renderer.showcase(teamById(teamId));
  }

  toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  async enableTilt() {
    const ok = await this.input.enableTilt();
    this.toast(ok ? '기울기 센서를 사용할 수 있어요' : '이 기기나 브라우저에서는 기울기 센서를 쓸 수 없어요');
  }

  // ---------------------------------------------------------------------------
  toMenu() {
    this.state = 'menu';
    this.paused = false;
    this.S = null;
    this.weekend = null;
    this.hud.show(false);
    document.getElementById('touch').hidden = true;
    document.getElementById('rotate').hidden = true;
    if (!this.renderer.track) this.renderer.loadTrack(this.getTrack(this.career ? this.career.calendar[Math.min(this.career.round, 5)] : 'albion'));
    this.renderer.showcase(teamById(this.career ? this.career.team : this.profile.team));
    this.applyAccent(this.career ? this.career.team : this.profile.team);
    this.menu.state = {};
    this.menu.show('main');
    this.releaseWakeLock();
  }

  newCareer(team) {
    const teamPoints = {};
    TEAMS.forEach((t) => (teamPoints[t.id] = 0));
    this.career = {
      team,
      name: this.profile.name,
      code: this.profile.code,
      difficulty: this.settings.difficulty,
      laps: this.settings.laps,
      calendar: CALENDAR.slice(),
      round: 0,
      results: [],
      points: {},
      teamPoints,
    };
    storage.set('career', this.career);
    this.applyAccent(team);
  }

  deleteCareer() {
    this.career = null;
    storage.remove('career');
  }

  startWeekend({ trackId, teamId, quali, compound, career }) {
    const c = career ? this.career : null;
    this.weekend = {
      trackId,
      teamId,
      compound,
      career: !!career,
      laps: c ? c.laps : this.settings.laps,
      difficulty: c ? c.difficulty : this.settings.difficulty,
    };
    this.applyAccent(teamId);
    if (quali) {
      this.startSession({ trackId, mode: 'quali', teamId, difficulty: this.weekend.difficulty });
    } else {
      // 예선 생략: 커리어는 맨 뒤, 퀵 레이스는 무작위 그리드
      const codes = DRIVERS.filter((d) => d !== DRIVERS.filter((x) => x.team === teamId)[1]).map((d) => d.code);
      for (let i = codes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [codes[i], codes[j]] = [codes[j], codes[i]];
      }
      const pos = career ? codes.length : 5 + Math.floor(Math.random() * 10);
      codes.splice(pos, 0, PLAYER_ID);
      this.weekend.grid = codes;
      this.startRaceFromGrid(compound);
    }
  }

  startRaceFromGrid(compound) {
    const w = this.weekend;
    w.compound = compound || w.compound;
    this.startSession({
      trackId: w.trackId,
      mode: 'race',
      teamId: w.teamId,
      grid: w.grid,
      laps: w.laps,
      difficulty: w.difficulty,
      compound: w.compound,
    });
  }

  startSession(cfg) {
    this.lastCfg = cfg;
    const track = this.getTrack(cfg.trackId);
    if (this.renderer.track !== track) this.renderer.loadTrack(track);
    const career = this.weekend && this.weekend.career ? this.career : null;
    const s = this.settings;
    const S = new Session({
      track,
      mode: cfg.mode,
      laps: cfg.laps || s.laps,
      difficulty: cfg.difficulty ?? s.difficulty,
      playerTeam: cfg.teamId,
      playerName: career ? career.name : this.profile.name,
      playerCode: career ? career.code : this.profile.code,
      playerNum: 1,
      grid: cfg.grid,
      startCompound: cfg.compound || 'M',
      assists: { brake: s.brakeAssist, steer: s.steerAssist, autoThrottle: this.touch && s.autoThrottle, autoDrs: s.autoDrs },
    });
    if (cfg.auto) S.player.auto = true;
    this.S = S;
    this.renderer.setCars(S.cars, TEAMS);
    this.renderer.camMode = s.camera;
    this.renderer.camPos.set(0, -999, 0);
    this.renderer.camYaw = S.player.h;
    this.hud.start(S, track);
    this.hud.show(true);
    this.menu.hide();
    this.state = 'race';
    this.paused = false;
    this.finishTimer = -1;
    this.qualiEndTimer = -1;
    this.lastPosMsg = 0;
    this.sound.init();
    this.sound.setMuted(!s.sound);
    this.input.pressed.clear();
    // 터치 조작
    const touchEl = document.getElementById('touch');
    touchEl.hidden = !this.touch;
    if (this.touch) {
      this.input.buildTouch(touchEl, (a) => (this.touchPress[a] = true));
      if (s.steerMode === 'tilt') setTimeout(() => this.input.calibrateTilt(), 300);
    }
    // 타임 트라이얼 고스트
    this.ghost = null;
    this.rec = [];
    this.recLap = -1;
    if (cfg.mode === 'tt') {
      const best = storage.get('tt.' + track.id, null);
      if (best && best.ghost) this.ghost = best;
      this.renderer.setGhost(this.ghost ? teamById(best.team) || TEAMS[0] : null);
    } else this.renderer.setGhost(null);
    this.checkRotate();
    this.requestWakeLock();
    if (cfg.mode === 'quali') this.hud.message('예선', '플라잉 랩 3번 · 출발선부터 기록', 2.6);
    if (cfg.mode === 'tt') this.hud.message('타임 트라이얼', this.ghost ? `베스트 ${fmtTime(this.ghost.time)} 고스트와 함께` : '출발선부터 기록', 2.6);
  }

  restart() {
    if (!this.lastCfg) return this.toMenu();
    this.startSession(this.lastCfg);
  }

  pause() {
    if (this.state !== 'race') return;
    this.paused = true;
    this.menu.show('pause');
  }

  resume() {
    this.paused = false;
    this.menu.hide();
    this.last = performance.now();
  }

  cycleCamera() {
    const m = this.renderer.cycleCamera();
    this.settings.camera = m;
    storage.set('settings', this.settings);
    const names = { chase: '추격 카메라', far: '먼 추격 카메라', cockpit: '콕핏 카메라', tcam: 'T-캠' };
    this.hud.message(names[m], '', 1.0);
  }

  finishQuali() {
    const S = this.S;
    if (!S || S.mode !== 'quali') return;
    const w = this.weekend;
    // 예선 중 보여준 순위와 같은 AI 기록을 사용
    const ai = this.qualiAI(S);
    const list = ai.concat([{ id: PLAYER_ID, code: S.player.driver.code, time: S.player.bestLap ?? Infinity, player: true }]).sort((a, b) => a.time - b.time);
    w.grid = list.map((r) => r.id);
    this.state = 'interlude';
    this.hud.show(false);
    document.getElementById('touch').hidden = true;
    this.menu.state = { compound: w.compound };
    this.menu.show('grid', { list, track: S.track, teamId: w.teamId, compound: w.compound });
  }

  finishRace() {
    const S = this.S;
    const res = S.results();
    const w = this.weekend;
    if (w && w.career && this.career) {
      const c = this.career;
      for (const r of res) {
        const code = r.car.driver.id;
        c.points[code] = (c.points[code] || 0) + r.points;
        c.teamPoints[r.car.team.id] = (c.teamPoints[r.car.team.id] || 0) + r.points;
      }
      const me = res.find((r) => r.car.isPlayer);
      c.results.push({ track: S.track.id, pos: me.pos, points: me.points, best: me.car.bestLap });
      c.round++;
      storage.set('career', c);
    }
    this.state = 'interlude';
    this.hud.show(false);
    document.getElementById('touch').hidden = true;
    this.menu.show('results', { res, S, career: !!(w && w.career) });
    this.releaseWakeLock();
  }

  checkRotate() {
    const el = document.getElementById('rotate');
    el.hidden = !(this.touch && this.state === 'race' && window.innerHeight > window.innerWidth && !this.rotateDismissed);
  }

  async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      this.wakeLock = null;
    }
  }

  releaseWakeLock() {
    try {
      if (this.wakeLock) this.wakeLock.release();
    } catch (e) {
      /* 무시 */
    }
    this.wakeLock = null;
  }

  // ---------------------------------------------------------------------------
  handleEvents(S) {
    const hud = this.hud;
    const snd = this.sound;
    const P = S.player;
    for (const e of S.events) {
      switch (e.type) {
        case 'lightsStart':
          hud.setLights(0);
          break;
        case 'light':
          hud.setLights(e.n);
          snd.beep(620, 0.2, 0.22);
          break;
        case 'go':
          hud.lightsOut();
          hud.message('GO!', '', 1.2, 3);
          snd.beep(1240, 0.4, 0.28);
          break;
        case 'sector':
          hud.sector(e.k, e.color);
          break;
        case 'lapTime': {
          const col = !e.valid ? '무효' : e.overall ? '전체 최고 기록' : e.pb ? '개인 최고 기록' : '';
          hud.message(fmtTime(e.time), col, 2.4, 2);
          if (e.valid && e.overall) snd.beep(990, 0.15, 0.2);
          if (S.mode === 'tt' && e.valid) this.saveGhost(e.time);
          if (S.mode === 'quali' && S.qualiLaps >= 3) this.qualiEndTimer = 2.5;
          break;
        }
        case 'lap':
          hud.message(`LAP ${e.lap}/${S.laps}`, '', 1.4, 1);
          break;
        case 'finalLap':
          hud.message('파이널 랩', '', 2, 2);
          break;
        case 'position':
          if (S.t - this.lastPosMsg > 1.5) {
            this.lastPosMsg = S.t;
            hud.message(`P${e.pos}`, e.gained ? '순위 상승' : '순위 하락', 1.1, 0);
          }
          break;
        case 'drsAvail':
          if (!P.drsOpen) hud.message('DRS', this.touch ? 'DRS 버튼을 누르세요' : 'Space로 열기', 1.2, 1);
          snd.beep(1500, 0.08, 0.15, 'square');
          break;
        case 'impact':
          snd.thud(Math.min(3, e.v / 12));
          this.renderer.shake = Math.min(1.2, e.v / 15);
          this.renderer.sparks(e.car, Math.min(40, 6 + e.v * 2));
          if (navigator.vibrate && this.touch) navigator.vibrate(Math.min(120, e.v * 8));
          break;
        case 'carHit':
          snd.thud(Math.min(2, e.v / 8));
          this.renderer.shake = Math.min(0.8, e.v / 10);
          this.renderer.sparks(e.car, 8);
          break;
        case 'checkered':
          if (!e.car.isPlayer) hud.message('체커기', `${e.car.driver.name} 우승 · 이번 랩이 마지막`, 2.4, 2);
          break;
        case 'finish': {
          const pos = S.results().find((r) => r.car.isPlayer).pos;
          hud.message(pos === 1 ? '우승!' : `P${pos} 피니시`, '체커기', 3.5, 3);
          this.finishTimer = 4.5;
          break;
        }
        case 'fastestOther':
          hud.message('최고 랩', `${e.car.driver.code} ${fmtTime(e.time)}`, 1.6, 0);
          break;
        case 'invalid':
          hud.message('트랙 이탈', '이번 랩 기록은 무효', 1.6, 1);
          break;
        case 'penalty':
          hud.message(`+${e.sec}초 페널티`, e.reason, 2.2, 2);
          break;
        case 'upshift':
        case 'downshift':
          snd.shift();
          break;
      }
    }
    S.events.length = 0;
  }

  saveGhost(time) {
    const S = this.S;
    const best = storage.get('tt.' + S.track.id, null);
    if (best && best.time <= time) return;
    const data = { time, team: S.player.team.id, ghost: this.prevRec || [] };
    storage.set('tt.' + S.track.id, data);
    if (best) this.hud.message(fmtTime(time), `베스트 경신 (-${(best.time - time).toFixed(3)})`, 2.6, 3);
    this.ghost = data;
    this.renderer.setGhost(S.player.team);
  }

  recordGhost(S) {
    const P = S.player;
    if (P.lap !== this.recLap) {
      this.prevRec = this.rec;
      this.rec = [];
      this.recLap = P.lap;
    }
    if (P.lap < 1) return;
    const tl = S.t - P.lapStart;
    const k = Math.floor(tl / 0.1);
    if (k >= this.rec.length) this.rec.push([Math.round(P.x * 10) / 10, Math.round(P.z * 10) / 10, Math.round(P.h * 1000) / 1000]);
    // 고스트 재생
    if (this.ghost && this.ghost.ghost.length > 2) {
      const g = this.ghost.ghost;
      const f = tl / 0.1;
      const i = Math.min(g.length - 2, Math.floor(f));
      const a = g[i];
      const b = g[i + 1];
      const t = Math.min(1, f - i);
      let dh = b[2] - a[2];
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      const pos = { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, h: a[2] + dh * t };
      this.renderer.updateGhost(pos);
      this.hud.ghost = pos;
    } else {
      this.renderer.updateGhost(null);
      this.hud.ghost = null;
    }
  }

  qualiAI(S) {
    if (!this.qualiRef || this.qualiRef.S !== S) {
      const w = this.weekend;
      this.qualiRef = { S, list: simulateQuali(S.track, w ? w.difficulty : 1, S.player.team.id, S.player.driver.code, null).filter((r) => !r.player) };
    }
    return this.qualiRef.list;
  }

  qualiRank(S) {
    const t = S.player.bestLap;
    if (t == null) return null;
    return this.qualiAI(S).filter((r) => r.time < t).length + 1;
  }

  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const R = this.renderer;
    if (this.state === 'race' && this.S) {
      const S = this.S;
      const ctl = this.input.poll(dt);
      if (this.touchPress.drs) ctl.drsPress = true;
      this.touchPress = {};
      if (ctl.pausePress) this.paused ? this.resume() : this.pause();
      if (ctl.camPress) this.cycleCamera();
      if (ctl.mutePress) {
        this.settings.sound = !this.settings.sound;
        this.saveSettings();
        this.hud.message(this.settings.sound ? '소리 켬' : '소리 끔', '', 1);
      }
      if (ctl.linePress) {
        const order = ['brake', 'full', 'off'];
        this.settings.racingLine = order[(order.indexOf(this.settings.racingLine) + 1) % 3];
        this.saveSettings();
        this.hud.message('레이싱 라인', { brake: '코너만', full: '전체', off: '끔' }[this.settings.racingLine], 1);
      }
      if (!this.paused) {
        if (ctl.quitPress && S.mode === 'quali') this.finishQuali();
        if (ctl.resetPress) this.resetCar(S);
        for (let k = 0; k < (this.timeScale || 1); k++) S.update(dt, ctl);
        this.handleEvents(S);
        if (S.mode === 'tt') this.recordGhost(S);
        if (this.finishTimer > 0) {
          this.finishTimer -= dt;
          if (this.finishTimer <= 0) this.finishRace();
        }
        if (this.qualiEndTimer > 0) {
          this.qualiEndTimer -= dt;
          if (this.qualiEndTimer <= 0) this.finishQuali();
        }
        // 선두가 끝났는데 오래 멈춰 있으면 강제 종료
        if (S.mode === 'race' && S.checkered && !S.player.finished) {
          this.stuckTimer = (this.stuckTimer || 0) + dt;
          if (this.stuckTimer > 60) this.finishRace();
        } else this.stuckTimer = 0;
      }
      if (this.state === 'race') {
        R.updateCars(dt, S);
        R.setLights(S.lights);
        R.updateCamera(dt, S.player);
        R.updateRacingLine(S.player, this.settings.racingLine);
        this.hud.update(dt, S, R, { camMode: R.camMode, qualiRank: S.mode === 'quali' ? this.qualiRank(S) : null });
      }
      this.sound.update(S, S.player, !this.paused && this.state === 'race');
    } else if (this.state === 'interlude' && this.S) {
      const P = this.S.player;
      if (!this.paused) this.S.update(dt, { steer: 0, throttle: 0, brake: 0 });
      this.S.events.length = 0;
      R.updateCars(dt, this.S);
      R.updateOrbit(dt, P);
      R.updateRacingLine(null, 'off');
      this.sound.update(null, null, false);
    } else {
      if (R.showcaseCar) {
        R.updateCars(dt, null);
        R.updateOrbit(dt, R.showcaseCar);
      }
      this.sound.update(null, null, false);
    }
    R.render(dt);
    requestAnimationFrame((t) => this.loop(t));
  }

  resetCar(S) {
    const P = S.player;
    if (P.auto) return;
    if (S.mode === 'tt' || S.mode === 'quali') {
      if (S.mode === 'quali') return;
      S.resetFlying(P);
      this.hud.message('리셋', '', 0.8);
      return;
    }
    const loc = S.track.locate(P.x, P.z, P.ti);
    const d = Math.max(-S.track.half + 1.5, Math.min(S.track.half - 1.5, loc.d));
    const p = S.track.pointAt(loc.s, d);
    P.x = p.x;
    P.z = p.z;
    P.h = S.track.head[loc.i];
    P.v = 0;
    P.vlat = 0;
    this.hud.message('트랙 복귀', '', 0.8);
  }

  // 자동 테스트: ?autotest=1&track=albion&mode=race&laps=2
  autotest(params) {
    const trackId = params.get('track') || 'albion';
    const mode = params.get('mode') || 'race';
    if (params.get('cam')) this.settings.camera = params.get('cam');
    this.timeScale = +(params.get('ts') || 1);
    if (params.get('quality')) this.settings.quality = params.get('quality');
    this.applySettings();
    this.weekend = { trackId, teamId: 'taurus', compound: 'S', career: false, laps: +(params.get('laps') || 2), difficulty: 1 };
    const codes = DRIVERS.filter((d) => d.code !== 'ORT').map((d) => d.code);
    codes.splice(+(params.get('grid') || 6), 0, PLAYER_ID);
    this.startSession({ trackId, mode, teamId: 'taurus', grid: codes, laps: this.weekend.laps, difficulty: 1, compound: 'S', auto: params.get('auto') !== '0' });
    window.__app = this;
  }
}

try {
  window.__app = new App();
} catch (e) {
  const el = document.getElementById('loading');
  el.hidden = false;
  el.textContent = '게임을 시작할 수 없어요: ' + e.message;
  console.error(e);
}
