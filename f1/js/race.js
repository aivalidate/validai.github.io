// 세션(예선/결승/타임어택) 진행: 출발 신호, 랩/섹터 타이밍, 순위, DRS, 피트, 타이어

import { clamp, lerp, wrapDist, mod } from './util.js';
import { TEAMS, DRIVERS, DIFFICULTY, COMPOUNDS, POINTS, tireGrip } from './data.js';
import { computeProfile } from './tracks.js';
import { stepPlayer, stepPit, stepAI, collideCars, autoSteer, refSpeed, gearFor, PIT_LIMIT } from './physics.js';

const SUB = 1 / 120;

// 플레이어의 내부 식별자 (표시용 약칭과 별개라 AI와 약칭이 같아도 안전)
export const PLAYER_ID = '@PLAYER';

// 소프트 타이어가 완전히 닳는 데 걸리는 랩 수를 레이스 길이에 맞춘다
// (짧은 레이스는 무정지로 완주 가능, 긴 레이스는 전략이 필요)
export function wearPerLap(compound, laps) {
  const softLife = laps <= 4 ? laps * 1.5 : Math.max(3, laps * 0.5);
  return COMPOUNDS[compound].wear / softLife;
}

// 남은 랩 수를 버틸 수 있는 가장 부드러운 타이어
export function bestCompoundFor(lapsLeft, laps, exclude) {
  for (const c of ['S', 'M', 'H']) {
    if (c === exclude) continue;
    if (lapsLeft * wearPerLap(c, laps) <= 0.82) return c;
  }
  return exclude === 'H' ? 'M' : 'H';
}

function crossed(prevS, ds, p, L) {
  if (ds <= 0) return -1;
  const rel = mod(p - prevS, L);
  return rel <= ds ? rel / ds : -1;
}

function makeCar(id, driver, team, isPlayer) {
  return {
    id,
    driver,
    team,
    teamIdx: TEAMS.indexOf(team),
    isPlayer,
    auto: false,
    x: 0,
    z: 0,
    h: 0,
    v: 0,
    vlat: 0,
    s: 0,
    d: 0,
    e: 0,
    ds: 0,
    ti: -1,
    yawRate: 0,
    latAcc: 0,
    accel: 0,
    steerAngle: 0,
    sliding: 0,
    surface: 0,
    lap: 0,
    lapStart: 0,
    lapTimes: [],
    bestLap: null,
    lastLap: null,
    lapValid: true,
    sector: 0,
    sectorStart: 0,
    curSectors: [null, null, null],
    bestSectors: [null, null, null],
    gap: 0,
    interval: 0,
    compound: 'M',
    wear: 0,
    stints: [],
    pitCount: 0,
    pitState: null,
    pitRequest: false,
    pitCompound: 'H',
    pitTimer: 0,
    pitDuration: 2.5,
    pitEntryD: 0,
    wantPit: false,
    pitLap: 99,
    drsEligible: false,
    drsAvail: false,
    drsOpen: false,
    drsZone: -1,
    slip: 0,
    gripMult: 1,
    powerMult: 1,
    profile: null,
    lapPace: 1,
    lineBias: 0,
    passSide: 0,
    passTimer: 0,
    mistake: 0,
    mistakeAt: -1,
    launchDelay: 0,
    launch: 1,
    finished: false,
    finishTime: null,
    penalty: 0,
    penalties: [],
    dist: 0,
    pos: 0,
    gear: 1,
    rpm: 4000,
    throttle: 0,
    brake: 0,
    retired: false,
    gridX: 0,
    gridZ: 0,
  };
}

