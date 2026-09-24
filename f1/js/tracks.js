// 서킷 정의와 지오메트리 생성 (three.js 의존성 없음)
// 좌표계: x-z 평면, heading h 방향 벡터 = (cos h, sin h), 오른쪽 법선 = (-sin h, cos h)
// 코너 각도는 +가 우회전, 시계방향 서킷의 각도 합은 +360.

import { clamp, lerp, wrapDist } from './util.js';
import { CAR, cornerSpeed, driveAccel, brakeAccel } from './data.js';

export const DS = 2; // 샘플 간격(m)

// 서킷 분위기 (렌더링/노면 판정에 사용)
export const THEMES = {
  meadow: { runoff: 'grass', gravel: true, night: false },
  riviera: { runoff: 'asphalt', gravel: false, night: false, street: true },
  park: { runoff: 'grass', gravel: true, night: false },
  sakura: { runoff: 'grass', gravel: true, night: false },
  desert: { runoff: 'asphalt', gravel: false, night: true },
  island: { runoff: 'grass', gravel: false, night: false },
};
const DEG = Math.PI / 180;

// ['S', 길이] 직선, ['S', 길이, 'adj'] 폐곡선을 맞추기 위해 길이가 자동 조정되는 직선
// ['C', 각도, 반경] 코너, 각도 'auto'는 전체 회전이 360이 되도록 자동 계산
export const TRACKS = [
  {
    id: 'albion',
    name: '알비온 파크',
    place: '잉글랜드풍 · 고속 서킷',
    blurb: '빠른 연속 코너와 긴 직선. 다운포스의 맛을 제대로 느낄 수 있는 클래식 서킷.',
    width: 14,
    runoff: 20,
    startAt: 480,
    pitSide: 1,
    drs: [0, 15],
    laps: 5,
    theme: 'meadow',
    cmds: [
      ['S', 950],
      ['C', 85, 100],
      ['S', 60],
      ['C', -30, 120],
      ['C', 95, 38],
      ['C', -85, 40],
      ['S', 380, 'adj'],
      ['C', 70, 60],
      ['C', 45, 45],
      ['S', 300],
      ['C', 30, 260],
      ['S', 180],
      ['C', -55, 150],
      ['C', 70, 120],
      ['C', -50, 140],
      ['S', 700, 'adj'],
      ['C', 80, 110],
      ['S', 220],
      ['C', -30, 80],
      ['C', 60, 50],
      ['S', 200],
      ['C', 'auto', 120],
    ],
  },
  {
    id: 'riviera',
    name: '리비에라 시가지',
    place: '지중해풍 · 시가지 서킷',
    blurb: '벽이 코앞에 있는 좁은 시가지. 헤어핀과 터널, 추월이 어려워 예선이 전부다.',
    width: 12,
    runoff: 2.5,
    street: true,
    startAt: 300,
    pitSide: 1,
    drs: [0],
    tunnel: [14, 16],
    laps: 5,
    theme: 'riviera',
    cmds: [
      ['S', 600],
      ['C', 90, 20],
      ['S', 180],
      ['C', -60, 50],
      ['C', 70, 25],
      ['S', 80],
      ['C', 80, 16],
      ['S', 50],
      ['C', -180, 14],
      ['S', 40],
      ['C', 90, 16],
      ['S', 50],
      ['C', 90, 18],
      ['S', 100, 'adj'],
      ['C', 20, 300],
      ['S', 90],
      ['C', -60, 16],
      ['C', 60, 18],
      ['S', 60],
      ['C', -20, 60],
      ['S', 60],
      ['C', -40, 25],
      ['C', 40, 25],
      ['S', 40],
      ['C', 40, 22],
      ['C', -40, 22],
      ['S', 40],
      ['C', 90, 16],
      ['S', 150, 'adj'],
      ['C', 'auto', 25],
    ],
  },
  {
    id: 'parco',
    name: '파르코 벨로체',
    place: '이탈리아풍 · 초고속 서킷',
    blurb: '스피드의 신전. 긴 직선과 시케인, 슬립스트림과 DRS로 추월하는 서킷.',
    width: 14,
    runoff: 22,
    startAt: 560,
    pitSide: 1,
    drs: [0, 13],
    laps: 5,
    theme: 'park',
    cmds: [
      ['S', 1100],
      ['C', 70, 16],
      ['S', 15],
      ['C', -70, 18],
      ['S', 120],
      ['C', 35, 350],
      ['S', 150, 'adj'],
      ['C', -50, 22],
      ['C', 50, 22],
      ['S', 60],
      ['C', 70, 60],
      ['S', 60],
      ['C', 75, 50],
      ['S', 600],
      ['C', -35, 50],
      ['C', 70, 70],
      ['C', -25, 90],
      ['S', 900, 'adj'],
      ['C', 100, 60],
      ['C', 'auto', 150],
    ],
  },
  {
    id: 'sakura',
    name: '사쿠라 힐스',
    place: '일본풍 · 테크니컬 서킷',
    blurb: '리듬을 타야 하는 S자 연속 코너와 헤어핀. 드라이버의 실력이 가장 잘 드러난다.',
    width: 13,
    runoff: 16,
    startAt: 400,
    pitSide: 1,
    drs: [0, 13],
    laps: 5,
    theme: 'sakura',
    cmds: [
      ['S', 780],
      ['C', 60, 100],
      ['C', 40, 70],
      ['S', 80],
      ['C', -55, 60],
      ['C', 70, 60],
      ['C', -70, 60],
      ['C', 55, 65],
      ['C', -55, 150],
      ['S', 150],
      ['C', 55, 55],
      ['S', 60],
      ['C', 80, 45],
      ['S', 450, 'adj'],
      ['C', 170, 25],
      ['S', 80],
      ['C', -90, 150],
      ['S', 250, 'adj'],
      ['C', -20, 130],
      ['C', 70, 14],
      ['C', -70, 14],
      ['S', 150],
      ['C', 'auto', 80],
    ],
  },
  {
    id: 'oasis',
    name: '오아시스 나이트',
    place: '사막풍 · 야간 레이스',
    blurb: '조명 아래 사막을 달리는 야간 레이스. 강한 제동과 트랙션이 승부를 가른다.',
    width: 15,
    runoff: 24,
    startAt: 520,
    pitSide: 1,
    drs: [0, 15],
    laps: 5,
    theme: 'desert',
    cmds: [
      ['S', 1000],
      ['C', 100, 22],
      ['C', -30, 80],
      ['C', 25, 120],
      ['S', 450, 'adj'],
      ['C', 90, 35],
      ['S', 120],
      ['C', -40, 60],
      ['C', 45, 60],
      ['C', -30, 70],
      ['S', 150],
      ['C', 150, 20],
      ['S', 100],
      ['C', -60, 40],
      ['C', -30, 30],
      ['S', 300],
      ['C', -80, 90],
      ['C', 70, 80],
      ['S', 300, 'adj'],
      ['C', 85, 40],
      ['S', 250],
      ['C', 20, 150],
      ['C', 'auto', 30],
    ],
  },
  {
    id: 'maple',
    name: '메이플 아일랜드',
    place: '캐나다풍 · 섬 서킷',
    blurb: '물로 둘러싸인 섬 위의 스톱앤고 서킷. 마지막 시케인의 벽을 조심하라.',
    width: 13,
    runoff: 5,
    startAt: 350,
    pitSide: 1,
    drs: [0, 15],
    laps: 5,
    theme: 'island',
    cmds: [
      ['S', 800],
      ['C', -40, 40],
      ['C', 200, 22],
      ['S', 150],
      ['C', -40, 60],
      ['C', 40, 60],
      ['S', 400, 'adj'],
      ['C', 30, 120],
      ['S', 200],
      ['C', 45, 40],
      ['C', -45, 40],
      ['S', 500],
      ['C', 25, 200],
      ['S', 150],
      ['C', 165, 17],
      ['S', 1100, 'adj'],
      ['C', 40, 20],
      ['C', -60, 20],
      ['S', 100],
      ['C', 'auto', 200],
    ],
  },
];

