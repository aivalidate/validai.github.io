// 차량 물리, AI 드라이버, 피트 자동주행, 충돌 처리

import { clamp, lerp, wrapAngle, wrapDist } from './util.js';
import { CAR, G, gripAccel, dragAccel, driveAccel, brakeAccel, tireGrip, COMPOUNDS } from './data.js';

export const PIT_LIMIT = 80 / 3.6;
const GEAR_TOP = [88, 122, 156, 190, 225, 262, 300, 360]; // km/h

export function gearFor(v, prevGear = 1) {
  const kmh = Math.abs(v) * 3.6;
  let g = prevGear;
  // 히스테리시스를 둔 자동 변속
  while (g < 8 && kmh > GEAR_TOP[g - 1] * 0.97) g++;
  while (g > 1 && kmh < GEAR_TOP[g - 2] * 0.8) g--;
  const lo = g > 1 ? GEAR_TOP[g - 2] * 0.62 : 0;
  const rpm = clamp(4200 + ((kmh - lo) / (GEAR_TOP[g - 1] - lo)) * 7900, 4200, 12400);
  return { gear: g, rpm };
}

// 노면 판정: 0 트랙, 1 연석, 2 잔디, 3 자갈, 4 아스팔트 런오프
export function surfaceAt(track, i, d) {
  const a = Math.abs(d);
  if (a <= track.half) return 0;
  if (a <= track.half + 1.3) return track.kerb[i] ? 1 : 0;
  const side = d > 0 ? 1 : -1;
  if (track.runoffType === 'asphalt') return 4;
  if ((side > 0 ? track.gravelR[i] : track.gravelL[i]) && a > track.half + 3) return 3;
  return 2;
}

const SURF_GRIP = [1, 0.97, 0.55, 0.42, 0.88];
const SURF_DRAG = [0, 0.3, 3.2, 7.5, 0.2]; // m/s^2 추가 감속

// 벽 위치(차량 중심 기준 한계)
export function wallLimit(track, car, i, side) {
  const run = side > 0 ? track.runR[i] : track.runL[i];
  let lim = track.half + run - 1.05;
  // 피트레인 구간에서는 피트월이 막는다 (피트 진입 중이 아닐 때)
  if (side === track.pit.side && !car.pitState) {
    const r = wrapDist(car.s, track.L);
    if (r > track.pit.entry - 5 && r < track.pit.exit + 5) lim = Math.min(lim, track.pit.wall - 1.05);
  }
  return lim;
}

// ---------------------------------------------------------------------------
// 플레이어(물리 기반) 차량

