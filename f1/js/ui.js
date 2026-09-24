// 메뉴 화면 (RR3 스타일): 홈 카드, 커리어 이벤트, 차고 업그레이드, 퀵 레이스, 타임 트라이얼, 설정, 결과·보상

import { TEAMS, DRIVERS, DIFFICULTY, LAP_OPTIONS, UPGRADES, UPGRADE_COST, MAX_UPGRADE, teamById, carPR, recommendedPR, fameForLevel } from './data.js';
import { TRACKS } from './tracks.js';
import { fmtTime, storage } from './util.js';
import { PLAYER_ID } from './race.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => 'R$ ' + Math.round(n).toLocaleString('en-US');

const seg = (id, options, value) =>
  `<div class="seg" role="group" data-seg="${id}">${options
    .map(([v, label]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${label}</button>`)
    .join('')}</div>`;

export function prizeFor(pos, laps, career) {
  const base = (8000 + laps * 2200) * (career ? 1.5 : 1);
  const f = [1, 0.8, 0.68, 0.58, 0.5, 0.44, 0.38, 0.33, 0.28, 0.24][pos - 1] ?? 0.16;
  return Math.round((base * f) / 100) * 100;
}

export class Menu {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('menu');
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.state = {};
  }

  hide() {
    this.el.hidden = true;
    this.el.innerHTML = '';
  }

  show(name, data = {}) {
    const inRace = this.app.state !== 'menu';
    this.name = name;
    this.data = data;
    this.el.hidden = false;
    this.el.className = inRace || ['pause', 'results', 'grid', 'season'].includes(name) ? 'dim' : name === 'home' ? 'home' : 'side';
    if (!inRace) this.app.setBackdrop(name === 'home' ? 'home' : 'side', this.previewTeam(name));
    this.el.innerHTML = this[name](data);
    this.el.scrollTop = 0;
    this.afterRender();
    const first = this.el.querySelector('.btn.primary, .card, .mbtn, button');
    if (first && !('ontouchstart' in window)) first.focus({ preventScroll: true });
  }

  // 화면마다 쇼룸에 보여줄 팀
  previewTeam(name) {
    const app = this.app;
    if (name === 'garage') return this.state.garageTeam || app.profile.team;
    if (name.startsWith('career') && app.career) return app.career.team;
    if (name === 'careerNew') return this.state.team || app.profile.team;
    return app.profile.team;
  }

  refresh() {
    const y = this.el.scrollTop;
    const rails = [...this.el.querySelectorAll('.rail, .events, .teams')].map((r) => r.scrollLeft);
    this.el.innerHTML = this[this.name](this.data);
    this.afterRender();
    this.el.scrollTop = y;
    this.el.querySelectorAll('.rail, .events, .teams').forEach((r, k) => (r.scrollLeft = rails[k] || 0));
  }

  afterRender() {
    this.el.querySelectorAll('canvas[data-outline]').forEach((c) => drawOutline(c, this.app.getTrack(c.dataset.outline)));
    this.el.querySelectorAll('canvas[data-icon]').forEach((c) => drawIcon(c, c.dataset.icon));
    this.el.querySelectorAll('input[data-bind]').forEach((inp) => {
      inp.addEventListener('input', () => (this.state[inp.dataset.bind] = inp.value));
    });
    const fb = this.el.querySelector('.fame-bar i[data-to]');
    if (fb) requestAnimationFrame(() => requestAnimationFrame(() => (fb.style.width = fb.dataset.to)));
  }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b || !this.el.contains(b)) return;
    this.app.sound.init();
    this.app.sound.click();
    const segEl = b.closest('[data-seg]');
    if (segEl) {
      this.setValue(segEl.dataset.seg, b.dataset.v);
      segEl.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (['laps', 'difficulty'].includes(segEl.dataset.seg) && this.name === 'quick') this.refresh();
      return;
    }
    if (b.dataset.track) {
      this.state.track = b.dataset.track;
      this.refresh();
      return;
    }
    if (b.dataset.team) {
      if (this.name === 'garage') this.state.garageTeam = b.dataset.team;
      else this.state.team = b.dataset.team;
      this.app.setBackdrop('side', b.dataset.team);
      this.refresh();
      return;
    }
    if (b.dataset.round != null) {
      this.state.round = +b.dataset.round;
      this.refresh();
      return;
    }
    if (b.dataset.up) {
      this.app.buyUpgrade(this.state.garageTeam || this.app.profile.team, b.dataset.up);
      this.refresh();
      return;
    }
    if (b.dataset.act) this.action(b.dataset.act, b);
  }

  setValue(key, v) {
    const s = this.app.settings;
    const num = (x) => (isNaN(+x) ? x : +x);
    if (key in s) {
      s[key] = v === 'true' ? true : v === 'false' ? false : num(v);
      this.app.saveSettings();
    } else this.state[key] = num(v);
  }

  action(act, b) {
    const app = this.app;
    const st = this.state;
    switch (act) {
      case 'home':
        app.toMenu();
        break;
      case 'career':
        this.state = { round: app.career ? app.career.round : 0 };
        app.career ? this.show('career') : this.show('careerNew');
        break;
      case 'quick':
        this.state = { track: st.track || 'albion', quali: 1 };
        this.show('quick');
        break;
      case 'tt':
        this.state = { track: st.track || 'albion' };
        this.show('timetrial');
        break;
      case 'garage':
        this.state = { garageTeam: app.profile.team };
        this.show('garage');
        break;
      case 'settings':
        this.show('settings', { from: this.name });
        break;
      case 'help':
        this.show('help', { from: this.name });
        break;
      case 'back':
        if (this.data.from === 'pause') this.show('pause');
        else app.toMenu();
        break;
      case 'useTeam':
        app.profile.team = st.garageTeam;
        app.saveProfile();
        app.toast(`${teamById(st.garageTeam).name} 머신으로 레이스에 나갑니다`);
        this.refresh();
        break;
      case 'startQuick':
        app.startWeekend({ trackId: st.track, teamId: app.profile.team, quali: !!st.quali, career: false });
        break;
      case 'startTT':
        app.startSession({ trackId: st.track, mode: 'tt', teamId: app.profile.team });
        break;
      case 'newCareer': {
        const name = (st.name ?? app.profile.name ?? '').trim().slice(0, 14) || '플레이어';
        const code = ((st.code ?? app.profile.code ?? '').replace(/[^a-zA-Z]/g, '').toUpperCase() + 'XXX').slice(0, 3);
        const team = st.team || app.profile.team;
        app.profile = { ...app.profile, name, code, team };
        app.saveProfile();
        app.newCareer(team);
        this.state = { round: 0 };
        this.show('career');
        break;
      }
      case 'careerQuali':
        app.startWeekend({ trackId: app.career.calendar[app.career.round], teamId: app.career.team, quali: true, career: true });
        break;
      case 'careerSkip':
        app.startWeekend({ trackId: app.career.calendar[app.career.round], teamId: app.career.team, quali: false, career: true });
        break;
      case 'careerDelete':
        if (b.dataset.confirm) {
          app.deleteCareer();
          app.toMenu();
        } else {
          b.dataset.confirm = '1';
          b.textContent = '한 번 더 누르면 삭제됩니다';
        }
        break;
      case 'startRace':
        app.startRaceFromGrid();
        break;
      case 'resume':
        app.resume();
        break;
      case 'restart':
        app.restart();
        break;
      case 'quit':
        if (b.dataset.confirm) app.toMenu();
        else {
          b.dataset.confirm = '1';
          b.querySelector('b').textContent = '정말 나갈까요? 한 번 더 누르세요';
        }
        break;
      case 'endQuali':
        app.finishQuali();
        break;
      case 'resultsNext':
        if (this.data.career) {
          if (app.career && app.career.round >= app.career.calendar.length) this.show('season');
          else app.toMenu('career');
        } else app.toMenu();
        break;
      case 'again':
        app.restart();
        break;
      case 'tilt':
        app.enableTilt();
        break;
      case 'calibrate':
        app.input.calibrateTilt();
        app.toast('현재 기울기를 중앙으로 설정했어요');
        break;
      case 'fullscreen':
        app.toggleFullscreen();
        break;
      case 'resetBest':
        storage.remove('tt.' + st.track);
        this.refresh();
        break;
    }
  }

  // ---------------------------------------------------------------------------
  topbar(title, back = true) {
    const w = this.app.wallet;
    const lvStart = w.level > 1 ? fameForLevel(w.level - 1) : 0;
    const prog = Math.min(1, (w.fame - lvStart) / (fameForLevel(w.level) - lvStart));
    return `<div class="topbar">
      <div class="title">${back ? '<button type="button" class="backbtn" data-act="back" aria-label="뒤로">‹</button>' : ''}${title ? `<b>${title}</b>` : '<span class="logo">FORMULA <em>GP</em></span>'}</div>
      <div class="wallet">
        <div class="pill-stat lvl"><span class="ic lv">${w.level}</span><span class="fame"><i style="width:${Math.round(prog * 100)}%"></i></span></div>
        <div class="pill-stat"><span class="ic rs">R$</span>${Math.round(w.money).toLocaleString('en-US')}</div>
        <div class="pill-stat"><span class="ic gd">G</span>${w.gold}</div>
      </div>
    </div>`;
  }

  home() {
    const app = this.app;
    const c = app.career;
    const nextT = c && c.round < c.calendar.length ? TRACKS.find((t) => t.id === c.calendar[c.round]) : null;
    const team = teamById(app.profile.team);
    const pr = carPR(team, app.upgradesFor(team.id));
    const ttBest = TRACKS.filter((t) => storage.get('tt.' + t.id, null)).length;
    const myPos = c ? standings(c).findIndex((d) => d.id === PLAYER_ID) + 1 : 0;
    return `${this.topbar('', false)}
    <div class="page home-page">
      <div><h1 class="hero-title">FORMULA<br><em>GP</em></h1><p class="hero-sub">1000마력 머신 20대가 달리는 그랑프리. 예선으로 그리드를 정하고, 슬립스트림과 DRS로 추월하세요.</p></div>
      <div class="rail">
        <button type="button" class="card primary" data-act="career"><div class="art"><canvas data-${nextT ? 'outline="' + nextT.id + '"' : 'icon="trophy"'}></canvas><span class="badge">CAREER</span></div><div class="body"><b>월드 챔피언십</b><span>${c ? (nextT ? `라운드 ${c.round + 1}/${c.calendar.length} · ${esc(nextT.name)}${c.round ? ` · 순위 P${myPos}` : ''}` : '시즌 종료 · 결과 보기') : '6라운드 시즌, 드라이버 챔피언을 노려라'}</span><div class="prog"><i style="width:${c ? Math.round((c.round / c.calendar.length) * 100) : 0}%"></i></div></div></button>
        <button type="button" class="card" data-act="quick"><div class="art"><canvas data-icon="flag"></canvas><span class="badge">RACE</span></div><div class="body"><b>퀵 레이스</b><span>서킷과 랩 수를 골라 바로 출발</span></div></button>
        <button type="button" class="card" data-act="garage"><div class="art"><canvas data-icon="car" style="--c:${team.color}"></canvas><span class="badge">GARAGE</span></div><div class="body"><b>차고</b><span>${esc(team.name)} · PR ${pr}</span></div></button>
        <button type="button" class="card" data-act="tt"><div class="art"><canvas data-icon="watch"></canvas><span class="badge">TIME</span></div><div class="body"><b>타임 트라이얼</b><span>${ttBest ? `기록 보유 서킷 ${ttBest}곳` : '고스트와 함께 베스트 랩 도전'}</span></div></button>
        <button type="button" class="card small" data-act="settings"><div class="art"><canvas data-icon="gear"></canvas></div><div class="body"><b>설정</b><span>조작 · 보조 · 그래픽</span></div></button>
        <button type="button" class="card small" data-act="help"><div class="art"><canvas data-icon="pad"></canvas></div><div class="body"><b>조작법</b><span>키보드 · 휴대폰</span></div></button>
      </div>
      <p class="note">비공식 팬메이드 게임입니다. 팀, 드라이버, 서킷, 스폰서는 모두 가상입니다.</p>
    </div>`;
  }

  carSummary(teamId, difficulty) {
    const team = teamById(teamId);
    const pr = carPR(team, this.app.upgradesFor(teamId));
    const rec = recommendedPR(difficulty);
    return `<div class="panel accent">
      <h3>내 머신</h3>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
        <div><b class="it" style="font-size:24px">${esc(team.name)}</b><div class="note">권장 PR ${rec}${pr >= rec ? ' · 충분해요' : ' · 차고에서 업그레이드하면 유리해요'}</div></div>
        <div class="pr"><small>PR</small><b style="color:${pr >= rec ? 'var(--accent)' : 'var(--yellow)'}">${pr}</b></div>
      </div>
    </div>`;
  }

  quick() {
    const st = this.state;
    const s = this.app.settings;
    const t = TRACKS.find((x) => x.id === st.track);
    return `${this.topbar('퀵 레이스')}
    <div class="page">
      <div class="field"><h3>서킷</h3><div class="rail">${TRACKS.map((x) => `<button type="button" class="tsel" data-track="${x.id}" aria-pressed="${x.id === st.track}"><canvas data-outline="${x.id}"></canvas><b>${esc(x.name)}</b><span>${esc(x.place)}</span></button>`).join('')}</div></div>
      <div class="two-col">
        <div class="panel">
          <p class="sub">${esc(t.blurb)}</p>
          <div class="field"><h3>랩 수</h3>${seg('laps', LAP_OPTIONS.map((l) => [l, l + '랩']), s.laps)}</div>
          <div class="field"><h3>AI 난이도</h3>${seg('difficulty', DIFFICULTY.map((d) => [d.id, d.name]), s.difficulty)}</div>
          <div class="field"><h3>예선</h3>${seg('quali', [[1, '예선 후 결승'], [0, '바로 결승']], st.quali)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${this.carSummary(this.app.profile.team, s.difficulty)}
          <div class="panel"><h3>상금</h3>${prizeTable(s.laps, false)}</div>
          <div class="row-btns"><button type="button" class="btn primary" data-act="startQuick">레이스 시작</button><button type="button" class="btn" data-act="garage">차고</button></div>
        </div>
      </div>
    </div>`;
  }

  timetrial() {
    const st = this.state;
    const best = storage.get('tt.' + st.track, null);
    return `${this.topbar('타임 트라이얼')}
    <div class="page">
      <p class="sub">혼자서 플라잉 랩을 반복합니다. 베스트 랩을 세우면 다음부터 고스트 카가 함께 달리고, 기록을 경신할 때마다 R$ 3,000을 받습니다.</p>
      <div class="rail">${TRACKS.map((t) => {
        const b = storage.get('tt.' + t.id, null);
        return `<button type="button" class="tsel" data-track="${t.id}" aria-pressed="${t.id === st.track}"><canvas data-outline="${t.id}"></canvas><b>${esc(t.name)}</b><span class="meta"><span>BEST</span><span>${b ? fmtTime(b.time) : '--:--.---'}</span></span></button>`;
      }).join('')}</div>
      <div class="stat-row"><div class="stat"><small>나의 베스트</small><b>${best ? fmtTime(best.time) : '--:--.---'}</b></div>${best ? `<div class="stat"><small>머신</small><b style="font-size:22px">${esc((teamById(best.team) || TEAMS[0]).name)}</b></div>` : ''}</div>
      <div class="row-btns"><button type="button" class="btn primary" data-act="startTT">주행 시작</button>${best ? '<button type="button" class="btn" data-act="resetBest">기록 지우기</button>' : ''}</div>
    </div>`;
  }

  garage() {
    const app = this.app;
    const teamId = this.state.garageTeam || app.profile.team;
    const team = teamById(teamId);
    const lv = app.upgradesFor(teamId);
    const pr = carPR(team, lv);
    const using = app.profile.team === teamId;
    const careerTeam = app.career && app.career.team === teamId;
    return `${this.topbar('차고')}
    <div class="page half">
      <div class="teams">${TEAMS.map((t) => `<button type="button" class="team-chip" data-team="${t.id}" aria-pressed="${t.id === teamId}"><i style="background:linear-gradient(${t.color} 60%, ${t.accent} 60%)"></i>${esc(t.short)} <small>${carPR(t, app.upgradesFor(t.id))}</small></button>`).join('')}</div>
      <div class="panel accent">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
          <div><h3>${using ? '퀵 레이스 · 타임 트라이얼 머신' : '보관 중인 머신'}${careerTeam ? ' · 커리어 소속팀' : ''}</h3><b class="it" style="font-size:30px;line-height:1">${esc(team.name)}</b></div>
          <div class="pr"><small>PR</small><b>${pr}</b></div>
        </div>
        ${using ? '' : '<div class="row-btns"><button type="button" class="btn" data-act="useTeam">이 머신으로 달리기</button></div>'}
      </div>
      <div class="panel">
        <h3>업그레이드</h3>
        ${UPGRADES.map((u) => {
          const l = lv[u.id] || 0;
          const max = l >= MAX_UPGRADE;
          const cost = max ? 0 : UPGRADE_COST[l];
          const afford = app.wallet.money >= cost;
          return `<div class="upg"><div><b>${u.name}</b><span> · ${u.desc}</span></div>${max ? '<span class="pill" style="background:var(--accent);color:var(--accent-ink)">MAX</span>' : `<button type="button" class="btn ${afford ? 'primary' : ''} buy" data-up="${u.id}" ${afford ? '' : 'disabled'}>${money(cost)}</button>`}<div class="pips">${Array.from({ length: MAX_UPGRADE }, (_, k) => `<i class="${k < l ? 'on' : ''}"></i>`).join('')}</div></div>`;
        }).join('')}
        <p class="note">업그레이드는 팀 머신마다 따로 저장됩니다. 레이스 상금으로 R$를 모으세요.</p>
      </div>
    </div>`;
  }

  careerNew() {
    const p = this.app.profile;
    this.state = { name: p.name, code: p.code, team: this.state.team || p.team };
    const st = this.state;
    return `${this.topbar('새 커리어')}
    <div class="page half">
      <p class="sub">6개 라운드로 이루어진 시즌입니다. 각 그랑프리는 예선과 결승으로 진행되고, 결승 순위에 따라 포인트(25-18-15-12-10-8-6-4-2-1)와 커리어 상금(1.5배)을 받습니다.</p>
      <div class="inputs">
        <label class="field"><h3>드라이버 이름</h3><input class="input" id="c-name" data-bind="name" maxlength="14" value="${esc(p.name)}" autocomplete="off"></label>
        <label class="field"><h3>약칭</h3><input class="input" id="c-code" data-bind="code" maxlength="3" value="${esc(p.code)}" autocomplete="off" style="text-transform:uppercase"></label>
      </div>
      <div class="field"><h3>소속 팀</h3><div class="teams" style="flex-wrap:wrap">${TEAMS.map((t) => `<button type="button" class="team-chip" data-team="${t.id}" aria-pressed="${t.id === st.team}"><i style="background:linear-gradient(${t.color} 60%, ${t.accent} 60%)"></i>${esc(t.name)} <small>PR ${carPR(t, this.app.upgradesFor(t.id))}</small></button>`).join('')}</div></div>
      <div class="field"><h3>AI 난이도</h3>${seg('difficulty', DIFFICULTY.map((d) => [d.id, d.name]), this.app.settings.difficulty)}</div>
      <div class="field"><h3>결승 랩 수</h3>${seg('laps', LAP_OPTIONS.map((l) => [l, l + '랩']), this.app.settings.laps)}</div>
      <div class="row-btns"><button type="button" class="btn primary" data-act="newCareer">시즌 시작</button></div>
    </div>`;
  }

  career() {
    const app = this.app;
    const c = app.career;
    if (!c) return this.careerNew();
    const team = teamById(c.team);
    const drivers = standings(c);
    const myPos = drivers.findIndex((d) => d.id === PLAYER_ID) + 1;
    const sel = Math.min(this.state.round ?? c.round, c.calendar.length - 1);
    const t = TRACKS.find((x) => x.id === c.calendar[sel]);
    const res = c.results[sel];
    const isNext = sel === c.round;
    const trophy = (r) => (r ? `<span class="trophy t${r.pos <= 3 ? r.pos : 0}">${r.pos}</span>` : '');
    return `${this.topbar('월드 챔피언십')}
    <div class="page">
      <div class="stat-row">
        <div class="stat"><small>팀</small><b style="font-size:22px">${esc(team.name)}</b></div>
        <div class="stat"><small>챔피언십</small><b>${c.round ? 'P' + myPos : '—'}</b></div>
        <div class="stat"><small>포인트</small><b>${c.points[PLAYER_ID] || 0}</b></div>
        <div class="stat"><small>우승 · 포디움</small><b>${c.results.filter((r) => r.pos === 1).length} · ${c.results.filter((r) => r.pos <= 3).length}</b></div>
      </div>
      <div class="events">${c.calendar
        .map((id, k) => {
          const tr = TRACKS.find((x) => x.id === id);
          const r = c.results[k];
          const locked = k > c.round;
          return `<button type="button" class="ev${locked ? ' locked' : ''}" data-round="${k}" aria-pressed="${k === sel}"><canvas data-outline="${id}"></canvas>${trophy(r)}<div class="body"><small>ROUND ${k + 1}</small><b>${esc(tr.name)}</b><span>${r ? `결승 P${r.pos} · +${r.points}점` : k === c.round ? '다음 경기' : locked ? '잠김' : ''}</span></div></button>`;
        })
        .join('')}</div>
      <div class="two-col">
        <div class="panel accent">
          <h3>ROUND ${sel + 1} · ${esc(t.place)}</h3>
          <b class="it" style="font-size:34px;line-height:1">${esc(t.name)}</b>
          <p class="sub">${esc(t.blurb)}</p>
          <p class="note">결승 ${c.laps}랩 · AI ${DIFFICULTY[c.difficulty].name} · 권장 PR ${recommendedPR(c.difficulty)} · 내 PR ${carPR(team, app.upgradesFor(team.id))}</p>
          ${prizeTable(c.laps, true)}
          ${
            res
              ? `<p class="sub">이미 완료한 라운드입니다 · 결승 P${res.pos}${res.best ? ` · 베스트 랩 ${fmtTime(res.best)}` : ''}</p>`
              : isNext
                ? '<div class="row-btns"><button type="button" class="btn primary" data-act="careerQuali">레이스 주말 시작</button><button type="button" class="btn" data-act="careerSkip">바로 결승 (맨 뒤 출발)</button></div>'
                : '<p class="sub">앞선 라운드를 마치면 열립니다.</p>'
          }
          ${c.round >= c.calendar.length ? '<div class="row-btns"><button type="button" class="btn primary" data-act="resultsNext">시즌 결과</button></div>' : ''}
        </div>
        <div class="panel">
          <h3>드라이버 순위</h3>
          <div class="table-wrap"><table><tbody>${drivers
            .slice(0, 10)
            .concat(myPos > 10 ? [drivers[myPos - 1]] : [])
            .map((d) => `<tr class="${d.id === PLAYER_ID ? 'me' : ''}"><td class="n">${drivers.indexOf(d) + 1}</td><td><span class="sw" style="background:${teamById(d.team).color}"></span>${esc(d.name)}</td><td class="n">${d.pts}</td></tr>`)
            .join('')}</tbody></table></div>
          <div class="row-btns"><button type="button" class="btn" data-act="garage">차고</button><button type="button" class="btn" data-act="careerDelete">커리어 삭제</button></div>
        </div>
      </div>
    </div>`;
  }

  season() {
    const c = this.app.career;
    const drivers = standings(c);
    const champ = drivers[0];
    const me = drivers.findIndex((d) => d.id === PLAYER_ID) + 1;
    return `<div class="page narrow">
      <h3>시즌 종료</h3>
      <div class="big-pos">P${me}</div>
      <h2 class="head">${me === 1 ? '월드 챔피언!' : `챔피언십 ${me}위`}</h2>
      <p class="sub">${me === 1 ? `${esc(c.name)} 선수가 ${c.points[PLAYER_ID] || 0}점으로 시즌 챔피언이 되었습니다.` : `챔피언은 ${esc(champ.name)} (${champ.pts}점). 다음 시즌에 다시 도전해 보세요.`}</p>
      <div class="table-wrap"><table><tbody>${drivers
        .slice(0, 10)
        .map((d, k) => `<tr class="${d.id === PLAYER_ID ? 'me' : ''}"><td class="n">${k + 1}</td><td><span class="sw" style="background:${teamById(d.team).color}"></span>${esc(d.name)}</td><td class="n">${d.pts}</td></tr>`)
        .join('')}</tbody></table></div>
      <div class="row-btns"><button type="button" class="btn primary" data-act="careerDelete">새 시즌 준비</button><button type="button" class="btn" data-act="home">홈으로</button></div>
    </div>`;
  }

  settings(data) {
    const s = this.app.settings;
    const touch = this.app.touch;
    const inRace = data.from === 'pause';
    return `${inRace ? '<div class="page narrow"><button type="button" class="btn" data-act="back">‹ 돌아가기</button>' : this.topbar('설정') + '<div class="page narrow">'}
      ${
        touch
          ? `<div class="panel"><h3>휴대폰 조작</h3>
        ${seg('steerMode', [['tilt', '기울기'], ['zones', '화면 좌우 터치'], ['buttons', '버튼']], s.steerMode)}
        <p class="note">기울기: 휴대폰을 핸들처럼 돌려 조향 · 화면 좌우 터치: 왼쪽/오른쪽 절반을 눌러 조향 · 버튼: ◀ ▶ 버튼</p>
        <div class="field"><h3>자동 가속</h3>${seg('autoThrottle', [[true, '켬 (브레이크만)'], [false, '끔 (가속 페달)']], s.autoThrottle)}</div>
        <div class="field"><h3>기울기</h3><div class="row-btns"><button type="button" class="btn" data-act="tilt">센서 허용</button><button type="button" class="btn" data-act="calibrate">지금 자세를 중앙으로</button></div>
        ${seg('tiltInvert', [[false, '기본 방향'], [true, '반대 방향']], s.tiltInvert)}${seg('tiltSens', [[0.7, '둔감'], [1, '보통'], [1.4, '민감']], s.tiltSens)}</div>
        <div class="row-btns"><button type="button" class="btn" data-act="fullscreen">전체 화면</button></div></div>`
          : ''
      }
      <div class="panel"><h3>주행 보조</h3>
        <div class="field"><h3>브레이크 보조</h3>${seg('brakeAssist', [[0, '끔'], [1, '약하게'], [2, '강하게']], s.brakeAssist)}</div>
        <div class="field"><h3>스티어링 보조</h3>${seg('steerAssist', [[false, '끔'], [true, '켬']], s.steerAssist)}</div>
        <div class="field"><h3>레이싱 라인</h3>${seg('racingLine', [['off', '끔'], ['brake', '코너만'], ['full', '전체']], s.racingLine)}</div>
        <div class="field"><h3>DRS</h3>${seg('autoDrs', [[false, '직접 열기'], [true, '자동']], s.autoDrs)}</div>
      </div>
      <div class="panel"><h3>게임</h3>
        <div class="field"><h3>기본 AI 난이도</h3>${seg('difficulty', DIFFICULTY.map((d) => [d.id, d.name]), s.difficulty)}</div>
        <div class="field"><h3>카메라</h3>${seg('camera', [['chase', '추격'], ['far', '먼 추격'], ['bumper', '범퍼'], ['cockpit', '콕핏'], ['tcam', 'T-캠']], s.camera)}</div>
        <div class="field"><h3>그래픽</h3>${seg('quality', [['auto', '자동'], ['low', '낮음'], ['mid', '보통'], ['high', '높음']], s.quality)}<p class="note">자동은 기기 성능에 맞춰 해상도를 조절합니다.</p></div>
        <div class="field"><h3>사운드</h3>${seg('sound', [[true, '켬'], [false, '끔']], s.sound)}</div>
      </div>
    </div>`;
  }

  help(data) {
    const inRace = data.from === 'pause';
    return `${inRace ? '<div class="page narrow"><button type="button" class="btn" data-act="back">‹ 돌아가기</button>' : this.topbar('조작법') + '<div class="page narrow">'}
      <div class="panel"><h3>키보드</h3><div class="keys">
        <kbd>A</kbd><span>가속</span>
        <kbd>F</kbd><span>브레이크 (멈춘 상태에서 계속 누르면 후진)</span>
        <kbd>← →</kbd><span>좌우 조향</span>
        <kbd>Space</kbd><span>DRS 열기 · 닫기 (DRS 구간에서 앞차와 1초 이내일 때)</span>
        <kbd>C</kbd><span>카메라 전환</span>
        <kbd>L</kbd><span>레이싱 라인 표시 전환</span>
        <kbd>R</kbd><span>트랙으로 복귀 (타임 트라이얼은 랩 리셋)</span>
        <kbd>M</kbd><span>음소거</span>
        <kbd>Esc</kbd><span>일시정지</span>
        <kbd>Q</kbd><span>예선 종료</span>
      </div></div>
      <div class="panel"><h3>휴대폰</h3><p class="sub">가로로 들고 플레이하세요. 기본은 자동 가속이라 브레이크 페달만 누르면 되고, 조향은 기울기 · 화면 좌우 터치 · 버튼 중에서 설정에서 고를 수 있어요. 홈 화면에 추가하면 앱처럼 전체 화면으로 실행됩니다.</p></div>
      <div class="panel"><h3>게임패드</h3><div class="keys"><kbd>왼쪽 스틱</kbd><span>조향</span><kbd>RT / LT</kbd><span>가속 / 브레이크</span><kbd>B</kbd><span>DRS</span><kbd>Y</kbd><span>카메라</span><kbd>Start</kbd><span>일시정지</span></div></div>
      <div class="panel"><h3>레이스 팁</h3><p class="sub">출발은 신호등 5개가 모두 켜졌다가 꺼지는 순간입니다. 피트스톱과 타이어 관리는 없으니 달리기에만 집중하세요. 앞차 뒤 45m 안에서는 슬립스트림으로 빨라지고, DRS 구간에서 앞차와 1초 이내면 DRS로 추월할 수 있어요. 벽에 닿지 않고 완주하면 클린 레이스 보너스를 받습니다.</p></div>
    </div>`;
  }

  pause() {
    const S = this.app.S;
    const extra = S && S.mode === 'quali' ? '<button type="button" class="mbtn" data-act="endQuali"><span><b>예선 종료</b><span>지금까지의 베스트 랩으로 그리드 결정</span></span><span class="arrow">›</span></button>' : '';
    return `<div class="page narrow">
      <h2 class="head">일시정지</h2>
      <div class="menu-list">
        <button type="button" class="mbtn primary" data-act="resume"><span><b>계속하기</b></span><span class="arrow">▶</span></button>
        ${extra}
        <button type="button" class="mbtn" data-act="restart"><span><b>다시 시작</b><span>${S && S.mode === 'race' ? '같은 그리드로 결승 재시작' : '세션 재시작'}</span></span><span class="arrow">↺</span></button>
        <button type="button" class="mbtn" data-act="settings"><span><b>설정</b></span><span class="arrow">›</span></button>
        <button type="button" class="mbtn" data-act="help"><span><b>조작법</b></span><span class="arrow">›</span></button>
        <button type="button" class="mbtn" data-act="quit"><span><b>레이스 포기</b><span>이번 세션 기록과 상금은 저장되지 않습니다</span></span><span class="arrow">×</span></button>
      </div>
    </div>`;
  }

  grid(data) {
    const { list, track } = data;
    const me = list.findIndex((r) => r.player) + 1;
    const pole = list[0];
    return `<div class="page">
      <h3>${esc(track.name)} · 예선 결과</h3>
      <div style="display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap"><div class="big-pos">P${me}<span>/20</span></div><h2 class="head">${me === 1 ? '폴 포지션! 보너스 R$ 3,000' : '그리드 확정'}</h2></div>
      <div class="table-wrap"><table><thead><tr><th class="n">#</th><th>드라이버</th><th>팀</th><th class="n">기록</th><th class="n">차이</th></tr></thead><tbody>${list
        .map((r, k) => {
          const d = r.player ? { name: this.app.playerName(), team: data.teamId } : DRIVERS.find((x) => x.code === r.code);
          return `<tr class="${r.player ? 'me' : ''}"><td class="n">${k + 1}</td><td><span class="sw" style="background:${teamById(d.team).color}"></span>${esc(d.name)}</td><td>${esc(teamById(d.team).short)}</td><td class="n">${isFinite(r.time) ? fmtTime(r.time) : '기록 없음'}</td><td class="n">${k && isFinite(r.time) ? '+' + (r.time - pole.time).toFixed(3) : ''}</td></tr>`;
        })
        .join('')}</tbody></table></div>
      <div class="row-btns"><button type="button" class="btn primary" data-act="startRace">결승 시작</button><button type="button" class="btn" data-act="home">홈으로</button></div>
    </div>`;
  }

  results(data) {
    const { res, S, career, rewards } = data;
    const me = res.find((r) => r.car.isPlayer);
    const fl = S.fastest;
    const w = this.app.wallet;
    const lvStart = w.level > 1 ? fameForLevel(w.level - 1) : 0;
    const prog = Math.min(1, (w.fame - lvStart) / (fameForLevel(w.level) - lvStart));
    return `<div class="page">
      <h3>${esc(S.track.name)} · 결승 결과</h3>
      <div style="display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap"><div class="big-pos" style="color:${me.pos === 1 ? 'var(--gold)' : me.pos === 2 ? 'var(--silver)' : me.pos === 3 ? 'var(--bronze)' : 'var(--text)'}">P${me.pos}<span>/${res.length}</span></div><h2 class="head">${me.pos === 1 ? '우승!' : me.pos <= 3 ? '포디움!' : '완주'}</h2></div>
      <div class="two-col">
        <div class="table-wrap"><table><thead><tr><th class="n">#</th><th>드라이버</th><th class="n">기록</th><th class="n">PTS</th></tr></thead><tbody>${res
          .map(
            (r) =>
              `<tr class="${r.car.isPlayer ? 'me' : ''}"><td class="n">${r.pos}</td><td><span class="sw" style="background:${r.car.team.color}"></span>${esc(r.car.driver.name)} ${fl && fl.car === r.car ? '<span class="pill fl">최고 랩</span>' : ''} ${r.car.penalty ? `<span class="pill pen">+${r.car.penalty}초</span>` : ''}</td><td class="n">${r.pos === 1 ? fmtTime(r.total) : r.gapText}</td><td class="n">${r.points || ''}</td></tr>`,
          )
          .join('')}</tbody></table></div>
        <div class="panel accent">
          <h3>레이스 보상</h3>
          <div class="reward">
            ${rewards.items.map((it, k) => `<div class="line" style="animation-delay:${k * 0.12}s"><span>${esc(it.label)}</span><b>${it.money ? '+' + money(it.money) : ''}${it.gold ? ` +${it.gold}G` : ''}</b></div>`).join('')}
            <div class="line total" style="animation-delay:${rewards.items.length * 0.12}s"><span>합계</span><b>${money(rewards.money)}</b></div>
          </div>
          <div class="field"><h3>명성 +${rewards.fame} · 레벨 ${w.level}</h3><div class="fame-bar"><i style="width:${Math.round(rewards.prevProg * 100)}%" data-to="${Math.round(prog * 100)}%"></i></div></div>
          ${rewards.levelUp ? `<div class="levelup">레벨 업! LV ${w.level} · 보너스 +${rewards.levelGold}G</div>` : ''}
          <div class="row-btns">${career ? '<button type="button" class="btn primary" data-act="resultsNext">챔피언십 보기</button>' : '<button type="button" class="btn primary" data-act="resultsNext">계속</button><button type="button" class="btn" data-act="again">다시 달리기</button>'}</div>
        </div>
      </div>
    </div>`;
  }
}

function prizeTable(laps, career) {
  return `<div class="prize">${[1, 2, 3]
    .map((p) => `<div><small style="color:${['var(--gold)', 'var(--silver)', 'var(--bronze)'][p - 1]}">${p}위</small><b>${money(prizeFor(p, laps, career))}</b></div>`)
    .join('')}</div>`;
}

export function standings(c) {
  const list = DRIVERS.map((d) => ({ id: d.code, code: d.code, name: d.name, team: d.team, pts: c.points[d.code] || 0 }));
  const second = DRIVERS.filter((d) => d.team === c.team)[1];
  const i = list.findIndex((d) => d.code === second.code);
  list[i] = { id: PLAYER_ID, code: c.code, name: c.name, team: c.team, pts: c.points[PLAYER_ID] || 0 };
  return list.sort((a, b) => b.pts - a.pts);
}

export function drawOutline(c, t) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth || 160;
  const h = c.clientHeight || 90;
  c.width = w * dpr;
  c.height = h * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const b = t.bounds;
  const pad = 12;
  const sc = Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxZ - b.minZ));
  const ox = (w - (b.maxX - b.minX) * sc) / 2;
  const oy = (h - (b.maxZ - b.minZ) * sc) / 2;
  g.beginPath();
  for (let i = 0; i <= t.N; i += 3) {
    const k = i % t.N;
    const x = ox + (t.px[k] - b.minX) * sc;
    const y = oy + (t.pz[k] - b.minZ) * sc;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 6;
  g.stroke();
  g.strokeStyle = 'rgba(243,246,249,0.95)';
  g.lineWidth = 2.6;
  g.stroke();
  const p = t.pointAt(0, 0);
  g.fillStyle = '#1bb4ff';
  g.fillRect(ox + (p.x - b.minX) * sc - 3.5, oy + (p.z - b.minZ) * sc - 3.5, 7, 7);
}

// 카드용 간단한 아이콘
function drawIcon(c, kind) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth || 200;
  const h = c.clientHeight || 110;
  c.width = w * dpr;
  c.height = h * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const cx = w / 2;
  const cy = h / 2 + 4;
  const s = Math.min(w, h) / 110;
  g.strokeStyle = '#f3f6f9';
  g.fillStyle = '#f3f6f9';
  g.lineWidth = 4 * s;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (kind === 'flag') {
    const q = 11 * s;
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 3; j++) {
        g.fillStyle = (i + j) % 2 ? '#0b1119' : '#f3f6f9';
        g.fillRect(cx - 22 * s + i * q, cy - 24 * s + j * q + Math.sin(i * 0.9) * 4 * s, q, q);
      }
    g.fillStyle = '#f3f6f9';
    g.fillRect(cx - 26 * s, cy - 26 * s, 3 * s, 60 * s);
  } else if (kind === 'watch') {
    g.beginPath();
    g.arc(cx, cy + 4 * s, 28 * s, 0, Math.PI * 2);
    g.stroke();
    g.fillRect(cx - 6 * s, cy - 34 * s, 12 * s, 6 * s);
    g.beginPath();
    g.moveTo(cx, cy + 4 * s);
    g.lineTo(cx + 14 * s, cy - 10 * s);
    g.strokeStyle = '#1bb4ff';
    g.stroke();
  } else if (kind === 'gear') {
    g.beginPath();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const r = (k % 2 ? 20 : 26) * s;
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, 8 * s, 0, Math.PI * 2);
    g.stroke();
  } else if (kind === 'pad') {
    g.beginPath();
    g.moveTo(cx - 20 * s, cy - 18 * s);
    g.lineTo(cx + 20 * s, cy - 18 * s);
    g.arc(cx + 20 * s, cy, 18 * s, -Math.PI / 2, Math.PI / 2);
    g.lineTo(cx - 20 * s, cy + 18 * s);
    g.arc(cx - 20 * s, cy, 18 * s, Math.PI / 2, (Math.PI * 3) / 2);
    g.stroke();
    g.fillRect(cx - 27 * s, cy - 2 * s, 14 * s, 4 * s);
    g.fillRect(cx - 22 * s, cy - 7 * s, 4 * s, 14 * s);
    g.beginPath();
    g.arc(cx + 18 * s, cy - 4 * s, 3.5 * s, 0, Math.PI * 2);
    g.arc(cx + 26 * s, cy + 4 * s, 3.5 * s, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'car') {
    const col = getComputedStyle(c).getPropertyValue('--c').trim() || '#1bb4ff';
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(cx - 50 * s, cy + 6 * s);
    g.lineTo(cx - 40 * s, cy - 8 * s);
    g.lineTo(cx - 6 * s, cy - 12 * s);
    g.lineTo(cx + 4 * s, cy - 20 * s);
    g.lineTo(cx + 12 * s, cy - 10 * s);
    g.lineTo(cx + 52 * s, cy - 2 * s);
    g.lineTo(cx + 52 * s, cy + 6 * s);
    g.closePath();
    g.fill();
    g.fillStyle = '#0b1119';
    g.strokeStyle = '#f3f6f9';
    g.lineWidth = 2 * s;
    for (const x of [-32, 32]) {
      g.beginPath();
      g.arc(cx + x * s, cy + 8 * s, 11 * s, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.fillStyle = '#f3f6f9';
    g.fillRect(cx - 56 * s, cy - 18 * s, 10 * s, 3 * s);
  } else {
    g.beginPath();
    g.moveTo(cx - 18 * s, cy - 26 * s);
    g.lineTo(cx + 18 * s, cy - 26 * s);
    g.quadraticCurveTo(cx + 18 * s, cy + 6 * s, cx, cy + 8 * s);
    g.quadraticCurveTo(cx - 18 * s, cy + 6 * s, cx - 18 * s, cy - 26 * s);
    g.fillStyle = '#f7c548';
    g.fill();
    g.fillRect(cx - 3 * s, cy + 8 * s, 6 * s, 12 * s);
    g.fillRect(cx - 14 * s, cy + 20 * s, 28 * s, 5 * s);
  }
}
