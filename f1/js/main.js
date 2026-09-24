// 게임 진입점: 상태 관리, 메인 루프, 세션 흐름(예선 → 결승 → 결과), 커리어 저장

import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input, isTouch } from './input.js';
import { Sound } from './audio.js';
import { Menu, prizeFor } from './ui.js';
import { TRACKS, buildTrack } from './tracks.js';
import { Session, simulateQuali, PLAYER_ID } from './race.js';
import { TEAMS, DRIVERS, teamById, carBoost, fameForLevel, UPGRADE_COST, MAX_UPGRADE, UPGRADES } from './data.js';
import { storage, fmtTime } from './util.js';

const CALENDAR = ['albion', 'riviera', 'parco', 'sakura', 'maple', 'oasis'];

class App {
  constructor() {
    this.touch = isTouch();
    const defaults = {
      steerMode: this.touch ? 'tilt' : 'keys',
      autoThrottle: this.touch,
      tiltInvert: false,
      tiltSens: 1,
      brakeAssist: 1,
      steerAssist: this.touch,
      racingLine: 'brake',
      autoDrs: this.touch,
      difficulty: 1,
      laps: 5,
      camera: 'chase',
      quality: 'auto',
      sound: true,
    };
    this.settings = { ...defaults, ...storage.get('settings', {}) };
    this.profile = { name: '플레이어', code: 'PLY', team: 'taurus', ...storage.get('profile', {}) };
    this.career = storage.get('career', null);
    this.wallet = { money: 20000, gold: 10, fame: 0, level: 1, ...storage.get('wallet', {}) };
    this.upgrades = storage.get('upgrades', {});
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
    Object.assign(this.input.settings, { steerMode: this.touch ? s.steerMode : 'keys', autoThrottle: this.touch && s.autoThrottle, tiltInvert: s.tiltInvert, tiltSens: s.tiltSens });
    const q = s.quality === 'auto' ? (this.touch ? 'mid' : 'high') : s.quality;
    this.autoQuality = s.quality === 'auto';
    if (this.renderer.quality !== q) this.renderer.setQuality(q);
    this.renderer.camMode = s.camera;
    this.sound.setMuted(!s.sound);
    if (this.S) this.S.opts.assists = { brake: s.brakeAssist, steer: s.steerAssist, autoThrottle: this.touch && s.autoThrottle, autoDrs: s.autoDrs };
  }

  // 메뉴 배경: 차고 쇼룸
  setBackdrop(layout, teamId) {
    if (this.state !== 'menu') return;
    const team = teamById(teamId) || TEAMS[0];
    const R = this.renderer;
    if (R.inShowroom && R.showcaseCar && R.showcaseCar.team === team) R.showroomLayout = layout;
    else R.enterShowroom(team, layout);
  }

  playerName() {
    return this.weekend && this.weekend.career && this.career ? this.career.name : this.profile.name;
  }

  // ---------------------------------------------------------------------------
  // 경제: R$, 골드, 명성, 업그레이드
  saveWallet() {
    storage.set('wallet', this.wallet);
  }

  upgradesFor(teamId) {
    return this.upgrades[teamId] || {};
  }

  buyUpgrade(teamId, id) {
    const lv = { ...this.upgradesFor(teamId) };
    const l = lv[id] || 0;
    if (l >= MAX_UPGRADE) return;
    const cost = UPGRADE_COST[l];
    if (this.wallet.money < cost) {
      this.toast('R$가 부족해요. 레이스에서 상금을 모으세요');
      return;
    }
    this.wallet.money -= cost;
    lv[id] = l + 1;
    this.upgrades[teamId] = lv;
    storage.set('upgrades', this.upgrades);
    this.saveWallet();
    this.sound.beep(1180, 0.12, 0.2);
    this.toast(`${UPGRADES.find((u) => u.id === id).name} ${l + 1}단계 업그레이드 완료`);
  }

  addFame(n) {
    const w = this.wallet;
    const before = w.level;
    w.fame += n;
    let gold = 0;
    while (w.fame >= fameForLevel(w.level)) {
      w.level++;
      gold += 5;
    }
    w.gold += gold;
    return { levelUp: w.level > before, gold };
  }

  fameProgress() {
    const w = this.wallet;
    const lvStart = w.level > 1 ? fameForLevel(w.level - 1) : 0;
    return Math.min(1, (w.fame - lvStart) / (fameForLevel(w.level) - lvStart));
  }

  // RR3처럼 레이스가 끝나면 상금과 명성을 정산
  computeRewards(res, S) {
    const w = this.weekend || {};
    const career = !!w.career;
    const me = res.find((r) => r.car.isPlayer);
    const items = [];
    const prize = prizeFor(me.pos, S.laps, career);
    items.push({ label: `P${me.pos} 상금`, money: prize });
    if (w.pole) items.push({ label: '폴 포지션', money: 3000 });
    if (S.fastest && S.fastest.car === me.car) items.push({ label: '최고 랩', money: 2000 });
    if (this.raceImpacts === 0) items.push({ label: '클린 레이스 (벽 접촉 없음)', money: 2500 });
    const gained = me.car.gridPos - me.pos;
    if (gained > 0) items.push({ label: `추월 ${gained}계단`, money: gained * 400 });
    if (me.pos === 1 && career) items.push({ label: '커리어 우승 보너스', money: 0, gold: 2 });
    const moneySum = items.reduce((a, b) => a + b.money, 0);
    const fame = Math.round((180 + Math.max(0, 21 - me.pos) * 22 + (S.laps - 3) * 25) * (career ? 1.5 : 1));
    const prevProg = this.fameProgress();
    this.wallet.money += moneySum;
    this.wallet.gold += items.reduce((a, b) => a + (b.gold || 0), 0);
    const lv = this.addFame(fame);
    this.saveWallet();
    return { items, money: moneySum, fame, prevProg, levelUp: lv.levelUp, levelGold: lv.gold };
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
  toMenu(screen = 'home') {
    this.state = 'menu';
    this.paused = false;
    this.S = null;
    this.weekend = null;
    this.hud.show(false);
    this.renderer.setGhost(null);
    document.getElementById('touch').hidden = true;
    document.getElementById('rotate').hidden = true;
    this.menu.state = screen === 'career' && this.career ? { round: this.career.round } : {};
    this.menu.show(screen);
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
  }

  deleteCareer() {
    this.career = null;
    storage.remove('career');
  }

  startWeekend({ trackId, teamId, quali, career }) {
    const c = career ? this.career : null;
    this.weekend = {
      trackId,
      teamId,
      career: !!career,
      laps: c ? c.laps : this.settings.laps,
      difficulty: c ? c.difficulty : this.settings.difficulty,
    };
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
      this.startRaceFromGrid();
    }
  }

