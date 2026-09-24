// 레이스 HUD: 순위, 랩, 타이밍 타워, 미니맵, 속도계, 타이어, 메시지, 이름표

import { fmtTime, fmtGap, clamp } from './util.js';
import { COMPOUNDS } from './data.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      pos: $('h-pos'),
      of: $('h-of'),
      lap: $('h-lap'),
      lapLabel: $('h-laplabel'),
      tower: $('tower'),
      cur: $('h-cur'),
      last: $('h-last'),
      best: $('h-best'),
      sectors: [...document.querySelectorAll('#sectors i')],
      spd: $('h-spd'),
      gear: $('h-gear'),
      leds: $('h-leds'),
      drs: $('h-drs'),
      msg: $('msg'),
      msgBig: document.querySelector('#msg .big'),
      msgSmall: document.querySelector('#msg .small'),
      lights: $('lights'),
      lightCols: [...document.querySelectorAll('#lights .col')],
      tags: $('tags'),
      hint: $('hint'),
      mini: $('minimap'),
    };
    this.el.leds.innerHTML = '<i></i>'.repeat(15);
    this.ledEls = [...this.el.leds.children];
    this.cache = {};
    this.msgTimer = 0;
    this.msgQueue = [];
    this.towerTimer = 0;
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

  start(S, track) {
    this.S = S;
    this.track = track;
    this.cache = {};
    this.msgQueue = [];
    this.msgTimer = 0;
    this.el.msg.style.opacity = 0;
    this.el.sectors.forEach((s) => (s.className = ''));
    this.el.lights.hidden = S.mode !== 'race';
    this.el.lightCols.forEach((c) => c.classList.remove('lit'));
    this.el.lapLabel.textContent = S.mode === 'race' ? 'LAP' : S.mode === 'quali' ? 'QUALI' : 'TIME TRIAL';
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

  prepMinimap(track) {
    const c = this.el.mini;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth || 190;
    const h = c.clientHeight || 150;
    c.width = w * dpr;
    c.height = h * dpr;
    const b = track.bounds;
    const pad = 10;
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
    g.strokeStyle = 'rgba(8,10,14,0.85)';
    g.lineWidth = 7;
    g.stroke();
    g.strokeStyle = 'rgba(235,240,245,0.9)';
    g.lineWidth = 3;
    g.stroke();
    // 출발선
    const p = track.pointAt(0, 0);
    g.fillStyle = '#fff';
    g.fillRect(X(p.x) - 3, Y(p.z) - 3, 6, 6);
    // DRS 구간
    g.strokeStyle = 'rgba(49,209,108,0.9)';
    g.lineWidth = 3;
    for (const z of track.drs) {
      g.beginPath();
      let s = z.start;
      const e = z.end < z.start ? z.end + track.L : z.end;
      for (; s <= e; s += 6) {
        const q = track.pointAt(s, 0);
        s === z.start ? g.moveTo(X(q.x), Y(q.z)) : g.lineTo(X(q.x), Y(q.z));
      }
      g.stroke();
    }
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
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(X(car.x), Y(car.z), 3.2, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (this.ghost) {
      g.fillStyle = 'rgba(160,200,255,0.8)';
      g.beginPath();
      g.arc(X(this.ghost.x), Y(this.ghost.z), 3.5, 0, Math.PI * 2);
      g.fill();
    }
    const P = S.player;
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(X(P.x), Y(P.z), 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  towerRows(S) {
    const P = S.player;
    const narrow = window.innerWidth < 760;
    if (S.mode !== 'race') {
      const rows = [];
      rows.push(`<div class="head">${S.mode === 'quali' ? '예선' : '타임 트라이얼'}</div>`);
      const laps = P.lapTimes;
      laps.slice(-6).forEach((l, k) => {
        const n = laps.length - Math.min(6, laps.length) + k + 1;
        const best = l.valid && l.time === P.bestLap;
        rows.push(`<div class="row${best ? ' me' : ''}"><span class="p num">${n}</span><span class="c" style="background:${l.valid ? (best ? 'var(--purple)' : 'var(--green)') : 'var(--red)'}"></span><span class="n num">${fmtTime(l.time)}</span><span class="g">${l.valid ? '' : '무효'}</span></div>`);
      });
      if (!laps.length) rows.push('<div class="tnote">출발선을 지나면 기록이 시작됩니다</div>');
      if (S.mode === 'quali') rows.push(`<div class="tnote">남은 시도 ${Math.max(0, 3 - S.qualiLaps)}회 · 예선 순위 ${this.qualiRank ? 'P' + this.qualiRank : '-'}</div>`);
      return rows.join('');
    }
    let list = S.order;
    let idx = list.map((c, k) => k);
    if (narrow) {
      const pi = list.indexOf(P);
      const set = new Set([0, pi - 1, pi, pi + 1, pi + 2].filter((k) => k >= 0 && k < list.length));
      if (set.size < 5) for (let k = 0; set.size < 5 && k < list.length; k++) set.add(k);
      idx = [...set].sort((a, b) => a - b);
    }
    return idx
      .map((k) => {
        const c = list[k];
        let g = '';
        if (k === 0) g = S.t > 0 ? '리더' : '';
        else if (c.finished) g = '완주';
        else if (c.lapsDown > 0 && list[0].lap - c.lap >= 1 && c.lapsDown >= 1) g = `+${c.lapsDown}랩`;
        else g = S.t > 3 ? fmtGap(c.gap) : '';
        const pit = '';
        return `<div class="row${c.isPlayer ? ' me' : ''}"><span class="p num">${k + 1}</span><span class="c" style="background:${c.team.color}"></span><span class="n">${c.driver.code}${pit}</span><span class="g num">${g}</span></div>`;
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

  sector(k, color) {
    if (k === 0) this.el.sectors.forEach((s, i) => i > 0 && (s.className = ''));
    this.el.sectors[k].className = color;
  }

  update(dt, S, renderer, extra = {}) {
    const P = S.player;
    const el = this.el;
    // 메시지
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) {
        el.msg.style.opacity = 0;
        if (this.msgQueue.length) this.message(...this.msgQueue.shift());
      }
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) el.hint.hidden = true;
    }

    if (S.mode === 'race') {
      this.set('pos', el.pos, 'P' + P.pos);
      this.set('of', el.of, '/' + S.cars.length);
      this.set('lap', el.lap, `${Math.max(1, Math.min(P.lap, S.laps))}/${S.laps}`);
    } else {
      const rank = extra.qualiRank;
      this.qualiRank = rank;
      this.set('pos', el.pos, rank ? 'P' + rank : '—');
      this.set('of', el.of, rank ? '/20' : '');
      this.set('lap', el.lap, S.mode === 'quali' ? `${Math.min(3, S.qualiLaps + (P.lap >= 1 ? 1 : 0))}/3` : `${Math.max(1, P.lap)}`);
    }

    const cur = P.lap >= 1 && S.phase === 'green' ? S.t - P.lapStart : 0;
    this.set('cur', el.cur, fmtTime(cur));
    el.cur.classList.toggle('invalid', !P.lapValid && P.lap >= 1);
    this.set('last', el.last, fmtTime(P.lastLap));
    this.set('best', el.best, fmtTime(P.bestLap));

    const kmh = Math.round(Math.abs(P.v) * 3.6);
    this.set('spd', el.spd, String(kmh));
    this.set('gear', el.gear, P.v < -0.5 ? 'R' : P.v < 0.5 && !P.revving ? 'N' : String(P.gear));
    // 시프트 라이트
    const rpm = Math.max(P.rpm, P.revving ? 6000 + P.revving * 5500 : 0);
    const lit = Math.round(clamp((rpm - 7000) / 5000, 0, 1) * 15);
    const ledKey = lit + (lit >= 15 && performance.now() % 160 < 80 ? 'x' : '');
    if (this.cache.led !== ledKey) {
      this.cache.led = ledKey;
      this.ledEls.forEach((l, k) => {
        let cls = '';
        if (k < lit) cls = k < 5 ? 'g' : k < 10 ? 'r' : 'b';
        if (ledKey.endsWith('x')) cls = '';
        l.className = cls;
      });
    }

    // DRS
    let drs = 'off';
    if (P.drsOpen) drs = 'open';
    else if (P.drsAvail) drs = 'avail';
    else if (P.drsEligible && S.mode === 'race') drs = 'armed';
    if (this.cache.drs !== drs) {
      this.cache.drs = drs;
      el.drs.className = 'hud-box chip' + (drs === 'open' ? ' on' : drs === 'avail' ? ' warn' : '');
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
    this.updateTags(S, renderer, extra.camMode);
  }

  updateTags(S, renderer, camMode) {
    const P = S.player;
    const near = [];
    if (S.mode === 'race') {
      for (const c of S.cars) {
        if (c === P) continue;
        const d = Math.hypot(c.x - P.x, c.z - P.z);
        if (d < 70) near.push([d, c]);
      }
      near.sort((a, b) => a[0] - b[0]);
    }
    const show = near.slice(0, 5);
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
      const txt = `P${c.pos} ${c.driver.code}`;
      if (t.textContent !== txt) t.textContent = txt;
      t.style.borderLeftColor = c.team.color;
    });
  }
}
