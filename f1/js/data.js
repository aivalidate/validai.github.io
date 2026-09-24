// 팀, 드라이버, 타이어, 차량 성능 등 게임 데이터 (모두 가상의 팀/선수)

export const G = 9.81;

// 오픈휠 머신 기본 물리값 (약 1000마력, 800kg, 강한 다운포스)
export const CAR = {
  mass: 800,
  power: 735000, // W
  dragC: 0.84, // 공기저항 계수 (N/(m/s)^2)
  drsDrag: 0.87, // DRS 개방 시 공기저항 배율
  slipDrag: 0.8, // 슬립스트림 안에서의 공기저항 배율
  roll: 0.012, // 구름저항 (g 배율)
  downK: 0.0021, // 다운포스 (속도^2 당 추가 g)
  muLat: 1.55, // 횡방향 그립
  muLong: 1.25, // 가속 트랙션
  muBrake: 1.72, // 제동 그립
  wheelbase: 3.6,
  maxSteer: 0.36, // rad
  length: 5.6,
  width: 2.0,
};

export const gripAccel = (v, mu) => mu * (G + CAR.downK * v * v);
export const dragAccel = (v, mult = 1) => (CAR.dragC * mult * v * v) / CAR.mass;

export function driveAccel(v, powerMult = 1, dragMult = 1) {
  const trac = gripAccel(v, CAR.muLong);
  const eng = (CAR.power * powerMult) / (CAR.mass * Math.max(v, 4));
  return Math.min(trac, eng) - dragAccel(v, dragMult) - CAR.roll * G;
}

export function brakeAccel(v, gripMult = 1) {
  return gripAccel(v, CAR.muBrake * gripMult) + dragAccel(v) + CAR.roll * G;
}

// 곡률 k(1/m)에서 낼 수 있는 최대 코너링 속도
export function cornerSpeed(k, gripMult = 1) {
  k = Math.abs(k);
  if (k < 1e-5) return 999;
  const R = 1 / k;
  const mu = CAR.muLat * gripMult;
  const den = 1 - R * mu * CAR.downK;
  if (den <= 0.02) return 999;
  return Math.sqrt((R * mu * G) / den);
}

// 타이어 컴파운드
export const COMPOUNDS = {
  S: { id: 'S', name: '소프트', color: '#e8322b', grip: 1.035, wear: 1.0 },
  M: { id: 'M', name: '미디엄', color: '#f2c318', grip: 1.0, wear: 0.62 },
  H: { id: 'H', name: '하드', color: '#eceff2', grip: 0.972, wear: 0.42 },
};

// 마모(0..1)에 따른 그립 배율. 80%를 넘으면 급격히 떨어진다.
export function tireGrip(compound, wear) {
  const c = COMPOUNDS[compound];
  let g = c.grip * (1 - 0.06 * wear - 0.05 * wear * wear);
  if (wear > 0.8) g -= (wear - 0.8) * 0.9;
  return Math.max(0.6, g);
}

// 가상의 10개 팀 (실제 팀과 무관)
export const TEAMS = [
  { id: 'taurus', name: '타우루스 레이싱', short: 'TAURUS', color: '#1d2b6b', accent: '#e4202e', trim: '#f5c400', perf: 1.0 },
  { id: 'apex', name: '에이펙스 오렌지', short: 'APEX', color: '#ff7a00', accent: '#1b8cff', trim: '#16181d', perf: 0.998 },
  { id: 'rosso', name: '로쏘 벨로체', short: 'ROSSO', color: '#d0141c', accent: '#ffd200', trim: '#ffffff', perf: 0.995 },
  { id: 'argento', name: '스텔라 아르젠토', short: 'ARGENTO', color: '#b9c3cc', accent: '#00b3a4', trim: '#101418', perf: 0.993 },
  { id: 'emerald', name: '에메랄드 GP', short: 'EMERALD', color: '#0b5a46', accent: '#c6f24e', trim: '#ffffff', perf: 0.984 },
  { id: 'azure', name: '아쥬르 블랑', short: 'AZURE', color: '#1066d6', accent: '#ff5fb2', trim: '#ffffff', perf: 0.977 },
  { id: 'grove', name: '그로브 레이싱', short: 'GROVE', color: '#0d2c78', accent: '#20c5f0', trim: '#ffffff', perf: 0.975 },
  { id: 'vortex', name: '보텍스 RB', short: 'VORTEX', color: '#e9edf5', accent: '#2945ff', trim: '#ff2338', perf: 0.978 },
  { id: 'frontier', name: '프론티어 모터스포츠', short: 'FRONTIER', color: '#f1f1f1', accent: '#1a1a1a', trim: '#d6001c', perf: 0.97 },
  { id: 'kinetik', name: '키네틱 레이싱', short: 'KINETIK', color: '#1b1f22', accent: '#3be35a', trim: '#ffffff', perf: 0.966 },
];

// 가상의 드라이버 (팀당 2명, skill: 드라이버 실력 배율)
export const DRIVERS = [
  { name: '니코 반덴버그', code: 'VDB', team: 'taurus', num: 3, skill: 1.0 },
  { name: '라파엘 오르테가', code: 'ORT', team: 'taurus', num: 14, skill: 0.992 },
  { name: '올리버 브란트', code: 'BRA', team: 'apex', num: 7, skill: 0.998 },
  { name: '카이 내쉬', code: 'NAS', team: 'apex', num: 21, skill: 0.995 },
  { name: '루카 페라로', code: 'FER', team: 'rosso', num: 16, skill: 0.997 },
  { name: '아드리앙 모로', code: 'MOR', team: 'rosso', num: 55, skill: 0.994 },
  { name: '요나스 켈러', code: 'KEL', team: 'argento', num: 44, skill: 0.998 },
  { name: '테오 하틀리', code: 'HAR', team: 'argento', num: 12, skill: 0.99 },
  { name: '사무엘 그랜트', code: 'GRA', team: 'emerald', num: 18, skill: 0.99 },
  { name: '마테오 실바', code: 'SIL', team: 'emerald', num: 5, skill: 0.986 },
  { name: '줄리앙 라플뢰르', code: 'LAF', team: 'azure', num: 10, skill: 0.99 },
  { name: '안데르스 스벤손', code: 'SVE', team: 'azure', num: 31, skill: 0.986 },
  { name: '김다니엘', code: 'KIM', team: 'grove', num: 23, skill: 0.992 },
  { name: '캘럼 와일드', code: 'WIL', team: 'grove', num: 2, skill: 0.984 },
  { name: '렌 오카다', code: 'OKA', team: 'vortex', num: 22, skill: 0.99 },
  { name: '엘리오 프리에토', code: 'PRI', team: 'vortex', num: 30, skill: 0.985 },
  { name: '이반 노박', code: 'NOV', team: 'frontier', num: 20, skill: 0.988 },
  { name: '톰 배럿', code: 'BAR', team: 'frontier', num: 87, skill: 0.985 },
  { name: '디에고 코스타', code: 'COS', team: 'kinetik', num: 27, skill: 0.988 },
  { name: '해리 애쉬포드', code: 'ASH', team: 'kinetik', num: 77, skill: 0.982 },
];

export const teamById = (id) => TEAMS.find((t) => t.id === id);

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// AI 난이도: pace는 이상적인 주행 대비 비율
export const DIFFICULTY = [
  { id: 0, name: '쉬움', pace: 0.88 },
  { id: 1, name: '보통', pace: 0.92 },
  { id: 2, name: '어려움', pace: 0.955 },
  { id: 3, name: '프로', pace: 0.985 },
];

export const LAP_OPTIONS = [3, 5, 8, 12];