export class Session {
  // opts: { track, mode: 'race'|'quali'|'tt', laps, difficulty, playerTeam, playerName, playerCode,
  //         grid: [driverCode...](결승 그리드 순서), startCompound, tyreRule, wearMult, assists }
  constructor(opts) {
    this.opts = opts;
    this.track = opts.track;
    this.mode = opts.mode;
    this.laps = opts.laps || 5;
    this.diff = DIFFICULTY[opts.difficulty ?? 1];
    this.t = 0;
    this.clock = 0;
    this.phase = this.mode === 'race' ? 'grid' : 'green';
    this.phaseTimer = 0;
    this.lights = 0;
    this.lightsHold = 0.6 + Math.random() * 1.6;
    this.checkered = false;
    this.events = [];
    this.markers = new Map();
    this.fastest = null;
    this.bestSectors = [null, null, null];
    this.wearMult = this.mode === 'race' ? opts.wearMult ?? 1 : 0;
    this.tyreRule = this.mode === 'race' && !!opts.tyreRule && this.laps >= 5;
    this.cars = [];
    this.qualiLaps = 0;
    this.env = {
      onImpact: (car, v) => {
        if (car.isPlayer && v > 0.8 && this.clock - (this.lastImpact || 0) > 0.25) {
          this.lastImpact = this.clock;
          this.emit('impact', { car, v });
        }
      },
      onCarHit: (car, v) => {
        if (v > 1.2 && this.clock - (this.lastHit || 0) > 0.35) {
          this.lastHit = this.clock;
          this.emit('carHit', { car, v });
        }
      },
      onPitBox: (car) => car.isPlayer && this.emit('pitBox', { car }),
      onPitDone: (car) => car.isPlayer && this.emit('pitDone', { car }),
      onPitExit: (car) => {
        const track = this.track;
        car.ti = -1;
        car.vlat = 0;
        car.e = car.d - track.sample(track.off, car.s);
        car.lineBias = (Math.random() - 0.5) * 0.8;
        car.wantPit = false;
        if (car.isPlayer) this.emit('pitExit', { car });
      },
    };
    this.buildCars();
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  buildCars() {
    const track = this.track;
    const o = this.opts;
    const pTeam = TEAMS.find((t) => t.id === o.playerTeam) || TEAMS[0];
    // 플레이어는 소속 팀의 두 번째 드라이버 자리를 대신한다
    const roster = [];
    let replaced = false;
    for (const d of DRIVERS) {
      if (!replaced && d.team === pTeam.id && DRIVERS.filter((x) => x.team === pTeam.id).indexOf(d) === 1) {
        replaced = true;
        roster.push({ id: PLAYER_ID, name: o.playerName || '플레이어', code: o.playerCode || 'YOU', team: pTeam.id, num: o.playerNum || 1, skill: 1, player: true });
      } else roster.push({ ...d, id: d.code });
    }
    this.roster = roster;

    const player = roster.find((d) => d.player);
    const entries = this.mode === 'race' ? roster : [player];
    // 그리드 순서
    let order = entries;
    if (this.mode === 'race' && o.grid) {
      order = o.grid.map((id) => entries.find((d) => d.id === id)).filter(Boolean);
      for (const d of entries) if (!order.includes(d)) order.push(d);
    }
    order.forEach((drv, k) => {
      const team = TEAMS.find((t) => t.id === drv.team);
      const car = makeCar(k, drv, team, !!drv.player);
      if (car.isPlayer) {
        car.gripMult = team.perf;
        car.powerMult = Math.pow(team.perf, 1.5);
        car.profile = computeProfile(track, car.gripMult, car.powerMult);
        this.player = car;
      } else {
        const p = this.diff.pace * drv.skill;
        car.gripMult = p * p * team.perf;
        car.powerMult = Math.pow(team.perf, 1.5);
        car.profile = computeProfile(track, car.gripMult, car.powerMult);
        car.lineBias = (Math.random() - 0.5) * 0.8;
        car.launchDelay = 0.18 + Math.random() * 0.35;
        car.launch = 0.9 + Math.random() * 0.14;
      }
      this.cars.push(car);
    });

    // 배치
    if (this.mode === 'race') {
      this.cars.forEach((car, k) => {
        const back = 10 + k * 8;
        const side = k % 2 === 0 ? -1 : 1;
        const d = side * 3.2;
        car.s = track.L - back;
        car.d = d;
        const p = track.pointAt(car.s, d);
        car.x = p.x;
        car.z = p.z;
        car.h = track.head[track.idx(car.s)];
        car.gridX = p.x;
        car.gridZ = p.z;
        car.e = d - track.sample(track.off, car.s);
        car.lap = 0;
        this.setupStrategy(car);
      });
    } else {
      const car = this.player;
      this.resetFlying(car);
      car.compound = this.mode === 'quali' ? 'S' : 'S';
      car.stints = [car.compound];
    }
    this.order = this.cars.slice();
    this.cars.forEach((c, k) => (c.pos = k + 1));
  }

  resetFlying(car) {
    const track = this.track;
    const back = Math.min(track.def.startAt - 40, 420);
    car.s = track.L - back;
    car.d = track.sample(track.off, car.s);
    const p = track.pointAt(car.s, car.d);
    car.x = p.x;
    car.z = p.z;
    car.h = track.head[track.idx(car.s)];
    car.v = Math.min(track.sample(car.profile, car.s) * 0.85, 70);
    car.vlat = 0;
    car.ti = -1;
    car.lap = 0;
    car.lapValid = true;
    car.sector = 0;
    car.curSectors = [null, null, null];
    car.pitState = null;
    car.wear = 0;
  }

  setupStrategy(car) {
    const laps = this.laps;
    const o = this.opts;
    if (car.isPlayer) {
      car.compound = o.startCompound || 'M';
      car.stints = [car.compound];
      car.pitCompound = bestCompoundFor(Math.ceil(laps / 2), laps, this.tyreRule ? car.compound : null);
      return;
    }
    // AI: 1스톱 전략 (타이어 규정이 있거나 마모가 심할 때)
    const start = Math.random() < 0.55 ? 'M' : 'S';
    car.compound = laps <= 3 ? 'S' : start;
    car.stints = [car.compound];
    const life = 0.8 / wearPerLap(car.compound, laps);
    const needStop = this.tyreRule || life < laps;
    if (needStop && this.wearMult > 0) {
      const lap = clamp(Math.round(Math.min(life, laps * 0.6) + (Math.random() - 0.5) * 1.6), 1, laps - 1);
      car.pitLap = lap;
      car.pitCompound = bestCompoundFor(laps - lap, laps, this.tyreRule ? car.compound : null);
    }
  }

  get leader() {
    return this.order[0];
  }

  // ctl: { steer, throttle, brake, drs(press), pit(press) }
  update(dt, ctl) {
    dt = Math.min(dt, 0.05);
    this.clock += dt;
    const track = this.track;
    const L = track.L;
    const P = this.player;

    if (this.phase === 'grid') {
      this.phaseTimer += dt;
      if (this.phaseTimer > 1.6) {
        this.phase = 'lights';
        this.phaseTimer = 0;
        this.emit('lightsStart');
      }
    } else if (this.phase === 'lights') {
      this.phaseTimer += dt;
      const n = Math.min(5, Math.floor(this.phaseTimer / 0.9) + 1);
      if (n !== this.lights && this.phaseTimer < 4.5) {
        this.lights = n;
        this.emit('light', { n });
      }
      if (this.phaseTimer > 4.5 + this.lightsHold) {
        this.lights = 0;
        this.phase = 'green';
        this.t = 0;
        this.cars.forEach((c) => {
          c.lapStart = 0;
          c.sectorStart = 0;
        });
        this.emit('go');
      }
    }

    // 플레이어 조작 처리
    if (P && !P.auto) {
      if (ctl.pitPress && this.mode === 'race') {
        P.pitRequest = !P.pitRequest;
        this.emit('pitRequest', { on: P.pitRequest });
      }
      if (ctl.compoundPress) {
        const list = ['S', 'M', 'H'];
        P.pitCompound = list[(list.indexOf(P.pitCompound) + 1) % 3];
        this.emit('pitCompound', { c: P.pitCompound });
      }
      if (ctl.drsPress && P.drsAvail && !P.drsOpen) P.drsOpen = true;
      else if (ctl.drsPress && P.drsOpen) P.drsOpen = false;
      if (P.drsOpen && ctl.brake > 0.15) {
        P.drsOpen = false;
        P.drsAvail = false;
      }
    }

    const n = Math.max(1, Math.ceil(dt / SUB - 1e-6));
    const h = dt / n;
    const env = this.env;
    for (let k = 0; k < n; k++) {
      if (this.phase === 'green') this.t += h;
      for (const car of this.cars) {
        const prevS = car.s;
        if (car.pitState) stepPit(car, h, track, env);
        else if (car.isPlayer) {
          let c = ctl;
          if (car.auto) c = this.autoControl(car, car.finished ? 0.75 : 1);
          else c = this.applyAssists(car, ctl);
          if (this.phase === 'grid' || this.phase === 'lights') {
            car.revving = c.throttle;
            car.v = 0;
            car.vlat = 0;
            c = { steer: 0, throttle: 0, brake: 0 };
          } else car.revving = 0;
          car.throttle = c.throttle;
          car.brake = c.brake;
          stepPlayer(car, c, h, track, env);
        } else {
          if (car.finished) car.lapPace = 0.82;
          stepAI(car, h, track, this);
        }
        if (!car.isPlayer || car.pitState) car.ds = wrapDist(car.s - prevS, L);
        this.timing(car, prevS, h);
      }
      collideCars(this, env);
    }

    this.postUpdate(dt);
  }

  addPenalty(car, sec, reason) {
    car.penalty += sec;
    car.penalties.push({ sec, reason });
    if (car.isPlayer) this.emit('penalty', { sec, reason });
  }

  applyAssists(car, ctl) {
    const a = this.opts.assists || {};
    let { steer, throttle, brake } = ctl;
    if (a.autoThrottle && brake < 0.05) throttle = 1;
    if (a.autoThrottle && brake >= 0.05) throttle = 0;
    if (a.steer && car.v > 3) {
      const auto = autoSteer(car, this.track);
      if (Math.abs(steer) < 0.05) steer = auto * 0.85;
      else steer = clamp(steer * 0.65 + auto * 0.35, -1, 1);
    }
    if (a.brake && car.v > 5 && !car.pitState) {
      const margin = a.brake === 2 ? 0.985 : 1.06;
      const vr = refSpeed(car, this.track, 0.45) * margin;
      if (car.v > vr) {
        const b = clamp((car.v - vr) / 4, 0.2, 1);
        brake = Math.max(brake, b);
        throttle = Math.min(throttle, 0);
        car.assistBraking = true;
      } else car.assistBraking = false;
    }
    return { steer, throttle, brake };
  }

  autoControl(car, pace = 1) {
    const track = this.track;
    const L = track.L;
    // 앞차 회피 (자동주행용)
    let ahead = null;
    let gapA = 1e9;
    for (const o of this.cars) {
      if (o === car || o.pitState) continue;
      const g = wrapDist(o.s - car.s, L);
      if (g > 0 && g < 60 && Math.abs(o.d - car.d) < 2.6 && g < gapA) {
        gapA = g;
        ahead = o;
      }
    }
    const extra = 0;
    const steer = autoSteer(car, track, extra);
    let vt = refSpeed(car, track, 0.5) * pace * (this.phase === 'green' ? 1 : 0);
    if (ahead && Math.abs(ahead.d - car.d) < 2.1) vt = Math.min(vt, ahead.v + (gapA - 8) * 0.8);
    let throttle = 0;
    let brake = 0;
    if (car.v > vt + 0.3) brake = clamp((car.v - vt) / 2.5, 0.25, 1);
    else if (car.v < vt - 0.3) throttle = car.sliding > 0.05 ? 0.3 : 1;
    else throttle = 0.6;
    // 코너 탈출에서 바깥으로 밀리면 가속을 줄인다
    const edge = track.half - 1;
    if (Math.sign(car.d) === -Math.sign(track.curv[track.idx(car.s)]) && Math.abs(car.d) > edge) throttle = Math.min(throttle, 0.2);
    if (car.drsAvail && !car.drsOpen) car.drsOpen = true;
    // 피트 요청 자동 처리 (테스트용)
    if (car.auto && this.mode === 'race' && car.pitCount === 0 && this.tyreRule && car.lap >= Math.ceil(this.laps / 2) && !car.finished)
      car.pitRequest = true;
    return { steer, throttle, brake };
  }

  // 결승선/섹터/DRS/피트 입구 통과 처리
  timing(car, prevS, h) {
    const track = this.track;
    const L = track.L;
    const ds = car.ds;
    if (ds < -20 || ds > 60) return;
    const tNow = this.t;

    // 역주행으로 결승선을 넘으면 랩 차감
    if (ds < 0 && mod(0 - car.s, L) <= -ds && car.lap > 0 && !car.pitState) {
      car.lap--;
      car.lapValid = false;
      return;
    }
    if (ds <= 0) return;

    // 100m 마다 타이밍 포인트 (간격 계산)
    if (this.mode === 'race' && this.phase === 'green') {
      const m0 = Math.floor(prevS / 100);
      const m1 = Math.floor((prevS + ds) / 100);
      if (m1 !== m0) {
        const mk = Math.floor((m1 * 100) % L / 100);
        const lapK = car.lap + (prevS + ds >= L ? 1 : 0);
        const key = lapK * 1000 + mk;
        const tc = tNow;
        if (!this.markers.has(key)) this.markers.set(key, tc);
        car.gap = tc - this.markers.get(key);
      }
    }

    // 섹터
    for (let k = 0; k < 2; k++) {
      const f = crossed(prevS, ds, track.sectors[k], L);
      if (f >= 0 && car.sector === k && car.lap >= 1) {
        const tc = tNow - h * (1 - f);
        this.sectorDone(car, k, tc - car.sectorStart);
        car.sectorStart = tc;
        car.sector = k + 1;
      }
    }

    // 결승선
    const fl = crossed(prevS, ds, 0, L);
    if (fl >= 0 && prevS > L / 2) {
      const tc = tNow - h * (1 - fl);
      if (car.lap >= 1 && this.phase === 'green') {
        const lt = tc - car.lapStart;
        if (car.sector === 2) this.sectorDone(car, 2, tc - car.sectorStart);
        this.lapDone(car, lt);
      }
      const firstRaceLap = car.lap === 0 && this.mode === 'race';
      car.lap++;
      if (!firstRaceLap) {
        car.lapStart = tc;
        car.sectorStart = tc;
      }
      car.sector = 0;
      car.lapValid = true;
      car.curSectors = [null, null, null];
      if (this.mode === 'race' && this.phase === 'green') {
        if (!car.finished && (this.checkered || car.lap > this.laps)) {
          car.finished = true;
          car.finishTime = tc;
          car.lapsDone = car.lap - 1;
          if (!this.checkered) {
            this.checkered = true;
            this.emit('checkered', { car });
          }
          if (car.isPlayer) {
            car.auto = true;
            car.drsOpen = false;
            this.emit('finish', { car });
          }
        } else if (car.lap === this.laps && car.isPlayer) this.emit('finalLap');
        else if (car.isPlayer && car.lap > 1) this.emit('lap', { lap: car.lap });
        // AI 실수 예약
        if (!car.isPlayer) {
          const chance = [0.22, 0.14, 0.08, 0.04][this.diff.id];
          car.mistakeAt = Math.random() < chance ? Math.random() * L : -1;
          car.lapPace = 1 + (Math.random() - 0.5) * 0.008;
        }
      }
    }

    // AI 실수 발동
    if (car.mistakeAt >= 0 && crossed(prevS, ds, car.mistakeAt, L) >= 0) {
      car.mistake = 0.9 + Math.random() * 0.8;
      car.mistakeAt = -1;
    }

    // DRS
    const drsOn = this.mode !== 'race' || (this.phase === 'green' && car.lap >= 2 && !this.checkered);
    track.drs.forEach((z, zi) => {
      if (crossed(prevS, ds, z.detect, L) >= 0) {
        if (this.mode !== 'race') car.drsEligible = true;
        else {
          const ahead = this.order[car.pos - 2];
          const gapT = ahead ? (ahead.dist - car.dist) / Math.max(car.v, 30) : 99;
          car.drsEligible = drsOn && !!ahead && gapT < 1.0 && !ahead.pitState;
        }
      }
      if (crossed(prevS, ds, z.start, L) >= 0) {
        car.drsZone = zi;
        car.drsAvail = drsOn && car.drsEligible && !car.pitState;
        if (car.drsAvail) {
          if (!car.isPlayer || car.auto || (this.opts.assists && this.opts.assists.autoDrs)) car.drsOpen = true;
          if (car.isPlayer) this.emit('drsAvail');
        }
      }
      if (crossed(prevS, ds, z.end, L) >= 0) {
        car.drsZone = -1;
        car.drsAvail = false;
        car.drsOpen = false;
        car.drsEligible = false;
      }
    });

    // 피트 입구
    if (!car.pitState && this.mode === 'race' && this.phase === 'green' && crossed(prevS, ds, mod(track.pit.entry, L), L) >= 0) {
      const want = car.isPlayer ? car.pitRequest : !car.finished && (car.lap >= car.pitLap || car.wear > 0.84) && car.pitCount === 0;
      if (want && !(car.isPlayer && car.finished)) this.enterPit(car);
    }

    // AI: 피트 들어가기 전 피트 쪽 차선으로
    if (!car.isPlayer && !car.pitState) {
      const r = wrapDist(car.s - mod(track.pit.entry, L), L);
      const planned = car.pitCount === 0 && (car.lap >= car.pitLap || car.wear > 0.84) && !car.finished;
      car.wantPit = planned && r > -350 && r < 0;
      if (car.wantPit) car.lineBias = track.pit.side * (track.half - 2.2) - track.sample(track.off, car.s);
      else if (Math.abs(car.lineBias) > 0.5) car.lineBias *= 0.98;
    }

    // 트랙 이탈 (예선/타임어택 랩 무효)
    if (car.isPlayer && Math.abs(car.d) > track.half + 2.3 && !car.pitState && car.lapValid && car.lap >= 1) {
      car.lapValid = false;
      if (this.mode !== 'race') this.emit('invalid');
    }

    // 타이어 마모
    if (this.wearMult > 0 && this.phase === 'green') {
      let intensity = 1;
      if (car.isPlayer && !car.auto) intensity = 0.75 + 0.45 * Math.min(1, Math.abs(car.latAcc) / 32) + 0.25 * car.brake + car.sliding * 0.6;
      car.wear = Math.min(1, car.wear + (wearPerLap(car.compound, this.laps) * this.wearMult * intensity * ds) / L);
    }
  }

  enterPit(car) {
    car.pitState = 'in';
    car.pitEntryD = car.d;
    car.pitDuration = car.isPlayer ? 2.3 + Math.random() * 0.5 : 2.2 + Math.random() * 1.1;
    car.drsOpen = false;
    car.drsAvail = false;
    if (car.isPlayer) this.emit('pitIn');
  }

  sectorDone(car, k, time) {
    car.curSectors[k] = time;
    let color = 'yellow';
    if (car.lapValid) {
      const pb = car.bestSectors[k];
      const ob = this.bestSectors[k];
      if (ob == null || time < ob) {
        this.bestSectors[k] = time;
        color = 'purple';
      } else if (pb == null || time < pb) color = 'green';
      if (pb == null || time < pb) car.bestSectors[k] = time;
    }
    if (car.isPlayer) this.emit('sector', { k, time, color });
  }

  lapDone(car, lt) {
    const valid = car.lapValid;
    car.lastLap = lt;
    car.lapTimes.push({ time: lt, valid, compound: car.compound });
    const pb = car.bestLap == null || lt < car.bestLap;
    if (valid && pb) car.bestLap = lt;
    let overall = false;
    if (valid && (!this.fastest || lt < this.fastest.time)) {
      this.fastest = { time: lt, car };
      overall = true;
    }
    if (car.isPlayer) this.emit('lapTime', { time: lt, valid, pb: valid && pb, overall });
    else if (overall && this.mode === 'race' && car.lap > 2) this.emit('fastestOther', { car, time: lt });
    if (car.isPlayer && this.mode === 'quali') {
      this.qualiLaps++;
      if (this.qualiLaps >= 3) this.emit('qualiOver');
    }
  }

  postUpdate(dt) {
    const L = this.track.L;
    for (const c of this.cars) {
      c.dist = (c.lap - 1) * L + c.s;
      const gr = gearFor(c.v, c.gear);
      if (gr.gear !== c.gear && c.isPlayer) this.emit(gr.gear > c.gear ? 'upshift' : 'downshift');
      c.gear = gr.gear;
      c.rpm = gr.rpm;
    }
    // 순위
    const fin = this.cars.filter((c) => c.finished).sort((a, b) => a.finishTime - b.finishTime);
    const run = this.cars.filter((c) => !c.finished).sort((a, b) => b.dist - a.dist);
    const prevPos = this.player ? this.player.pos : 0;
    this.order = fin.concat(run);
    this.order.forEach((c, k) => (c.pos = k + 1));
    // 앞차와의 간격
    for (let k = 0; k < this.order.length; k++) {
      const c = this.order[k];
      const a = this.order[k - 1];
      c.interval = a ? Math.max(0, c.gap - a.gap) : 0;
      c.lapsDown = this.leader ? Math.max(0, Math.floor((this.leader.dist - c.dist) / L)) : 0;
    }
    if (this.player && this.mode === 'race' && this.phase === 'green' && this.player.pos !== prevPos && this.t > 1) {
      this.emit('position', { pos: this.player.pos, gained: this.player.pos < prevPos });
    }
    // 슬립스트림
    for (const c of this.cars) {
      c.slip = 0;
      if (c.v < 40 || c.pitState) continue;
      for (const o of this.cars) {
        if (o === c || o.pitState) continue;
        const gap = wrapDist(o.s - c.s, L);
        if (gap > 5 && gap < 45 && Math.abs(o.d - c.d) < 1.8) c.slip = Math.max(c.slip, 1 - gap / 45);
      }
    }
  }

  // 결과 (결승)
  results() {
    const L = this.track.L;
    const cars = this.cars.map((c) => {
      let laps = c.finished ? c.lapsDone : c.lap - 1 + (this.checkered ? 1 : 0);
      let time = c.finishTime;
      if (!c.finished) {
        // 다음 결승선 통과 시점을 추정
        const avg = c.lapTimes.length ? c.lapTimes.reduce((a, b) => a + b.time, 0) / c.lapTimes.length : 90;
        const v = L / avg;
        const remain = this.checkered ? L - c.s : (this.laps - (c.lap - 1)) * L - c.s;
        time = this.t + remain / Math.max(v, 10);
        if (!this.checkered) laps = this.laps;
      }
      // 타이어 규정 위반
      if (this.tyreRule && new Set(c.stints).size < 2 && !c.tyrePenalised) {
        c.tyrePenalised = true;
        c.penalty += 10;
        c.penalties.push({ sec: 10, reason: '타이어 규정 위반' });
      }
      return { car: c, laps: Math.max(0, laps), time, total: time + c.penalty };
    });
    cars.sort((a, b) => b.laps - a.laps || a.total - b.total);
    const win = cars[0];
    cars.forEach((r, k) => {
      r.pos = k + 1;
      r.points = POINTS[k] || 0;
      r.gapText = k === 0 ? null : r.laps < win.laps ? `+${win.laps - r.laps}랩` : `+${(r.total - win.total).toFixed(3)}`;
    });
    return cars;
  }
}

// 예선: AI 랩타임 시뮬레이션
export function simulateQuali(track, difficulty, playerTeamId, playerCode, playerTime) {
  const diff = DIFFICULTY[difficulty ?? 1];
  const list = [];
  const pTeam = TEAMS.find((t) => t.id === playerTeamId) || TEAMS[0];
  const teamDrivers = DRIVERS.filter((d) => d.team === pTeam.id);
  for (const d of DRIVERS) {
    if (d === teamDrivers[1]) continue;
    const team = TEAMS.find((t) => t.id === d.team);
    const p = diff.pace * d.skill;
    const prof = computeProfile(track, p * p * team.perf * COMPOUNDS.S.grip, Math.pow(team.perf, 1.5));
    let t = prof.lapTime * (1 + Math.random() * 0.006);
    if (Math.random() < [0.15, 0.1, 0.06, 0.03][diff.id]) t *= 1.006 + Math.random() * 0.01;
    list.push({ id: d.code, code: d.code, time: t });
  }
  list.push({ id: PLAYER_ID, code: playerCode, time: playerTime ?? Infinity, player: true });
  list.sort((a, b) => a.time - b.time);
  return list;
}

export { lerp, tireGrip, PIT_LIMIT };