// ---------------------------------------------------------------------------
// 터틀 명령을 폐곡선 점열로 변환

const rightN = (h) => [-Math.sin(h), Math.cos(h)];

function resolveCommands(def) {
  const cmds = def.cmds.map((c) => c.slice());
  let sum = 0;
  let autoIdx = -1;
  cmds.forEach((c, i) => {
    if (c[0] === 'C') {
      if (c[1] === 'auto') autoIdx = i;
      else sum += c[1];
    }
  });
  const target = def.ccw ? -360 : 360;
  if (autoIdx >= 0) cmds[autoIdx][1] = target - sum;

  // 각 명령 시작 heading과 고정 변위 합 계산
  let h = 0;
  let fx = 0;
  let fz = 0;
  const adj = [];
  for (const c of cmds) {
    if (c[0] === 'S') {
      if (c[2] === 'adj') adj.push({ c, h });
      else {
        fx += c[1] * Math.cos(h);
        fz += c[1] * Math.sin(h);
      }
    } else {
      const a = c[1] * DEG;
      const R = c[2];
      const n0 = rightN(h);
      const n1 = rightN(h + a);
      const sg = Math.sign(a);
      fx += sg * R * (n0[0] - n1[0]);
      fz += sg * R * (n0[1] - n1[1]);
      h += a;
    }
  }
  if (adj.length === 2) {
    // la*ua + lb*ub = -F
    const ua = [Math.cos(adj[0].h), Math.sin(adj[0].h)];
    const ub = [Math.cos(adj[1].h), Math.sin(adj[1].h)];
    const det = ua[0] * ub[1] - ua[1] * ub[0];
    const la = (-fx * ub[1] + fz * ub[0]) / det;
    const lb = (-fz * ua[0] + fx * ua[1]) / det;
    adj[0].c[1] = la;
    adj[1].c[1] = lb;
  }
  return cmds;
}