  startRaceFromGrid() {
    const w = this.weekend;
    this.startSession({
      trackId: w.trackId,
      mode: 'race',
      teamId: w.teamId,
      grid: w.grid,
      laps: w.laps,
      difficulty: w.difficulty,
    });
  }

  startSession(cfg) {
    this.lastCfg = cfg;
    const track = this.getTrack(cfg.trackId);
    if (this.renderer.inShowroom) this.renderer.exitShowroom();
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
      playerBoost: carBoost(this.upgradesFor(cfg.teamId)),
      assists: { brake: s.brakeAssist, steer: s.steerAssist, autoThrottle: this.touch && s.autoThrottle, autoDrs: s.autoDrs },
    });
    if (cfg.auto) S.player.auto = true;
    this.S = S;
    this.renderer.setCars(S.cars, TEAMS);
    this.renderer.camMode = s.camera;
    this.renderer.camPos.set(0, -999, 0);
    this.renderer.camYaw = S.player.h;
    const w = this.weekend;
    const intro =
      cfg.mode === 'race'
        ? { eyebrow: w && w.career ? `ROUND ${this.career.round + 1} · 결승` : '퀵 레이스 · 결승', title: track.name, text: `${S.laps}랩 · ${S.player.pos}번 그리드에서 출발` }
        : null;
    this.hud.start(S, track, intro);
    this.hud.show(true);
    this.raceImpacts = 0;
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
      this.tryFullscreen();
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
    const names = { chase: '추격 카메라', far: '먼 추격 카메라', bumper: '범퍼 카메라', cockpit: '콕핏 카메라', tcam: 'T-캠' };
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
    w.pole = list[0] && list[0].player && isFinite(list[0].time);
    this.state = 'interlude';
    this.hud.show(false);
    document.getElementById('touch').hidden = true;
    this.menu.state = {};
    this.menu.show('grid', { list, track: S.track, teamId: w.teamId });
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
    const rewards = this.computeRewards(res, S);
    this.state = 'interlude';
    this.hud.show(false);
    document.getElementById('touch').hidden = true;
    this.menu.show('results', { res, S, career: !!(w && w.career), rewards });
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
          hud.hideIntro();
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
        case 'sector': {
          const soFar = P.curSectors.slice(0, e.k + 1).reduce((a, b) => a + (b || 0), 0);
          hud.sector(e.k, e.color, P.lap >= 2 || S.mode !== 'race' ? soFar : null);
          break;
        }
        case 'lapTime': {
          const col = !e.valid ? '무효' : e.overall ? '전체 최고 기록' : e.pb ? '개인 최고 기록' : '';
          hud.message(fmtTime(e.time), col, 2.4, 2);
          hud.lapDone(e.time, e.valid, e.prevBest);
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
          this.raceImpacts++;
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
    this.wallet.money += 3000;
    this.addFame(60);
    this.saveWallet();
    this.hud.message(fmtTime(time), best ? `베스트 경신 (-${(best.time - time).toFixed(3)}) · +R$ 3,000` : '첫 기록 · +R$ 3,000', 2.6, 3);
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
        if (S.mode === 'race' && S.phase === 'grid') R.updateIntroCam(dt, S.player, S.phaseTimer);
        else R.updateCamera(dt, S.player);
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
      if (R.inShowroom) R.updateShowroom(dt);
      this.sound.update(null, null, false);
    }
    R.render(dt);
    this.adaptQuality(now);
    requestAnimationFrame((t) => this.loop(t));
  }

  // 프레임이 느리면 해상도를 낮추고, 여유가 있으면 다시 올린다
  adaptQuality(now) {
    if (!this.autoQuality || document.hidden) return;
    this.frames = (this.frames || 0) + 1;
    if (!this.fpsT) this.fpsT = now;
    if (now - this.fpsT < 2000) return;
    const fps = (this.frames * 1000) / (now - this.fpsT);
    this.frames = 0;
    this.fpsT = now;
    const R = this.renderer;
    if (fps < 42 && R.resScale > 0.55) R.setResScale(R.resScale - 0.12);
    else if (fps > 57 && R.resScale < 1) R.setResScale(R.resScale + 0.06);
  }

  tryFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}))
      .catch(() => {});
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.tryFullscreen();
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
    this.weekend = { trackId, teamId: 'taurus', career: false, laps: +(params.get('laps') || 2), difficulty: 1 };
    const codes = DRIVERS.filter((d) => d.code !== 'ORT').map((d) => d.code);
    codes.splice(+(params.get('grid') || 6), 0, PLAYER_ID);
    this.startSession({ trackId, mode, teamId: 'taurus', grid: codes, laps: this.weekend.laps, difficulty: 1, auto: params.get('auto') !== '0' });
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