export function stepPlayer(car, ctl, dt, track, env) {
  const loc = track.locate(car.x, car.z, car.ti);
  car.ti = loc.i;
  car.d = loc.d;
  const surf = surfaceAt(track, loc.i, loc.d);
  car.surface = surf;

  const tg = tireGrip(car.compound, car.wear) * car.gripMult;
  const grip = tg * SURF_GRIP[surf];
  const v = car.v;
  const av = Math.abs(v);

  // 종방향
  let a = 0;
  const dragMult = (car.drsOpen ? CAR.drsDrag : 1) * (car.slip > 0 ? lerp(1, CAR.slipDrag, car.slip) : 1);
  if (ctl.throttle > 0 && v > -0.5) {
    const trac = gripAccel(av, CAR.muLong * grip);
    const eng = (CAR.power * car.powerMult) / (CAR.mass * Math.max(av, 4));
    a += ctl.throttle * Math.min(trac, eng);
  }
  if (ctl.brake > 0) {
    if (v > 0.3) a -= ctl.brake * gripAccel(av, CAR.muBrake * grip) * (car.brakeMult || 1);
    else if (ctl.throttle < 0.1) a -= ctl.brake * 5; // 후진
  }
  if (ctl.throttle > 0 && v < -0.3) a += ctl.throttle * 8; // 후진 중 가속 = 제동
  const resist = dragAccel(av, dragMult) + CAR.roll * G + SURF_DRAG[surf] * Math.min(1, av / 8) + (surf >= 2 ? av * 0.012 : 0);
  let nv = v + a * dt;
  if (v > 0) {
    nv -= resist * dt;
    if (nv < 0 && (v > 0.3 || ctl.brake === 0)) nv = 0;
  } else if (v < 0) {
    nv += resist * dt;
    if (nv > 0 && ctl.throttle === 0) nv = 0;
  }
  if (nv < -8) nv = -8;
  car.v = nv;
  car.accel = (nv - v) / dt;

  // 조향: 저속에서는 조향각, 고속에서는 횡가속 한계 비율
  const maxLat = gripAccel(av, CAR.muLat * grip);
  const dmax = Math.min(CAR.maxSteer, Math.atan((CAR.wheelbase * maxLat * 1.1) / Math.max(av * av, 1)));
  const delta = ctl.steer * dmax;
  car.steerAngle = delta;
  const yawDes = (nv * Math.tan(delta)) / CAR.wheelbase;
  const latReq = Math.abs(nv * yawDes);
  let yaw = yawDes;
  car.sliding = 0;
  if (latReq > maxLat) {
    yaw = yawDes * (maxLat / latReq);
    car.sliding = Math.min(1, (latReq / maxLat - 1) * 3);
  }
  // 잔디 위에서는 약간 흔들림
  if (surf >= 2 && av > 15) yaw += (Math.random() - 0.5) * 0.25 * dt * av * 0.05;
  car.latAcc = nv * yaw;
  car.yawRate = yaw;
  car.h = wrapAngle(car.h + yaw * dt);

  const ch = Math.cos(car.h);
  const sh = Math.sin(car.h);
  car.x += (ch * nv - sh * car.vlat) * dt;
  car.z += (sh * nv + ch * car.vlat) * dt;
  car.vlat *= Math.exp(-7 * dt);

  // 벽 충돌
  const loc2 = track.locate(car.x, car.z, car.ti);
  car.ti = loc2.i;
  car.d = loc2.d;
  const prevS = car.s;
  car.s = loc2.s;
  car.ds = wrapDist(car.s - prevS, track.L);
  for (const side of [1, -1]) {
    const lim = wallLimit(track, car, loc2.i, side);
    const over = side > 0 ? loc2.d - lim : -lim - loc2.d;
    if (over > 0) {
      const nx = track.nx[loc2.i] * side;
      const nz = track.nz[loc2.i] * side;
      car.x -= nx * over;
      car.z -= nz * over;
      car.d -= side * over;
      // 월드 속도 분해
      let vx = ch * car.v - sh * car.vlat;
      let vz = sh * car.v + ch * car.vlat;
      const vn = vx * nx + vz * nz;
      if (vn > 0) {
        vx -= nx * vn * 1.25;
        vz -= nz * vn * 1.25;
        const loss = 1 - Math.min(0.55, vn / 45);
        vx *= loss;
        vz *= loss;
        car.v = vx * ch + vz * sh;
        car.vlat = -vx * sh + vz * ch;
        // 벽을 따라 차체를 정렬
        const th = track.head[loc2.i] + (car.v < 0 ? Math.PI : 0);
        car.h = wrapAngle(car.h + wrapAngle(th - car.h) * Math.min(0.5, vn / 30));
        env.onImpact(car, vn);
      }
    }
  }
}

// 조향 보조/자동주행용 퓨어 퍼슛
export function autoSteer(car, track, extraOff = 0) {
  const la = clamp(8 + Math.abs(car.v) * 0.45, 8, 45);
  const s2 = car.s + la;
  const o = track.sample(track.off, s2) + extraOff;
  const p = track.pointAt(s2, clamp(o, -track.half + 1.2, track.half - 1.2));
  const dx = p.x - car.x;
  const dz = p.z - car.z;
  const alpha = wrapAngle(Math.atan2(dz, dx) - car.h);
  const ld = Math.hypot(dx, dz);
  const k = (2 * Math.sin(alpha)) / Math.max(ld, 1);
  const delta = Math.atan(k * CAR.wheelbase);
  const av = Math.abs(car.v);
  const maxLat = gripAccel(av, CAR.muLat * car.gripMult);
  const dmax = Math.min(CAR.maxSteer, Math.atan((CAR.wheelbase * maxLat * 1.1) / Math.max(av * av, 1)));
  return clamp(delta / dmax, -1, 1);
}