function traceCommands(cmds, step = 0.5) {
  const pts = [];
  const cmdStart = [];
  let x = 0;
  let z = 0;
  let h = 0;
  let arc = 0;
  for (const c of cmds) {
    cmdStart.push(arc);
    if (c[0] === 'S') {
      const n = Math.max(1, Math.round(c[1] / step));
      const st = c[1] / n;
      for (let k = 0; k < n; k++) {
        pts.push([x, z]);
        x += Math.cos(h) * st;
        z += Math.sin(h) * st;
        arc += st;
      }
    } else {
      const a = c[1] * DEG;
      const R = c[2];
      const len = Math.abs(a) * R;
      const n = Math.max(1, Math.round(len / step));
      const sg = Math.sign(a);
      const nr = rightN(h);
      const cx = x + sg * R * nr[0];
      const cz = z + sg * R * nr[1];
      for (let k = 0; k < n; k++) {
        pts.push([x, z]);
        const hh = h + (a * (k + 1)) / n;
        const n1 = rightN(hh);
        x = cx - sg * R * n1[0];
        z = cz - sg * R * n1[1];
        arc += len / n;
      }
      h += a;
    }
  }
  return { pts, cmdStart, total: arc, closeErr: Math.hypot(x, z) };
}

// 폐곡선 이동평균 (코너 진입/탈출을 부드럽게)
function smoothLoop(pts, half) {
  const n = pts.length;
  const out = new Array(n);
  let wsum = 0;
  for (let k = -half; k <= half; k++) wsum += half + 1 - Math.abs(k);
  for (let i = 0; i < n; i++) {
    let sx = 0;
    let sz = 0;
    for (let k = -half; k <= half; k++) {
      const w = half + 1 - Math.abs(k);
      const p = pts[(i + k + n) % n];
      sx += p[0] * w;
      sz += p[1] * w;
    }
    out[i] = [sx / wsum, sz / wsum];
  }
  return out;
}

