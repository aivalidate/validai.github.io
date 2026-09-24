// 메뉴 화면 (메인, 커리어, 퀵 레이스, 타임 트라이얼, 설정, 결과)

import { TEAMS, DRIVERS, DIFFICULTY, COMPOUNDS, LAP_OPTIONS, teamById } from './data.js';
import { TRACKS } from './tracks.js';
import { fmtTime, storage } from './util.js';
import { PLAYER_ID } from './race.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const seg = (id, options, value) =>
  `<div class="seg" role="group" data-seg="${id}">${options
    .map(([v, label]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${label}</button>`)
    .join('')}</div>`;

const trackCard = (t, selected, extra = '') =>
  `<button type="button" class="tcard" data-track="${t.id}" aria-pressed="${selected}"><canvas data-outline="${t.id}"></canvas><b>${esc(t.name)}</b><span>${esc(t.place)}</span>${extra}</button>`;

const teamCard = (t, selected) =>
  `<button type="button" class="team-card" data-team="${t.id}" aria-pressed="${selected}"><span class="bar" style="background:${t.color};box-shadow:inset 0 -40% 0 ${t.accent}"></span><span><b>${esc(t.name)}</b><span>${DRIVERS.filter((d) => d.team === t.id)
    .map((d) => esc(d.name))
    .join(' · ')}</span></span><span class="perf">성능<i><u style="width:${Math.round(((t.perf - 0.955) / 0.045) * 100)}%"></u></i></span></button>`;

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
    this.name = name;
    this.data = data;
    this.el.hidden = false;
    this.el.classList.toggle('dim', ['pause', 'results', 'grid', 'season'].includes(name) || this.app.state !== 'menu');
    const html = this[name](data);
    this.el.innerHTML = html;
    this.el.scrollTop = 0;
    this.afterRender();
    const first = this.el.querySelector('.mbtn, .btn.primary, button');
    if (first && !('ontouchstart' in window)) first.focus({ preventScroll: true });
  }

  afterRender() {
    // 서킷 윤곽 그리기
    this.el.querySelectorAll('canvas[data-outline]').forEach((c) => {
      const t = this.app.getTrack(c.dataset.outline);
      drawOutline(c, t);
    });
    this.el.querySelectorAll('input[data-bind]').forEach((inp) => {
      inp.addEventListener('input', () => {
        this.state[inp.dataset.bind] = inp.value;
      });
    });
  }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b || !this.el.contains(b)) return;
    this.app.sound.init();
    const segEl = b.closest('[data-seg]');
    if (segEl) {
      const key = segEl.dataset.seg;
      this.setValue(key, b.dataset.v);
      segEl.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      return;
    }
    if (b.dataset.track) {
      this.state.track = b.dataset.track;
      this.el.querySelectorAll('[data-track]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (this.name === 'timetrial') this.show('timetrial');
      return;
    }
    if (b.dataset.team) {
      this.state.team = b.dataset.team;
      this.el.querySelectorAll('[data-team]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      this.app.previewTeam(b.dataset.team);
      return;
    }
    if (b.dataset.cmp) {
      this.state.compound = b.dataset.cmp;
      this.el.querySelectorAll('[data-cmp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      return;
    }
    const act = b.dataset.act;
    if (act) this.action(act, b);
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
      case 'career':
        app.career ? this.show('careerHub') : this.show('careerNew');
        break;
      case 'quick':
        this.state = { track: st.track || 'albion', team: app.profile.team, quali: 1, compound: 'M' };
        this.show('quick');
        break;
      case 'tt':
        this.state = { track: st.track || 'albion' };
        this.show('timetrial');
        break;
      case 'settings':
        this.show('settings', { from: this.name });
        break;
      case 'help':
        this.show('help', { from: this.name });
        break;
      case 'back':
        this.show(this.data.from === 'pause' ? 'pause' : 'main');
        break;
      case 'main':
        app.toMenu();
        break;
      case 'startQuick':
        app.profile.team = st.team;
        app.saveProfile();
        app.startWeekend({ trackId: st.track, teamId: st.team, quali: !!st.quali, compound: st.compound || 'M', career: false });
        break;
      case 'startTT':
        app.startSession({ trackId: st.track, mode: 'tt', teamId: app.profile.team });
        break;
      case 'newCareer': {
        const name = (st.name || app.profile.name || '').trim().slice(0, 14) || '플레이어';
        const code = ((st.code || app.profile.code || '').replace(/[^a-zA-Z]/g, '').toUpperCase() + 'XXX').slice(0, 3);
        const team = st.team || app.profile.team;
        app.profile = { ...app.profile, name, code, team };
        app.saveProfile();
        app.newCareer(team);
        this.show('careerHub');
        break;
      }
      case 'careerQuali':
        app.startWeekend({ trackId: app.career.calendar[app.career.round], teamId: app.career.team, quali: true, compound: st.compound || 'M', career: true });
        break;
      case 'careerSkip':
        app.startWeekend({ trackId: app.career.calendar[app.career.round], teamId: app.career.team, quali: false, compound: st.compound || 'M', career: true });
        break;
      case 'careerDelete':
        if (b.dataset.confirm) {
          app.deleteCareer();
          this.show('main');
        } else {
          b.dataset.confirm = '1';
          b.textContent = '한 번 더 누르면 삭제됩니다';
        }
        break;
      case 'startRace':
        app.startRaceFromGrid(st.compound || 'M');
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
          else this.show('careerHub');
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
      case 'resetBest':
        storage.remove('tt.' + st.track);
        this.show('timetrial');
        break;
    }
  }

  // ---------------------------------------------------------------------------
  main() {
    const c = this.app.career;
    const nextT = c && c.round < c.calendar.length ? TRACKS.find((t) => t.id === c.calendar[c.round]) : null;
    return `<div class="screen">
      <div class="brand"><span class="eyebrow">OPEN-WHEEL GRAND PRIX</span><h1>FORMULA<br><em>GP</em></h1>
      <p>1000마력 머신으로 20대가 달리는 그랑프리. 예선으로 그리드를 정하고, 타이어 전략과 피트스톱, DRS로 결승을 풀어가세요.</p></div>
      <div class="menu-list">
        <button type="button" class="mbtn primary" data-act="career"><span><b>커리어 시즌</b><span>${c ? (nextT ? `라운드 ${c.round + 1}/${c.calendar.length} · ${esc(nextT.name)} · ${c.points[PLAYER_ID] || 0}점` : '시즌 종료 · 결과 보기') : '6개 그랑프리, 드라이버 챔피언십에 도전'}</span></span><span class="arrow">→</span></button>
        <button type="button" class="mbtn" data-act="quick"><span><b>퀵 레이스</b><span>서킷, 팀, 랩 수를 골라 바로 레이스</span></span><span class="arrow">→</span></button>
        <button type="button" class="mbtn" data-act="tt"><span><b>타임 트라이얼</b><span>혼자 달리며 베스트 랩과 고스트에 도전</span></span><span class="arrow">→</span></button>
        <button type="button" class="mbtn" data-act="settings"><span><b>설정</b><span>조작 방식, 주행 보조, 난이도, 그래픽</span></span><span class="arrow">→</span></button>
        <button type="button" class="mbtn" data-act="help"><span><b>조작법</b><span>키보드 · 터치 · 게임패드</span></span><span class="arrow">→</span></button>
      </div>
      <p class="note">비공식 팬메이드 게임입니다. 등장하는 팀, 드라이버, 서킷, 스폰서는 모두 가상입니다.</p>
    </div>`;
  }

  quick() {
    const st = this.state;
    const s = this.app.settings;
    return `<div class="screen wide">
      <button type="button" class="back" data-act="main">← 메인</button>
      <h2>퀵 레이스</h2>
      <div class="field"><h3>서킷</h3><div class="grid-cards">${TRACKS.map((t) => trackCard(t, t.id === st.track)).join('')}</div></div>
      <div class="field"><h3>팀</h3><div class="grid-cards" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${TEAMS.map((t) => teamCard(t, t.id === st.team)).join('')}</div></div>
      <div class="field"><h3>랩 수</h3>${seg('laps', LAP_OPTIONS.map((l) => [l, l + '랩']), s.laps)}</div>
      <div class="field"><h3>AI 난이도</h3>${seg('difficulty', DIFFICULTY.map((d) => [d.id, d.name]), s.difficulty)}</div>
      <div class="field"><h3>예선</h3>${seg('quali', [[1, '예선 진행'], [0, '건너뛰기 (무작위 그리드)']], st.quali)}</div>
      <div class="field"><h3>출발 타이어</h3>${compoundPicker(st.compound)}<p class="note">5랩 이상 결승에서는 두 종류 이상의 타이어를 써야 합니다(설정에서 끌 수 있음). 어기면 10초 페널티.</p></div>
      <div class="row-btns"><button type="button" class="btn primary" data-act="startQuick">레이스 주말 시작</button></div>
    </div>`;
  }

  timetrial() {
    const st = this.state;
    const best = storage.get('tt.' + st.track, null);
    return `<div class="screen wide">
      <button type="button" class="back" data-act="main">← 메인</button>
      <h2>타임 트라이얼</h2>
      <p class="sub">혼자서 플라잉 랩을 반복합니다. 베스트 랩을 세우면 다음부터 고스트 카가 함께 달립니다.</p>
      <div class="grid-cards">${TRACKS.map((t) => {
        const b = storage.get('tt.' + t.id, null);
        return trackCard(t, t.id === st.track, `<span class="meta"><span>베스트</span><span>${b ? fmtTime(b.time) : '--:--.---'}</span></span>`);
      }).join('')}</div>
      <div class="stat-row"><div class="stat"><small>나의 베스트</small><b>${best ? fmtTime(best.time) : '--:--.---'}</b></div>${best ? `<div class="stat"><small>팀</small><b style="font-size:20px">${esc((teamById(best.team) || TEAMS[0]).name)}</b></div>` : ''}</div>
      <div class="row-btns"><button type="button" class="btn primary" data-act="startTT">주행 시작</button>${best ? '<button type="button" class="btn ghost" data-act="resetBest">기록 지우기</button>' : ''}</div>
    </div>`;
  }

  careerNew() {
    const p = this.app.profile;
    this.state = { name: p.name, code: p.code, team: p.team };
    return `<div class="screen wide">
      <button type="button" class="back" data-act="main">← 메인</button>
      <h2>새 커리어</h2>
      <p class="sub">6개 라운드로 이루어진 시즌입니다. 각 그랑프리는 예선과 결승으로 진행되고, 결승 순위에 따라 포인트(25-18-15-12-10-8-6-4-2-1)를 받습니다.</p>
      <div class="two">
        <label class="field"><h3>드라이버 이름</h3><input class="input" id="c-name" data-bind="name" maxlength="14" value="${esc(p.name)}" autocomplete="off"></label>
        <label class="field"><h3>약칭 (3글자)</h3><input class="input" id="c-code" data-bind="code" maxlength="3" value="${esc(p.code)}" autocomplete="off" style="text-transform:uppercase"></label>
      </div>
      <div class="field"><h3>소속 팀</h3><div class="grid-cards" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${TEAMS.map((t) => teamCard(t, t.id === p.team)).join('')}</div>
      <p class="note">팀마다 머신 성능이 다릅니다. 하위 팀으로 우승하면 그만큼 값진 결과죠.</p></div>
      <div class="field"><h3>AI 난이도</h3>${seg('difficulty', DIFFICULTY.map((d) => [d.id, d.name]), this.app.settings.difficulty)}</div>
      <div class="field"><h3>결승 랩 수</h3>${seg('laps', LAP_OPTIONS.map((l) => [l, l + '랩']), this.app.settings.laps)}</div>
      <div class="row-btns"><button type="button" class="btn primary" data-act="newCareer">시즌 시작</button></div>
    </div>`;
  }

  careerHub() {
    const c = this.app.career;
    if (!c) return this.careerNew();
    const team = teamById(c.team);
    const next = c.round < c.calendar.length ? TRACKS.find((t) => t.id === c.calendar[c.round]) : null;
    const drivers = standings(c);
    const myPos = drivers.findIndex((d) => d.id === PLAYER_ID) + 1;
    const teamsTbl = Object.entries(c.teamPoints)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    this.state.compound = this.state.compound || 'M';
    return `<div class="screen wide">
      <button type="button" class="back" data-act="main">← 메인</button>
      <div><h3>${esc(team.name)} · ${esc(c.name)}</h3><h2>${next ? `라운드 ${c.round + 1} · ${esc(next.name)}` : '시즌 종료'}</h2></div>
      <div class="stat-row">
        <div class="stat"><small>챔피언십 순위</small><b>${c.round ? 'P' + myPos : '—'}</b></div>
        <div class="stat"><small>포인트</small><b>${c.points[PLAYER_ID] || 0}</b></div>
        <div class="stat"><small>우승</small><b>${c.results.filter((r) => r.pos === 1).length}</b></div>
        <div class="stat"><small>포디움</small><b>${c.results.filter((r) => r.pos <= 3).length}</b></div>
      </div>
      ${
        next
          ? `<div class="field"><h3>이번 주말</h3><p class="sub">${esc(next.blurb)} · ${c.laps}랩 · AI ${DIFFICULTY[c.difficulty].name}</p>
        <div class="field"><h3>출발 타이어</h3>${compoundPicker(this.state.compound)}</div>
        <div class="row-btns"><button type="button" class="btn primary" data-act="careerQuali">예선 시작</button><button type="button" class="btn" data-act="careerSkip">예선 건너뛰기 (맨 뒤 출발)</button></div></div>`
          : `<div class="row-btns"><button type="button" class="btn primary" data-act="resultsNext">시즌 결과</button></div>`
      }
      <div class="field"><h3>캘린더</h3><div class="calendar">${c.calendar
        .map((id, k) => {
          const t = TRACKS.find((x) => x.id === id);
          const r = c.results[k];
          return `<div class="cal${k === c.round ? ' next' : ''}${r ? ' done' : ''}"><small>R${k + 1}</small><b>${esc(t.name)}</b><span>${r ? `결승 P${r.pos} · +${r.points}점` : k === c.round ? '다음 경기' : esc(t.place)}</span></div>`;
        })
        .join('')}</div></div>
      <div class="field"><h3>드라이버 순위</h3><div class="table-wrap"><table><thead><tr><th class="n">#</th><th>드라이버</th><th>팀</th><th class="n">PTS</th></tr></thead><tbody>${drivers
        .slice(0, 20)
        .map((d, k) => `<tr class="${d.id === PLAYER_ID ? 'me' : ''}"><td class="n">${k + 1}</td><td><span class="sw" style="background:${teamById(d.team).color}"></span>${esc(d.name)}</td><td>${esc(teamById(d.team).short)}</td><td class="n">${d.pts}</td></tr>`)
        .join('')}</tbody></table></div></div>
      <div class="field"><h3>컨스트럭터 순위</h3><div class="table-wrap"><table><tbody>${teamsTbl
        .map(([id, pts], k) => `<tr class="${id === c.team ? 'me' : ''}"><td class="n">${k + 1}</td><td><span class="sw" style="background:${teamById(id).color}"></span>${esc(teamById(id).name)}</td><td class="n">${pts}</td></tr>`)
        .join('')}</tbody></table></div></div>
      <div class="row-btns"><button type="button" class="btn ghost" data-act="careerDelete">커리어 삭제</button></div>
    </div>`;
  }

  season() {
    const c = this.app.career;
    const drivers = standings(c);
    const champ = drivers[0];
    const me = drivers.findIndex((d) => d.id === PLAYER_ID) + 1;
    return `<div class="screen wide">
      <h3>시즌 종료</h3>
      <h2>${me === 1 ? '월드 챔피언!' : `챔피언십 ${me}위`}</h2>
      <p class="sub">${me === 1 ? `${esc(c.name)} 선수가 ${c.points[PLAYER_ID] || 0}점으로 시즌 챔피언이 되었습니다.` : `챔피언은 ${esc(champ.name)} (${champ.pts}점). 다음 시즌에 다시 도전해 보세요.`}</p>
      <div class="table-wrap"><table><tbody>${drivers
        .slice(0, 10)
        .map((d, k) => `<tr class="${d.id === PLAYER_ID ? 'me' : ''}"><td class="n">${k + 1}</td><td><span class="sw" style="background:${teamById(d.team).color}"></span>${esc(d.name)}</td><td class="n">${d.pts}</td></tr>`)
        .join('')}</tbody></table></div>
      <div class="row-btns"><button type="button" class="btn primary" data-act="careerDelete">새 시즌 준비 (기록 삭제)</button><button type="button" class="btn" data-act="main">메인으로</button></div>
    </div>`;
  }

  settings(data) {
    const s = this.app.settings;
    const touch = this.app.touch;
    return `<div class="screen wide">
      <button type="button" class="back" data-act="back">← 뒤로</button>
      <h2>설정</h2>
      ${
        touch
          ? `<div class="field"><h3>조향 방식</h3>${seg('steerMode', [['buttons', '터치 버튼'], ['tilt', '기울기']], s.steerMode)}
        <div class="row-btns"><button type="button" class="btn" data-act="tilt">기울기 센서 허용</button><button type="button" class="btn" data-act="calibrate">현재 자세를 중앙으로</button></div>
        ${seg('tiltInvert', [[false, '기울기 기본'], [true, '기울기 반전']], s.tiltInvert)}</div>
        <div class="field"><h3>자동 가속</h3>${seg('autoThrottle', [[true, '켬'], [false, '끔']], s.autoThrottle)}<p class="note">켜면 브레이크를 누르지 않는 동안 자동으로 가속합니다.</p></div>`
          : ''
      }
      <div class="field"><h3>브레이크 보조</h3>${seg('brakeAssist', [[0, '끔'], [1, '약하게'], [2, '강하게']], s.brakeAssist)}<p class="note">코너 진입 속도가 너무 빠르면 자동으로 제동합니다.</p></div>
      <div class="field"><h3>스티어링 보조</h3>${seg('steerAssist', [[false, '끔'], [true, '켬']], s.steerAssist)}</div>
      <div class="field"><h3>레이싱 라인</h3>${seg('racingLine', [['off', '끔'], ['brake', '코너만'], ['full', '전체']], s.racingLine)}<p class="note">빨간색은 지금 속도면 제동해야 하는 구간, 노란색은 곧 제동 구간입니다.</p></div>
      <div class="field"><h3>DRS</h3>${seg('autoDrs', [[false, '직접 열기'], [true, '자동']], s.autoDrs)}</div>
      <div class="field"><h3>타이어 규정 (5랩 이상)</h3>${seg('tyreRule', [[true, '2종 의무 사용'], [false, '자유']], s.tyreRule)}</div>
      <div class="field"><h3>기본 AI 난이도</h3>${seg('difficulty', DIFFICULTY.map((d) => [d.id, d.name]), s.difficulty)}</div>
      <div class="field"><h3>카메라</h3>${seg('camera', [['chase', '추격'], ['far', '먼 추격'], ['cockpit', '콕핏'], ['tcam', 'T-캠']], s.camera)}</div>
      <div class="field"><h3>그래픽 품질</h3>${seg('quality', [['low', '낮음'], ['mid', '보통'], ['high', '높음 (그림자)']], s.quality)}</div>
      <div class="field"><h3>사운드</h3>${seg('sound', [[true, '켬'], [false, '끔']], s.sound)}</div>
    </div>`;
  }

  help(data) {
    return `<div class="screen wide">
      <button type="button" class="back" data-act="back">← 뒤로</button>
      <h2>조작법</h2>
      <div class="field"><h3>키보드</h3><div class="keys">
        <kbd>← →</kbd><span>조향 (A / D)</span>
        <kbd>↑</kbd><span>가속 (W)</span>
        <kbd>↓</kbd><span>브레이크 / 후진 (S)</span>
        <kbd>Space</kbd><span>DRS 열기 · 닫기 (DRS 구간에서 앞차와 1초 이내일 때)</span>
        <kbd>P</kbd><span>피트 요청 · 취소 (다음 피트 입구에서 자동으로 들어갑니다)</span>
        <kbd>T</kbd><span>피트에서 교체할 타이어 선택 (소프트 → 미디엄 → 하드)</span>
        <kbd>C</kbd><span>카메라 전환</span>
        <kbd>L</kbd><span>레이싱 라인 표시 전환</span>
        <kbd>R</kbd><span>트랙으로 복귀 (타임 트라이얼은 랩 리셋)</span>
        <kbd>M</kbd><span>음소거</span>
        <kbd>Esc</kbd><span>일시정지</span>
        <kbd>Q</kbd><span>예선 종료</span>
      </div></div>
      <div class="field"><h3>게임패드</h3><div class="keys">
        <kbd>왼쪽 스틱</kbd><span>조향</span><kbd>RT / LT</kbd><span>가속 / 브레이크</span><kbd>B</kbd><span>DRS</span><kbd>X</kbd><span>피트 요청</span><kbd>RB</kbd><span>타이어 선택</span><kbd>Y</kbd><span>카메라</span><kbd>Start</kbd><span>일시정지</span>
      </div></div>
      <div class="field"><h3>레이스 팁</h3><p class="sub">출발은 신호등 5개가 모두 켜졌다가 꺼지는 순간입니다. 타이어는 마모될수록 그립이 떨어지고 80%를 넘으면 급격히 느려집니다. 피트레인은 시속 80km 제한이며 박스 정지 약 2.5초를 포함해 20초 정도를 잃습니다. 앞차 뒤 45m 안에서는 슬립스트림으로 직선 속도가 올라갑니다.</p></div>
    </div>`;
  }

  pause() {
    const S = this.app.S;
    const extra = S && S.mode === 'quali' ? '<button type="button" class="mbtn" data-act="endQuali"><span><b>예선 종료</b><span>지금까지의 베스트 랩으로 그리드 결정</span></span><span class="arrow">→</span></button>' : '';
    return `<div class="screen">
      <h2>일시정지</h2>
      <div class="menu-list">
        <button type="button" class="mbtn primary" data-act="resume"><span><b>계속하기</b></span><span class="arrow">▶</span></button>
        ${extra}
        <button type="button" class="mbtn" data-act="restart"><span><b>처음부터 다시</b><span>${S && S.mode === 'race' ? '같은 그리드로 결승 재시작' : '세션 재시작'}</span></span><span class="arrow">↺</span></button>
        <button type="button" class="mbtn" data-act="settings"><span><b>설정</b></span><span class="arrow">→</span></button>
        <button type="button" class="mbtn" data-act="help"><span><b>조작법</b></span><span class="arrow">→</span></button>
        <button type="button" class="mbtn" data-act="quit"><span><b>메인 메뉴로</b><span>현재 세션 기록은 저장되지 않습니다</span></span><span class="arrow">×</span></button>
      </div>
    </div>`;
  }

  grid(data) {
    const { list, track, playerCode } = data;
    const me = list.findIndex((r) => r.player) + 1;
    const pole = list[0];
    this.state.compound = this.state.compound || data.compound || 'M';
    return `<div class="screen wide">
      <h3>${esc(track.name)} · 예선 결과</h3>
      <h2>${me === 1 ? '폴 포지션!' : `P${me}에서 출발`}</h2>
      <div class="table-wrap"><table><thead><tr><th class="n">#</th><th>드라이버</th><th>팀</th><th class="n">기록</th><th class="n">차이</th></tr></thead><tbody>${list
        .map((r, k) => {
          const d = r.player ? { name: this.app.profile.name, team: data.teamId } : DRIVERS.find((x) => x.code === r.code);
          return `<tr class="${r.player ? 'me' : ''}"><td class="n">${k + 1}</td><td><span class="sw" style="background:${teamById(d.team).color}"></span>${esc(d.name)} <span class="note">${esc(r.code)}</span></td><td>${esc(teamById(d.team).short)}</td><td class="n">${isFinite(r.time) ? fmtTime(r.time) : '기록 없음'}</td><td class="n">${k && isFinite(r.time) ? '+' + (r.time - pole.time).toFixed(3) : ''}</td></tr>`;
        })
        .join('')}</tbody></table></div>
      <div class="field"><h3>결승 출발 타이어</h3>${compoundPicker(this.state.compound)}</div>
      <div class="row-btns"><button type="button" class="btn primary" data-act="startRace">결승 시작</button><button type="button" class="btn ghost" data-act="main">메인으로</button></div>
    </div>`;
  }

  results(data) {
    const { res, S, career, gained } = data;
    const me = res.find((r) => r.car.isPlayer);
    const fl = S.fastest;
    return `<div class="screen wide">
      <h3>${esc(S.track.name)} · 결승 결과</h3>
      <h2>${me.pos === 1 ? '우승!' : me.pos <= 3 ? `포디움! P${me.pos}` : `P${me.pos} 피니시`}</h2>
      <div class="stat-row">
        <div class="stat"><small>순위</small><b>P${me.pos}</b></div>
        <div class="stat"><small>획득 포인트</small><b>+${me.points}</b></div>
        <div class="stat"><small>베스트 랩</small><b>${fmtTime(me.car.bestLap)}</b></div>
        <div class="stat"><small>피트스톱</small><b>${me.car.pitCount}회</b></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th class="n">#</th><th>드라이버</th><th>팀</th><th>타이어</th><th class="n">기록</th><th class="n">PTS</th></tr></thead><tbody>${res
        .map(
          (r) =>
            `<tr class="${r.car.isPlayer ? 'me' : ''}"><td class="n">${r.pos}</td><td><span class="sw" style="background:${r.car.team.color}"></span>${esc(r.car.driver.name)} ${fl && fl.car === r.car ? '<span class="pill fl">최고 랩</span>' : ''} ${r.car.penalty ? `<span class="pill pen">+${r.car.penalty}초</span>` : ''}</td><td>${esc(r.car.team.short)}</td><td>${r.car.stints.map((c) => `<span style="color:${COMPOUNDS[c].color};font-weight:800">${c}</span>`).join(' ')}</td><td class="n">${r.pos === 1 ? fmtTime(r.total) : r.gapText}</td><td class="n">${r.points || ''}</td></tr>`,
        )
        .join('')}</tbody></table></div>
      ${me.car.penalties.length ? `<p class="note">페널티: ${me.car.penalties.map((p) => `${esc(p.reason)} +${p.sec}초`).join(', ')}</p>` : ''}
      <div class="row-btns">${career ? '<button type="button" class="btn primary" data-act="resultsNext">챔피언십 보기</button>' : '<button type="button" class="btn primary" data-act="again">다시 달리기</button><button type="button" class="btn" data-act="main">메인으로</button>'}</div>
    </div>`;
  }
}

function compoundPicker(sel) {
  return `<div class="compounds">${Object.values(COMPOUNDS)
    .map((c) => `<button type="button" class="cmp-btn" data-cmp="${c.id}" aria-pressed="${c.id === sel}"><i style="border-color:${c.color}"></i>${c.name}</button>`)
    .join('')}</div>`;
}

export function standings(c) {
  const list = DRIVERS.map((d) => ({ id: d.code, code: d.code, name: d.name, team: d.team, pts: c.points[d.code] || 0 }));
  // 플레이어는 팀 두 번째 드라이버를 대신함
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
  const pad = 8;
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
  g.strokeStyle = 'rgba(238,242,246,0.9)';
  g.lineWidth = 2.2;
  g.stroke();
  const p = t.pointAt(0, 0);
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#e4202e';
  g.fillRect(ox + (p.x - b.minX) * sc - 3, oy + (p.z - b.minZ) * sc - 3, 6, 6);
}