// 목표 속도 (브레이크 보조/자동주행)
export function refSpeed(car, track, look = 0.3) {
  const prof = car.profile;
  const s = car.s + Math.max(car.v, 0) * look;
  const tf = Math.sqrt(tireGrip(car.compound, car.wear) / COMPOUNDS.M.grip);
  return track.sample(prof, s) * lerp(tf, 1, clamp((track.sample(prof, s) - 55) / 35, 0, 1));
}

// ---------------------------------------------------------------------------
// 피트레인 자동주행 (플레이어/AI 공통)

export function stepPit(car, dt, track, env) {
  const pit = track.pit;
  const r = wrapDist(car.s, track.L);
  const boxR = pit.boxes[car.teamIdx];
  if (car.pitState === 'in') {
    let vt = PIT_LIMIT;
    if (r > pit.entry + 90 || car.v > PIT_LIMIT) vt = Math.min(vt, Math.max(PIT_LIMIT, car.v - 14 * dt));
    if (r > pit.entry + 80) vt = Math.min(PIT_LIMIT, Math.sqrt(Math.max(0, 2 * 9 * (boxR - r))) + 0.3);
    if (car.v > vt) car.v = Math.max(vt, car.v - 16 * dt);
    else car.v = Math.min(vt, car.v + 8 * dt);
    if (boxR - r < 0.4 || (car.v < 0.35 && boxR - r < 3)) {
      car.v = 0;
      car.pitState = 'box';
      car.pitTimer = car.pitDuration;
      env.onPitBox(car);
    }
  } else if (car.pitState === 'box') {
    car.v = 0;
    car.pitTimer -= dt;
    if (car.pitTimer <= 0) {
      car.compound = car.pitCompound;
      car.wear = 0;
      car.stints.push(car.compound);
      car.pitCount++;
      car.pitState = 'out';
      car.pitRequest = false;
      env.onPitDone(car);
    }
  } else if (car.pitState === 'out') {
    car.v = Math.min(PIT_LIMIT, car.v + 9 * dt);
    if (r >= pit.exit - 1) {
      car.pitState = null;
      env.onPitExit(car);
    }
  }
  car.s = (((car.s + car.v * dt) % track.L) + track.L) % track.L;
  const nr = wrapDist(car.s, track.L);
  car.d = pitLaneD(car, track, nr);
  const p = track.pointAt(car.s, car.d);
  const p2 = track.pointAt(car.s + 1.5, pitLaneD(car, track, nr + 1.5));
  car.x = p.x;
  car.z = p.z;
  if (car.v > 0.2) car.h = Math.atan2(p2.z - p.z, p2.x - p.x);
  car.ti = track.idx(car.s);
  car.yawRate = 0;
  car.vlat = 0;
  car.drsOpen = false;
}

// 피트레인 주행 라인: 진입 시 현재 위치에서 부드럽게 합류, 박스 앞에서는 차고 쪽으로
function pitLaneD(car, track, r) {
  const pit = track.pit;
  let d = track.pitD(r);
  const boxR = pit.boxes[car.teamIdx];
  const toBox = Math.abs(r - boxR);
  if (toBox < 40) d += pit.side * 2.6 * (1 - toBox / 40);
  const t = (r - pit.entry) / 70;
  if (t < 1) {
    const k = clamp(t, 0, 1);
    d = lerp(car.pitEntryD, d, k * k * (3 - 2 * k));
  }
  return d;
}

// ---------------------------------------------------------------------------
// AI 드라이버 (레이싱 라인을 따라가는 운동학 모델)

