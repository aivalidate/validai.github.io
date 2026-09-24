// 공용 수학/포맷 유틸리티

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const sign = (v) => (v < 0 ? -1 : 1);

// 각도를 -PI..PI 범위로
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// 원형 트랙 거리 차 (a - b), -L/2..L/2
export function wrapDist(d, L) {
  d %= L;
  if (d > L / 2) d -= L;
  if (d < -L / 2) d += L;
  return d;
}

export function mod(a, n) {
  return ((a % n) + n) % n;
}

// 결정적 난수 (서킷 장식 배치 등에 사용)
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1e9) / 1e9;
  };
}

// 1:23.456 형식
export function fmtTime(t, withMin = true) {
  if (t == null || !isFinite(t)) return '--:--.---';
  const neg = t < 0;
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const ss = s.toFixed(3).padStart(6, '0');
  const out = withMin || m > 0 ? `${m}:${ss}` : s.toFixed(3);
  return neg ? '-' + out : out;
}

export function fmtGap(t) {
  if (t == null || !isFinite(t)) return '';
  return (t >= 0 ? '+' : '-') + Math.abs(t).toFixed(3);
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('fgp.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('fgp.' + key, JSON.stringify(value));
    } catch (e) {
      /* 저장 불가 환경 무시 */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem('fgp.' + key);
    } catch (e) {
      /* 무시 */
    }
  },
};
