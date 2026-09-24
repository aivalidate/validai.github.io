// 레이스 HUD (RR3 스타일): 순위·랩, 근접 순위표, 랩 타임과 구간 차이, 미니맵, 속도계, 메시지, 이름표

import { fmtTime, fmtGap, clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const ARC_LEN = Math.PI * 77;

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      pos: $('h-pos'),
      posLabel: $('h-poslabel'),
      lap: $('h-lap'),
      lapLabel: $('h-laplabel'),
      tower: $('tower'),
      cur: $('h-cur'),
      best: $('h-best'),
      split: $('split'),
      sectors: [...document.querySelectorAll('#sectors i')],
      spd: $('h-spd'),
      gear: $('h-gear'),
      arc: $('h-arc'),
      leds: $('h-leds'),
      drs: $('h-drs'),
      msg: $('msg'),
      msgBig: document.querySelector('#msg .big'),
      msgSmall: document.querySelector('#msg .small'),
      lights: $('lights'),
      lightCols: [...document.querySelectorAll('#lights .col')],
      intro: $('intro'),
      introS: $('intro-s'),
      introB: $('intro-b'),
      introT: $('intro-t'),
      tags: $('tags'),
      hint: $('hint'),
      mini: $('minimap'),
    };
    this.el.leds.innerHTML = '<i></i>'.repeat(15);
    this.ledEls = [...this.el.leds.children];
    this.el.arc.style.strokeDasharray = `0 ${ARC_LEN}`;
    this.cache = {};
    this.msgTimer = 0;
    this.msgQueue = [];
    this.towerTimer = 0;
    this.splitTimer = 0;
    this.tagEls = [];
  }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  show(on) {
    this.root.hidden = !on;
  }

  start(S, track, intro = null) {
    this.S = S;
    this.track = track;
    this.cache = {};
    this.msgQueue = [];
    this.msgTimer = 0;
    this.el.msg.style.opacity = 0;
    this.el.sectors.forEach((s) => (s.className = ''));
    this.el.split.className = 'num';
    this.bestCum = null;
    this.curCum = [];
    this.el.lights.hidden = true;
    this.el.lightCols.forEach((c) => c.classList.remove('lit'));
    this.el.posLabel.textContent = S.mode === 'race' ? 'POS' : S.mode === 'quali' ? 'QUALI' : 'TIME TRIAL';
    this.el.lapLabel.textContent = S.mode === 'quali' ? 'RUN' : 'LAP';
    this.el.intro.hidden = !intro;
    if (intro) {
      this.el.introS.textContent = intro.eyebrow;
      this.el.introB.textContent = intro.title;
      this.el.introT.textContent = intro.text;
    }
    this.prepMinimap(track);
    const tips = {
      race: 'A 가속 · F 브레이크 · ←→ 조향 · Space DRS · C 카메라 · Esc 일시정지',
      quali: 'A 가속 · F 브레이크 · ←→ 조향 · 3번의 플라잉 랩 중 최고 기록으로 그리드 결정 · Q 예선 종료',
      tt: 'A 가속 · F 브레이크 · ←→ 조향 · 코스를 벗어나면 랩 무효 · R 리셋 · Esc 일시정지',
    };
    this.el.hint.textContent = tips[S.mode];
    this.el.hint.hidden = !!window.matchMedia('(pointer: coarse)').matches;
    this.hintTimer = 12;
  }

  hideIntro() {
    this.el.intro.hidden = true;
  }

  prepMinimap(track) {
    const c = this.el.mini;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth || 170;
    const h = c.clientHeight || 130;
    c.width = w * dpr;
    c.height = h * dpr;
    const b = track.bounds;
    const pad = 8;
    const sc = Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxZ - b.minZ));
    const ox = (w - (b.maxX - b.minX) * sc) / 2;
    const oy = (h - (b.maxZ - b.minZ) * sc) / 2;
    this.mm = { sc, ox, oy, b, dpr, w, h };
    const base = document.createElement('canvas');
    base.width = c.width;
    base.height = c.height;
    const g = base.getContext('2d');
    g.scale(dpr, dpr);
    const X = (x) => ox + (x - b.minX) * sc;
    const Y = (z) => oy + (z - b.minZ) * sc;
    g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i <= track.N; i += 2) {
      const k = i % track.N;
      i ? g.lineTo(X(track.px[k]), Y(track.pz[k])) : g.moveTo(X(track.px[k]), Y(track.pz[k]));
    }
    g.closePath();
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.lineWidth = 7;
    g.stroke();
    g.strokeStyle = 'rgba(240,244,248,0.92)';
    g.lineWidth = 3;
    g.stroke();
    const p = track.pointAt(0, 0);
    g.fillStyle = '#1bb4ff';
    g.fillRect(X(p.x) - 3, Y(p.z) - 3, 6, 6);
    this.mmBase = base;
  }

  drawMinimap(S) {
    const c = this.el.mini;
    const g = c.getContext('2d');
    const { sc, ox, oy, b, dpr } = this.mm;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(this.mmBase, 0, 0);
    g.scale(dpr, dpr);
    const X = (x) => ox + (x - b.minX) * sc;
    const Y = (z) => oy + (z - b.minZ) * sc;
    for (const car of S.cars) {
      if (car.isPlayer) continue;
      g.fillStyle = car.team.color;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(X(car.x), Y(car.z), 3, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (this.ghost) {
      g.fillStyle = 'rgba(160,210,255,0.85)';
      g.beginPath();
      g.arc(X(this.ghost.x), Y(this.ghost.z), 3.5, 0, Math.PI * 2);
      g.fill();
    }
    const P = S.player;
    g.fillStyle = '#1bb4ff';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(X(P.x), Y(P.z), 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  towerRows(S) {
    const P = S.player;
    if (S.mode !== 'race') {
      const rows = [];
      rows.push(`<div class="head">${S.mode === 'quali' ? '예선 기록' : '랩 기록'}</div>`);
      const laps = P.lapTimes;
      laps.slice(-5).forEach((l, k) => {
        const n = laps.length - Math.min(5, laps.length) + k + 1;
        const best = l.valid && l.time === P.bestLap;
        rows.push(`<div class="row${best ? ' me' : ''}"><span class="p num">${n}</span><span class="c" style="background:${l.valid ? (best ? 'var(--purple)' : 'var(--green)') : 'var(--red)'}"></span><span class="n num">${fmtTime(l.time)}</span><span class="g">${l.valid ? '' : '무효'}</span></div>`);
      });
      if (!laps.length) rows.push('<div class="tnote">출발선을 지나면 기록이 시작됩니다</div>');
      if (S.mode === 'quali') rows.push(`<div class="tnote">남은 시도 ${Math.max(0, 3 - S.qualiLaps)}회 · 예상 그리드 ${this.qualiRank ? 'P' + this.qualiRank : '-'}</div>`);
      return rows.join('');
    }
    // RR3처럼 선두 + 내 주변 차량만
    const list = S.order;
    const pi = list.indexOf(P);
    const set = new Set([0]);
    for (let k = pi - 2; k <= pi + 2; k++) if (k >= 0 && k < list.length) set.add(k);
    for (let k = 1; set.size < 6 && k < list.length; k++) set.add(k);
    const idx = [...set].sort((a, b) => a - b);
    return idx
      .map((k) => {
        const c = list[k];
        let g = '';
        if (k === 0) g = S.t > 0 ? 'LEADER' : '';
        else if (c.finished) g = 'FIN';
        else if (c.lapsDown > 0 && list[0].lap - c.lap >= 1) g = `+${c.lapsDown}L`;
        else if (S.t > 3) g = c === P ? fmtGap(c.gap) : fmtGap(c.gap - P.gap);
        return `<div class="row${c.isPlayer ? ' me' : ''}"><span class="p num">${k + 1}</span><span class="c" style="background:${c.team.color}"></span><span class="n">${c.driver.code}</span><span class="g num">${g}</span></div>`;
      })
      .join('');
  }

  message(big, small = '', dur = 2.2, priority = 0) {
    if (this.msgTimer > 0 && priority < this.msgPriority) {
      this.msgQueue.push([big, small, dur, priority]);
      return;
    }
    this.msgPriority = priority;
    this.msgTimer = dur;
    this.el.msgBig.textContent = big;
    this.el.msgSmall.textContent = small;
    this.el.msg.style.opacity = 1;
    this.el.msg.classList.remove('show');
    void this.el.msg.offsetWidth;
    this.el.msg.classList.add('show');
  }

  setLights(n) {
    this.el.lights.hidden = false;
    this.el.lights.classList.add('on');
    this.el.lightCols.forEach((c, k) => c.classList.toggle('lit', k < n));
  }

  lightsOut() {
    this.el.lightCols.forEach((c) => c.classList.remove('lit'));
    setTimeout(() => (this.el.lights.hidden = true), 1200);
  }

  showSplit(delta) {
    const el = this.el.split;
    el.textContent = (delta < 0 ? '-' : '+') + Math.abs(delta).toFixed(3);
    el.className = 'num show ' + (delta < 0 ? 'faster' : 'slower');
    this.splitTimer = 3;
  }

  // 구간 통과: 베스트 랩 대비 누적 차이 표시
  sector(k, color, lapTimeSoFar) {
    if (k === 0) this.el.sectors.forEach((s, i) => i > 0 && (s.className = ''));
    this.el.sectors[k].className = color;
    if (lapTimeSoFar != null) {
      this.curCum[k] = lapTimeSoFar;
      if (this.bestCum && this.bestCum[k] != null) this.showSplit(lapTimeSoFar - this.bestCum[k]);
    }
  }

  lapDone(time, valid, prevBest) {
    if (prevBest != null) this.showSplit(time - prevBest);
    if (valid && (prevBest == null || time < prevBest)) this.bestCum = this.curCum.slice();
    this.curCum = [];
  }

  update(dt, S, renderer, extra = {}) {
    const P = S.player;
    const el = this.el;
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) {
        el.msg.style.opacity = 0;
        if (this.msgQueue.length) this.message(...this.msgQueue.shift());
      }
    }
    if (this.splitTimer > 0) {
      this.splitTimer -= dt;
      if (this.splitTimer <= 0) el.split.classList.remove('show');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) el.hint.hidden = true;
    }

    if (S.mode === 'race') {
      this.set('pos', el.pos, `${P.pos}<span>/${S.cars.length}</span>`, 'innerHTML');
      this.set('lap', el.lap, `${Math.max(1, Math.min(P.lap, S.laps))}/${S.laps}`);
    } else {
      const rank = extra.qualiRank;
      this.qualiRank = rank;
      this.set('pos', el.pos, rank ? `${rank}<span>/20</span>` : '–', 'innerHTML');
      this.set('lap', el.lap, S.mode === 'quali' ? `${Math.min(3, S.qualiLaps + (P.lap >= 1 ? 1 : 0))}/3` : `${Math.max(1, P.lap)}`);
    }

    const cur = P.lap >= 1 && S.phase === 'green' ? S.t - P.lapStart : 0;
    this.set('cur', el.cur, fmtTime(cur));
    el.cur.classList.toggle('invalid', !P.lapValid && P.lap >= 1);
    this.set('best', el.best, fmtTime(P.bestLap));

    const kmh = Math.round(Math.abs(P.v) * 3.6);
    this.set('spd', el.spd, String(kmh));
    this.set('gear', el.gear, P.v < -0.5 ? 'R' : P.v < 0.5 && !P.revving ? 'N' : String(P.gear));
    const frac = clamp(kmh / 360, 0, 1);
    const arcKey = Math.round(frac * 200);
    if (this.cache.arc !== arcKey) {
      this.cache.arc = arcKey;
      el.arc.style.strokeDasharray = `${(ARC_LEN * arcKey) / 200} ${ARC_LEN}`;
    }
    const rpm = Math.max(P.rpm, P.revving ? 6000 + P.revving * 5500 : 0);
    const lit = Math.round(clamp((rpm - 7000) / 5000, 0, 1) * 15);
    const ledKey = lit + (lit >= 15 && performance.now() % 160 < 80 ? 'x' : '');
    if (this.cache.led !== ledKey) {
      this.cache.led = ledKey;
      el.arc.classList.toggle('hot', lit >= 14);
      this.ledEls.forEach((l, k) => {
        let cls = '';
        if (k < lit) cls = k < 5 ? 'g' : k < 10 ? 'r' : 'b';
        if (ledKey.endsWith('x')) cls = '';
        l.className = cls;
      });
    }

    let drs = 'off';
    if (P.drsOpen) drs = 'open';
    else if (P.drsAvail) drs = 'avail';
    else if (P.drsEligible && S.mode === 'race') drs = 'armed';
    if (this.cache.drs !== drs) {
      this.cache.drs = drs;
      el.drs.className = 'hb chip' + (drs === 'open' ? ' on' : drs === 'avail' ? ' warn' : '');
      el.drs.innerHTML = drs === 'open' ? 'DRS <small>열림</small>' : drs === 'avail' ? 'DRS <small>사용 가능</small>' : drs === 'armed' ? 'DRS <small>1초 이내</small>' : 'DRS';
    }

    this.towerTimer -= dt;
    if (this.towerTimer <= 0) {
      this.towerTimer = 0.25;
      const html = this.towerRows(S);
      if (this.cache.tower !== html) {
        this.cache.tower = html;
        el.tower.innerHTML = html;
      }
    }
    this.drawMinimap(S);
    this.updateTags(S, renderer);
  }

  updateTags(S, renderer) {
    const P = S.player;
    const near = [];
    if (S.mode === 'race' && renderer.camMode !== 'cockpit') {
      for (const c of S.cars) {
        if (c === P) continue;
        const d = Math.hypot(c.x - P.x, c.z - P.z);
        if (d < 70) near.push([d, c]);
      }
      near.sort((a, b) => a[0] - b[0]);
    }
    const show = near.slice(0, 4);
    while (this.tagEls.length < show.length) {
      const t = document.createElement('div');
      t.className = 'tag num';
      this.el.tags.appendChild(t);
      this.tagEls.push(t);
    }
    this.tagEls.forEach((t, k) => {
      const item = show[k];
      if (!item) {
        t.style.display = 'none';
        return;
      }
      const c = item[1];
      const p = renderer.project(c.x, 1.9, c.z);
      if (!p || p.x < -50 || p.x > window.innerWidth + 50) {
        t.style.display = 'none';
        return;
      }
      t.style.display = 'block';
      t.style.left = p.x + 'px';
      t.style.top = p.y + 'px';
      t.style.opacity = clamp(1.4 - item[0] / 60, 0.2, 1);
      const txt = `${c.pos} ${c.driver.code}`;
      if (t.textContent !== txt) t.textContent = txt;
      t.style.borderLeftColor = c.team.color;
    });
  }
}