export function stepAI(car, dt, track, S) {
  const L = track.L;
  const i = track.idx(car.s);
  const lim = track.half - 1.15;

  // 기본 목표 속도: 개인 프로파일 × 타이어 상태
  const prof = track.sample(car.profile, car.s + car.v * 0.1);
  const tf = Math.sqrt(tireGrip(car.compound, car.wear) / COMPOUNDS.M.grip);
  const cornerW = clamp((prof - 55) / 35, 0, 1);
  let vt = prof * lerp(tf, 1, cornerW) * car.lapPace;
  // 레이싱 라인에서 벗어나면 코너에서 손해
  vt *= 1 - Math.min(0.12, Math.abs(car.e) * 0.012 * (1 - cornerW));
  if (car.mistake > 0) {
    car.mistake -= dt;
    vt *= 0.78;
  }
  // DRS / 슬립스트림: 직선에서 최고속 증가
  if (car.drsOpen) vt *= lerp(1, 1.045, cornerW);
  if (car.slip > 0) vt *= 1 + 0.018 * car.slip * cornerW;

  // 앞차 탐색 (플레이어 포함)
  let ahead = null;
  let aheadGap = 1e9;
  for (const o of S.cars) {
    if (o === car || o.pitState || o.retired) continue;
    const gap = wrapDist(o.s - car.s, L);
    if (gap <= 0 || gap > 70) continue;
    if (Math.abs(o.d - car.d) > 2.4) continue;
    if (gap < aheadGap) {
      aheadGap = gap;
      ahead = o;
    }
  }
  let targetE = car.lineBias;
  if (ahead) {
    const room = aheadGap - 6;
    const closing = car.v - ahead.v;
    if (S.phase === 'green' && (closing > -0.5 || room < 8) && room < 35) {
      // 추월 시도: 여유 공간이 넓은 쪽으로
      if (!car.passSide) {
        const line = track.sample(track.off, car.s);
        const dl = ahead.d - 3.3 - line;
        const dr = ahead.d + 3.3 - line;
        const okL = ahead.d - 3.3 > -lim;
        const okR = ahead.d + 3.3 < lim;
        if (okL && okR) car.passSide = Math.abs(dl) < Math.abs(dr) ? -1 : 1;
        else car.passSide = okL ? -1 : okR ? 1 : 0;
        car.passTimer = 3.5;
      }
    }
    if (car.passSide) targetE = ahead.d + car.passSide * 3.3 - track.sample(track.off, car.s);
    // 아직 겹쳐 있다면 앞차 속도에 맞춘다
    if (Math.abs(ahead.d - car.d) < 2.2) {
      const follow = ahead.v + (room - 2) * 0.9;
      vt = Math.min(vt, Math.max(0, follow));
    }
  }
  if (car.passTimer > 0) {
    car.passTimer -= dt;
    if (car.passTimer <= 0) car.passSide = 0;
  }
  if (!ahead && car.passSide && car.passTimer < 2.5) car.passSide = 0;

  // 가감속
  if (S.phase !== 'green') vt = 0;
  if (car.launchDelay > 0) {
    car.launchDelay -= dt;
    vt = 0;
  }
  if (car.v < vt) car.v = Math.min(vt, car.v + driveAccel(car.v, car.powerMult) * car.launch * dt);
  else car.v = Math.max(vt, car.v - brakeAccel(car.v, 1) * dt * 1.1);
  car.accel = 0;

  // 횡방향 오프셋
  const latRate = 1.6 + car.v * 0.03;
  car.e += clamp(targetE - car.e, -latRate * dt, latRate * dt);
  const line = track.sample(track.off, car.s);
  let d = clamp(line + car.e, -lim, lim);
  car.e = d - line;

  // 전진
  const k = track.curv[i];
  const prevX = car.x;
  const prevZ = car.z;
  const dsC = (car.v * dt) / clamp(1 - k * d, 0.5, 1.5);
  car.s = (((car.s + dsC) % L) + L) % L;
  car.ds = dsC;
  car.d = d;
  const p = track.pointAt(car.s, d);
  car.x = p.x;
  car.z = p.z;
  car.ti = track.idx(car.s);
  const mx = car.x - prevX;
  const mz = car.z - prevZ;
  if (mx * mx + mz * mz > 1e-4) {
    const hh = Math.atan2(mz, mx);
    const dh = wrapAngle(hh - car.h);
    car.yawRate = dh / dt;
    car.h = wrapAngle(car.h + dh * Math.min(1, dt * 20));
  }
  car.latAcc = car.v * car.v * k;
  car.steerAngle = clamp(Math.atan(k * CAR.wheelbase) * 1.2, -0.4, 0.4);
}