function resample(pts, ds) {
  const n = pts.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const total = cum[n];
  const N = Math.round(total / ds);
  const step = total / N;
  const out = [];
  let j = 0;
  for (let k = 0; k < N; k++) {
    const t = k * step;
    while (cum[j + 1] < t) j++;
    const a = pts[j];
    const b = pts[(j + 1) % n];
    const f = (t - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push([lerp(a[0], b[0], f), lerp(a[1], b[1], f)]);
  }
  return { out, step, total };
}

// ---------------------------------------------------------------------------

export function buildTrack(def) {
  const cmds = resolveCommands(def);
  const traced = traceCommands(cmds);
  const smoothed = smoothLoop(smoothLoop(traced.pts, 16), 16);
  const { out, step } = resample(smoothed, DS);

  // 원본 호 길이 위치 -> 원본 좌표
  const arcPoint = (arc) => {
    const i = clamp(Math.round(arc / 0.5), 0, traced.pts.length - 1);
    return traced.pts[i];
  };
  const nearestIdx = (p) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < out.length; i++) {
      const d = (out[i][0] - p[0]) ** 2 + (out[i][1] - p[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };

  // 출발선이 인덱스 0이 되도록 회전
  const startIdx = nearestIdx(arcPoint(def.startAt));
  const N = out.length;
  const px = new Float32Array(N);
  const pz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = out[(i + startIdx) % N];
    px[i] = p[0];
    pz[i] = p[1];
  }
  const L = N * step;
  const ds = step;
  const sOfArc = (arc) => ((nearestIdx(arcPoint(arc)) - startIdx + N) % N) * ds;
  const cmdS = traced.cmdStart.map(sOfArc);
  const cmdEndS = traced.cmdStart.map((a, i) => sOfArc(i + 1 < cmds.length ? traced.cmdStart[i + 1] : traced.total - 0.5));

  // 접선, 법선, 곡률
  const tx = new Float32Array(N);
  const tz = new Float32Array(N);
  const nx = new Float32Array(N);
  const nz = new Float32Array(N);
  const head = new Float32Array(N);
  const curv = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N;
    const b = (i + 1) % N;
    let dx = px[b] - px[a];
    let dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    tx[i] = dx;
    tz[i] = dz;
    nx[i] = -dz;
    nz[i] = dx;
    head[i] = Math.atan2(dz, dx);
  }
  for (let i = 0; i < N; i++) {
    const a = (i - 2 + N) % N;
    const b = (i + 2) % N;
    let dh = head[b] - head[a];
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    curv[i] = dh / (4 * ds);
  }

  const w = def.width;
  const half = w / 2;

  // 다른 구간과의 간격 (좌/우)
  const clearR = new Float32Array(N).fill(999);
  const clearL = new Float32Array(N).fill(999);
  const cell = 40;
  const grid = new Map();
  const key = (cx, cz) => cx * 73856093 + cz * 19349663;
  for (let i = 0; i < N; i++) {
    const k = key(Math.floor(px[i] / cell), Math.floor(pz[i] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  for (let i = 0; i < N; i++) {
    const cx = Math.floor(px[i] / cell);
    const cz = Math.floor(pz[i] / cell);
    for (let ox = -3; ox <= 3; ox++) {
      for (let oz = -3; oz <= 3; oz++) {
        const list = grid.get(key(cx + ox, cz + oz));
        if (!list) continue;
        for (const j of list) {
          if (Math.abs(wrapDist((j - i) * ds, L)) < 150) continue;
          const vx = px[j] - px[i];
          const vz = pz[j] - pz[i];
          const d = Math.hypot(vx, vz);
          if (d > 130) continue;
          if (vx * nx[i] + vz * nz[i] > 0) clearR[i] = Math.min(clearR[i], d);
          else clearL[i] = Math.min(clearL[i], d);
        }
      }
    }
  }

  // 방호벽까지 거리(트랙 가장자리 기준)
  const pitSide = def.pitSide || 1;
  const pitBefore = Math.min(340, def.startAt - 30);
  const pitAfter = Math.min(320, cmds[0][1] - def.startAt - 30);
  const pit = {
    side: pitSide,
    entry: -pitBefore,
    exit: pitAfter,
    wall: half + 3,
    lane: half + 8,
    laneHalf: 4.5,
    garage: half + 14,
    limit: 105,
    boxes: [],
  };
  const inPitZone = (s) => {
    const r = wrapDist(s, L);
    return r > pit.entry && r < pit.exit;
  };

  const baseRun = def.runoff;
  const runR = new Float32Array(N);
  const runL = new Float32Array(N);
  let minRun = 999;
  for (let i = 0; i < N; i++) {
    const kk = curv[i];
    // 코너 바깥쪽은 여유를 조금 더
    const extraR = kk < -0.004 ? 1.3 : 1;
    const extraL = kk > 0.004 ? 1.3 : 1;
    const availR = (clearR[i] - w) / 2 - 0.8;
    const availL = (clearL[i] - w) / 2 - 0.8;
    runR[i] = Math.min(baseRun * extraR, availR);
    runL[i] = Math.min(baseRun * extraL, availL);
  }
  const erode = (arr, rad) => {
    const o = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let m = 999;
      for (let k = -rad; k <= rad; k++) m = Math.min(m, arr[(i + k + N) % N]);
      o[i] = m;
    }
    return o;
  };
  const blur = (arr, rad) => {
    const o = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) s += arr[(i + k + N) % N];
      o[i] = s / (2 * rad + 1);
    }
    return o;
  };
  let rr = blur(erode(runR, 14), 8);
  let rl = blur(erode(runL, 14), 8);
  for (let i = 0; i < N; i++) {
    // 피트레인 구간은 피트 쪽 방호벽을 차고 앞까지 넓힘
    const s = i * ds;
    const r = wrapDist(s, L);
    const inside = r > pit.entry - 60 && r < pit.exit + 60;
    if (inside) {
      if (pitSide > 0) rr[i] = Math.max(rr[i], pit.garage - half);
      else rl[i] = Math.max(rl[i], pit.garage - half);
    }
    rr[i] = Math.max(rr[i], 1.2);
    rl[i] = Math.max(rl[i], 1.2);
    minRun = Math.min(minRun, Math.min(clearR[i], clearL[i]));
  }

  // 레이싱 라인 (곡률 최소화 근사)
  const lim = half - 1.25;
  const off = new Float32Array(N);
  const P = (i, o) => [px[i] + nx[i] * o, pz[i] + nz[i] * o];
  // 곡률 제곱합 최소화: 5점 가우스-자이델 (멀티스케일)
  for (const stepK of [40, 24, 14, 8, 4, 2, 1]) {
    for (let it = 0; it < 90; it++) {
      for (let i = 0; i < N; i++) {
        const a1 = (i - stepK + N) % N;
        const b1 = (i + stepK) % N;
        const a2 = (i - 2 * stepK + N * 2) % N;
        const b2 = (i + 2 * stepK) % N;
        const p1 = P(a1, off[a1]);
        const q1 = P(b1, off[b1]);
        const p2 = P(a2, off[a2]);
        const q2 = P(b2, off[b2]);
        const mx = (4 * (p1[0] + q1[0]) - (p2[0] + q2[0])) / 6 - px[i];
        const mz = (4 * (p1[1] + q1[1]) - (p2[1] + q2[1])) / 6 - pz[i];
        const o = mx * nx[i] + mz * nz[i];
        off[i] = clamp(lerp(off[i], o, 0.6), -lim, lim);
      }
    }
  }
  const lx = new Float32Array(N);
  const lz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    lx[i] = px[i] + nx[i] * off[i];
    lz[i] = pz[i] + nz[i] * off[i];
  }
  const lineDs = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    lineDs[i] = Math.hypot(lx[j] - lx[i], lz[j] - lz[i]);
  }
  const lineK = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 3 + N) % N;
    const b = (i + 3) % N;
    const ax = lx[a];
    const az = lz[a];
    const bx = lx[i];
    const bz = lz[i];
    const cx = lx[b];
    const cz = lz[b];
    const cr = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    const dab = Math.hypot(bx - ax, bz - az);
    const dbc = Math.hypot(cx - bx, cz - bz);
    const dca = Math.hypot(ax - cx, az - cz);
    lineK[i] = (2 * cr) / (dab * dbc * dca || 1);
  }
  const lineKs = blur(lineK, 2);

  // 피트 박스 위치 (팀 10개)
  const boxFrom = pit.entry + 170;
  const boxTo = pit.exit - 150;
  for (let t = 0; t < 10; t++) pit.boxes.push(boxFrom + ((boxTo - boxFrom) * t) / 9);

  // DRS 구간
  const drs = (def.drs || []).map((ci) => {
    let start = cmdS[ci] + (ci === 0 ? 120 : 70);
    let end = cmdEndS[ci] - 60;
    if (end < start) end += L;
    const detect = start - 170;
    return { start: ((start % L) + L) % L, end: ((end % L) + L) % L, detect: ((detect % L) + L) % L };
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, px[i]);
    maxX = Math.max(maxX, px[i]);
    minZ = Math.min(minZ, pz[i]);
    maxZ = Math.max(maxZ, pz[i]);
  }

  // 연석과 자갈 트랩 (코너 구간)
  const curvS = blur(curv, 10);
  const kerb = new Uint8Array(N);
  const gravelR = new Uint8Array(N);
  const gravelL = new Uint8Array(N);
  const theme = THEMES[def.theme] || THEMES.meadow;
  for (let i = 0; i < N; i++) {
    const k = curvS[i];
    if (Math.abs(k) > 1 / 260) for (let o = -10; o <= 14; o++) kerb[(i + o + N) % N] = 1;
    if (theme.gravel && Math.abs(k) > 1 / 200) {
      const arr = k > 0 ? gravelL : gravelR;
      for (let o = -8; o <= 28; o++) arr[(i + o + N) % N] = 1;
    }
  }
  // 피트 구간 옆에는 자갈 없음
  for (let i = 0; i < N; i++) {
    const r = wrapDist(i * ds, L);
    if (r > pit.entry - 80 && r < pit.exit + 80) {
      gravelR[i] = 0;
      gravelL[i] = 0;
    }
  }

  const track = {
    def,
    theme,
    runoffType: theme.runoff,
    kerb,
    gravelR,
    gravelL,
    id: def.id,
    name: def.name,
    N,
    ds,
    L,
    width: w,
    half,
    px,
    pz,
    tx,
    tz,
    nx,
    nz,
    head,
    curv,
    runR: rr,
    runL: rl,
    clearR,
    clearL,
    off,
    lx,
    lz,
    lineDs,
    lineK: lineKs,
    pit,
    drs,
    cmdS,
    tunnel: def.tunnel ? [cmdS[def.tunnel[0]], cmdS[def.tunnel[1]]] : null,
    sectors: [L / 3, (2 * L) / 3],
    bounds: { minX, maxX, minZ, maxZ },
    minClear: minRun,
    closeErr: traced.closeErr,
    cmds,
    inPitZone,
  };

  track.idx = (s) => {
    const i = Math.floor(s / ds);
    return ((i % N) + N) % N;
  };

  // (s, d) -> 월드 좌표
  track.pointAt = (s, d = 0) => {
    s = ((s % L) + L) % L;
    const f = s / ds;
    const i = Math.floor(f) % N;
    const j = (i + 1) % N;
    const t = f - Math.floor(f);
    const cx = lerp(px[i], px[j], t);
    const cz = lerp(pz[i], pz[j], t);
    let nnx = lerp(nx[i], nx[j], t);
    let nnz = lerp(nz[i], nz[j], t);
    const l = Math.hypot(nnx, nnz) || 1;
    nnx /= l;
    nnz /= l;
    return { x: cx + nnx * d, z: cz + nnz * d, h: Math.atan2(-nnx, nnz) };
  };

  track.sample = (arr, s) => {
    s = ((s % L) + L) % L;
    const f = s / ds;
    const i = Math.floor(f) % N;
    const j = (i + 1) % N;
    return lerp(arr[i], arr[j], f - Math.floor(f));
  };

  // 월드 좌표 -> 트랙 좌표 (hint 주변 탐색)
  track.locate = (x, z, hint = -1) => {
    let best = 0;
    let bd = Infinity;
    if (hint >= 0) {
      for (let k = -40; k <= 40; k++) {
        const i = (hint + k + N) % N;
        const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    }
    if (hint < 0 || bd > 60 * 60) {
      bd = Infinity;
      for (let i = 0; i < N; i++) {
        const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    }
    const vx = x - px[best];
    const vz = z - pz[best];
    const t = clamp(vx * tx[best] + vz * tz[best], -ds, ds);
    const d = vx * nx[best] + vz * nz[best];
    const s = (((best * ds + t) % L) + L) % L;
    return { i: best, s, d };
  };

  // 피트레인 횡방향 위치 (출발선 기준 r)
  track.pitD = (r) => {
    const edge = half - 2.5;
    const E = pit.entry;
    const X = pit.exit;
    const ramp = 150;
    let t = 1;
    if (r < E + ramp) t = clamp((r - E) / ramp, 0, 1);
    else if (r > X - ramp) t = clamp((X - r) / ramp, 0, 1);
    t = t * t * (3 - 2 * t);
    return pitSide * lerp(edge, pit.lane, t);
  };

  track.profile = computeProfile(track, 1, 1);
  track.idealLap = track.profile.lapTime;
  return track;
}

// 레이싱 라인 위의 속도 프로파일
export function computeProfile(track, gripMult = 1, powerMult = 1) {
  const { N, lineKs, lineDs } = track;
  const K = track.lineK || lineKs;
  const v = new Float32Array(N);
  for (let i = 0; i < N; i++) v[i] = Math.min(cornerSpeed(K[i], gripMult), 130);
  for (let pass = 0; pass < 3; pass++) {
    for (let n = 0; n < N; n++) {
      const i = N - 1 - n;
      const j = (i + 1) % N;
      const lim = Math.sqrt(v[j] * v[j] + 2 * brakeAccel(v[j], gripMult) * lineDs[i]);
      if (lim < v[i]) v[i] = lim;
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = driveAccel(v[i], powerMult);
      const lim = Math.sqrt(Math.max(1, v[i] * v[i] + 2 * a * lineDs[i]));
      if (lim < v[j]) v[j] = lim;
    }
  }
  let t = 0;
  let top = 0;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    t += lineDs[i] / ((v[i] + v[j]) / 2);
    top = Math.max(top, v[i]);
  }
  v.lapTime = t;
  v.top = top;
  return v;
}

export { CAR };