// ---------------------------------------------------------------------------
// 차량 간 충돌 (각 차량을 원 3개로 근사)

const OFFS = [-1.9, 0, 1.9];
const RAD = 1.0;

export function collideCars(S, env) {
  const cars = S.cars;
  const L = S.track.L;
  for (let a = 0; a < cars.length; a++) {
    const A = cars[a];
    if (A.pitState || A.retired) continue;
    for (let b = a + 1; b < cars.length; b++) {
      const B = cars[b];
      if (B.pitState || B.retired) continue;
      if (Math.abs(wrapDist(A.s - B.s, L)) > 8) continue;
      let best = null;
      const ca = Math.cos(A.h);
      const sa = Math.sin(A.h);
      const cb = Math.cos(B.h);
      const sb = Math.sin(B.h);
      for (const oa of OFFS) {
        const ax = A.x + ca * oa;
        const az = A.z + sa * oa;
        for (const ob of OFFS) {
          const bx = B.x + cb * ob;
          const bz = B.z + sb * ob;
          const dx = bx - ax;
          const dz = bz - az;
          const d2 = dx * dx + dz * dz;
          if (d2 < 4 * RAD * RAD) {
            const d = Math.sqrt(d2) || 0.01;
            const pen = 2 * RAD - d;
            if (!best || pen > best.pen) best = { pen, nx: dx / d, nz: dz / d };
          }
        }
      }
      if (!best) continue;
      resolvePair(A, B, best, S, env);
    }
  }
}

function resolvePair(A, B, c, S, env) {
  const track = S.track;
  const { nx, nz, pen } = c;
  // 상대 속도 (월드)
  const va = worldVel(A);
  const vb = worldVel(B);
  const rel = (vb.x - va.x) * nx + (vb.z - va.z) * nz; // <0 이면 접근 중
  const pushA = A.isPlayer ? 0.55 : B.isPlayer ? 0.45 : 0.5;
  moveCar(A, -nx * pen * pushA, -nz * pen * pushA, track);
  moveCar(B, nx * pen * (1 - pushA), nz * pen * (1 - pushA), track);
  if (rel < 0) {
    const j = -rel * 0.6;
    addVel(A, -nx * j, -nz * j);
    addVel(B, nx * j, nz * j);
    if (A.isPlayer || B.isPlayer) env.onCarHit(A.isPlayer ? A : B, -rel);
  }
}

function worldVel(c) {
  const ch = Math.cos(c.h);
  const sh = Math.sin(c.h);
  const vl = c.isPlayer ? c.vlat : 0;
  return { x: ch * c.v - sh * vl, z: sh * c.v + ch * vl };
}

function addVel(c, dx, dz) {
  const ch = Math.cos(c.h);
  const sh = Math.sin(c.h);
  if (c.isPlayer && !c.auto) {
    c.v += dx * ch + dz * sh;
    c.vlat += -dx * sh + dz * ch;
  } else {
    c.v = Math.max(0, c.v + (dx * ch + dz * sh) * 0.8);
  }
}

function moveCar(c, dx, dz, track) {
  if (c.isPlayer && !c.auto) {
    c.x += dx;
    c.z += dz;
  } else {
    const i = c.ti;
    const dd = dx * track.nx[i] + dz * track.nz[i];
    c.e += dd;
    c.d += dd;
    c.s = (((c.s + dx * track.tx[i] + dz * track.tz[i]) % track.L) + track.L) % track.L;
    const p = track.pointAt(c.s, c.d);
    c.x = p.x;
    c.z = p.z;
  }
}
