// 오픈휠 머신 3D 모델: 로프트 차체 + 리버리 텍스처(번호·스폰서), 클리어코트 도장

import * as THREE from 'three';
import { SPONSOR_NAMES } from './textures.js';

// 차체 길이 방향 UV 범위 (x = 꼬리 → 노즈)
const X0 = -2.45;
const X1 = 3.05;
const uOf = (x) => (x - X0) / (X1 - X0);

// 단면(초타원)을 x축으로 이은 로프트. 둘레 방향 v: 0=바닥, 0.25=오른쪽, 0.5=위, 0.75=왼쪽
function loft(stations, M = 20, n = 3.2) {
  const pos = [];
  const uv = [];
  const idx = [];
  const R = M + 1;
  for (const [x, w, h, yc, zc = 0] of stations) {
    for (let k = 0; k <= M; k++) {
      const a = -Math.PI / 2 + (k / M) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(x, yc + (h / 2) * Math.sign(s) * Math.pow(Math.abs(s), 2 / n), zc + (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n));
      uv.push(uOf(x), k / M);
    }
  }
  for (let i = 0; i < stations.length - 1; i++) {
    for (let k = 0; k < M; k++) {
      const a = i * R + k;
      const b = a + 1;
      const c = a + R;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // 양 끝 뚜껑
  for (const [si, flip] of [
    [0, false],
    [stations.length - 1, true],
  ]) {
    const [x, , , yc, zc = 0] = stations[si];
    const ci = pos.length / 3;
    pos.push(x, yc, zc);
    uv.push(uOf(x), 0.5);
    const base = si * R;
    for (let k = 0; k < M; k++) flip ? idx.push(ci, base + k + 1, base + k) : idx.push(ci, base + k, base + k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return g;
}

function rod(a, b, r = 0.016) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// 위치/법선/UV를 유지하며 합치기
function merge(list) {
  let count = 0;
  const parts = list.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.attributes.normal) ng.computeVertexNormals();
    count += ng.attributes.position.count;
    return ng;
  });
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

function flipWinding(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i];
    idx[i] = idx[i + 1];
    idx[i + 1] = t;
  }
  g.computeVertexNormals();
  return g;
}

let TEMPLATE = null;

function buildTemplate() {
  // 섀시: 노즈 → 콕핏 → 엔진 커버
  const body = loft([
    [3.03, 0.1, 0.07, 0.23],
    [2.88, 0.2, 0.13, 0.26],
    [2.55, 0.27, 0.19, 0.3],
    [2.05, 0.35, 0.26, 0.35],
    [1.55, 0.46, 0.34, 0.4],
    [1.1, 0.62, 0.42, 0.44],
    [0.72, 0.76, 0.5, 0.47],
    [0.3, 0.82, 0.55, 0.48],
    [-0.1, 0.84, 0.6, 0.5],
    [-0.5, 0.82, 0.66, 0.53],
    [-1.0, 0.7, 0.58, 0.51],
    [-1.5, 0.52, 0.46, 0.47],
    [-2.0, 0.34, 0.34, 0.42],
    [-2.42, 0.18, 0.2, 0.38],
  ]);
  const podStations = [
    [0.76, 0.26, 0.26, 0.4, 0.5],
    [0.62, 0.46, 0.38, 0.4, 0.6],
    [0.2, 0.54, 0.42, 0.4, 0.63],
    [-0.4, 0.5, 0.38, 0.38, 0.6],
    [-1.0, 0.36, 0.28, 0.33, 0.5],
    [-1.62, 0.16, 0.15, 0.27, 0.34],
  ];
  const podR = loft(podStations, 16, 3);
  const podL = flipWinding(loft(podStations.map(([x, w, h, y, z]) => [x, w, h, y, -z]), 16, 3));
  const airbox = loft(
    [
      [0.06, 0.22, 0.24, 0.9],
      [-0.2, 0.3, 0.34, 0.9],
      [-0.8, 0.26, 0.26, 0.82],
      [-1.62, 0.1, 0.1, 0.63],
    ],
    14,
    2.6,
  );
  const livery = merge([body, podR, podL, airbox]);

  const primary = merge([
    // 헤일로
    (() => {
      const g = new THREE.TorusGeometry(0.36, 0.034, 8, 28, Math.PI);
      g.rotateX(Math.PI / 2);
      g.rotateY(Math.PI / 2);
      g.translate(0.3, 0.9, 0);
      return g;
    })(),
    rod([0.66, 0.9, 0], [0.8, 0.7, 0], 0.03),
    rod([-0.05, 0.9, 0.36], [-0.05, 0.72, 0.38], 0.028),
    rod([-0.05, 0.9, -0.36], [-0.05, 0.72, -0.38], 0.028),
    // 리어윙 메인 플레인
    box(0.3, 0.035, 0.94, -2.3, 0.86, 0, 0, 0, 0.12),
    // 프론트윙 플랩
    ...[1, -1].flatMap((s) => [
      box(0.2, 0.022, 0.78, 2.84, 0.15, s * 0.56, -s * 0.1, 0, 0.3),
      box(0.16, 0.02, 0.74, 2.74, 0.2, s * 0.58, -s * 0.14, 0, 0.52),
    ]),
  ]);

  const accent = merge([
    // 프론트윙 엔드플레이트
    box(0.5, 0.24, 0.022, 2.78, 0.19, 0.985),
    box(0.5, 0.24, 0.022, 2.78, 0.19, -0.985),
    // 프론트윙 최상단 플랩
    ...[1, -1].map((s) => box(0.14, 0.018, 0.7, 2.66, 0.25, s * 0.6, -s * 0.18, 0, 0.72)),
    // 에어박스 흡기구 테두리
    box(0.05, 0.05, 0.26, 0.08, 1.03, 0),
  ]);

  const carbon = merge([
    // 플로어와 에지
    box(3.3, 0.035, 1.76, -0.32, 0.06, 0),
    box(0.9, 0.03, 1.2, 1.55, 0.05, 0),
    ...[1, -1].map((s) => box(2.6, 0.1, 0.05, -0.55, 0.1, s * 0.88)),
    // 디퓨저
    box(0.55, 0.22, 1.1, -2.05, 0.15, 0, 0, 0, -0.4),
    // 프론트윙 메인 플레인 + 노즈 파일런
    box(0.36, 0.028, 1.96, 2.93, 0.1, 0, 0, 0, 0.08),
    box(0.3, 0.12, 0.03, 2.86, 0.18, 0.1),
    box(0.3, 0.12, 0.03, 2.86, 0.18, -0.1),
    // 빔윙, 스완넥 파일런, 샤크핀
    box(0.22, 0.03, 0.9, -2.2, 0.44, 0, 0, 0, 0.2),
    box(0.06, 0.4, 0.04, -2.22, 0.66, 0),
    box(1.2, 0.26, 0.018, -1.6, 0.86, 0),
    // 사이드포드 흡기구, 에어박스 흡기구
    ...[1, -1].map((s) => box(0.03, 0.26, 0.22, 0.765, 0.4, s * 0.5)),
    box(0.03, 0.18, 0.2, 0.075, 0.92, 0),
    // 미러
    ...[1, -1].flatMap((s) => [box(0.1, 0.07, 0.16, 0.62, 0.8, s * 0.56), rod([0.66, 0.58, s * 0.5], [0.62, 0.78, s * 0.56], 0.012)]),
    // 서스펜션 (위시본, 푸시로드)
    ...[1, -1].flatMap((s) => [
      rod([1.72, 0.47, s * 0.22], [1.86, 0.5, s * 0.66]),
      rod([2.08, 0.45, s * 0.2], [1.86, 0.5, s * 0.66]),
      rod([1.7, 0.27, s * 0.22], [1.86, 0.22, s * 0.66]),
      rod([2.12, 0.27, s * 0.18], [1.86, 0.22, s * 0.66]),
      rod([1.86, 0.24, s * 0.62], [1.98, 0.47, s * 0.26]),
      rod([-1.52, 0.46, s * 0.3], [-1.72, 0.52, s * 0.62]),
      rod([-1.95, 0.46, s * 0.24], [-1.72, 0.52, s * 0.62]),
      rod([-1.48, 0.24, s * 0.3], [-1.72, 0.2, s * 0.62]),
      rod([-1.96, 0.24, s * 0.24], [-1.72, 0.2, s * 0.62]),
      rod([1.86, 0.5, s * 0.66], [1.86, 0.36, s * 0.6], 0.03),
      rod([-1.72, 0.52, s * 0.62], [-1.72, 0.36, s * 0.58], 0.03),
    ]),
    // 운전대 (콕핏 카메라에서 보임)
    box(0.04, 0.12, 0.28, 0.58, 0.8, 0, 0, 0, -0.35),
    box(0.05, 0.14, 0.06, 0.58, 0.8, 0.15, 0, 0, -0.35),
    box(0.05, 0.14, 0.06, 0.58, 0.8, -0.15, 0, 0, -0.35),
  ]);

  const endplates = merge([box(0.62, 0.56, 0.03, -2.33, 0.72, 0.485), box(0.62, 0.56, 0.03, -2.33, 0.72, -0.485)]);

  const helmet = new THREE.SphereGeometry(0.135, 20, 14);
  helmet.translate(0.18, 0.9, 0);
  const visor = new THREE.SphereGeometry(0.139, 20, 6, Math.PI - 0.95, 1.9, 1.15, 0.42);
  visor.translate(0.18, 0.9, 0);

  const flap = new THREE.BoxGeometry(0.22, 0.03, 0.93);
  flap.translate(-0.11, 0, 0);
  const tcam = box(0.1, 0.05, 0.18, -0.05, 1.1, 0);
  const light = box(0.03, 0.07, 0.14, -2.45, 0.46, 0);
  const screen = box(0.01, 0.06, 0.1, 0.565, 0.82, 0, 0, 0, -0.35);

  const wheelF = new THREE.CylinderGeometry(0.36, 0.36, 0.36, 32, 1);
  wheelF.rotateX(Math.PI / 2);
  const wheelR = new THREE.CylinderGeometry(0.36, 0.36, 0.44, 32, 1);
  wheelR.rotateX(Math.PI / 2);
  const shadow = new THREE.PlaneGeometry(6.2, 2.5);
  shadow.rotateX(-Math.PI / 2);

  TEMPLATE = { livery, primary, accent, carbon, endplates, helmet, visor, flap, tcam, light, screen, wheelF, wheelR, shadow };
  return TEMPLATE;
}

// ---------------------------------------------------------------------------
// 텍스처

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// 리버리: 가로 = 차체 길이(꼬리→노즈), 세로 = 둘레 (위쪽 절반이 v 0.5~1)
function liveryTexture(team, number) {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const X = (x) => uOf(x) * W;
  const Y = (v) => (1 - v) * H;
  g.fillStyle = team.color;
  g.fillRect(0, 0, W, H);
  // 바닥 쪽 카본
  g.fillStyle = '#16181c';
  g.fillRect(0, Y(0.13), W, H);
  g.fillRect(0, 0, W, Y(0.87));
  // 옆면 액센트 스우시 (오른쪽, 왼쪽은 대칭)
  const swoosh = (vc, dir) => {
    g.fillStyle = team.accent;
    g.beginPath();
    g.moveTo(X(2.9), Y(vc - dir * 0.02));
    g.lineTo(X(1.2), Y(vc - dir * 0.08));
    g.lineTo(X(-0.6), Y(vc - dir * 0.1));
    g.lineTo(X(-2.3), Y(vc - dir * 0.04));
    g.lineTo(X(-2.3), Y(vc - dir * 0.12));
    g.lineTo(X(-0.6), Y(vc - dir * 0.13));
    g.lineTo(X(1.2), Y(vc - dir * 0.1));
    g.lineTo(X(2.9), Y(vc - dir * 0.04));
    g.closePath();
    g.fill();
    g.fillStyle = team.trim;
    g.fillRect(X(-2.2), Y(vc - dir * 0.135) - 1, X(1.0) - X(-2.2), 2);
  };
  swoosh(0.25, 1);
  swoosh(0.75, -1);
  // 윗면 센터 스트라이프
  g.fillStyle = team.accent;
  g.fillRect(0, Y(0.515), W, Y(0.485) - Y(0.515));
  g.fillStyle = team.trim;
  g.fillRect(0, Y(0.53), W, 1.5);
  g.fillRect(0, Y(0.47), W, 1.5);
  // 콕핏 개구부
  g.fillStyle = '#0b0c0f';
  g.beginPath();
  g.ellipse(X(0.28), Y(0.5), X(0.72) - X(0.28), (Y(0.44) - Y(0.56)) / 2, 0, 0, Math.PI * 2);
  g.fill();

  const text = (str, x, v, size, color, rot = false, font = '900') => {
    g.save();
    g.translate(X(x), Y(v));
    if (rot) g.rotate(Math.PI);
    g.font = `italic ${font} ${size}px Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = Math.max(2, size / 7);
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.strokeText(str, 0, 0);
    g.fillStyle = color;
    g.fillText(str, 0, 0);
    g.restore();
  };
  const sponsor = SPONSOR_NAMES[(team.id.length * 7 + team.color.length) % SPONSOR_NAMES.length];
  // 오른쪽 (정방향), 왼쪽 (180도 회전해야 바깥에서 바로 읽힘)
  for (const [v, rot] of [
    [0.26, false],
    [0.74, true],
  ]) {
    text(String(number), 2.05, v, 30, '#ffffff', rot);
    text(team.short, -0.35, v, 22, team.trim, rot);
    text(sponsor, -1.45, v + (rot ? 0.02 : -0.02), 13, '#ffffff', rot, '800');
  }
  // 노즈 윗면 번호
  g.save();
  g.translate(X(2.45), Y(0.5));
  g.rotate(-Math.PI / 2);
  g.font = 'italic 900 22px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText(String(number), 0, 0);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function endplateTexture(team) {
  const [c, g] = canvas(256, 128);
  g.fillStyle = team.color;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = team.accent;
  g.fillRect(0, 88, 256, 40);
  g.font = 'italic 900 44px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = team.trim;
  g.fillText(team.short, 128, 48, 236);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let tyreMats = null;
function tyreMaterials() {
  if (tyreMats) return tyreMats;
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#151515';
  g.fillRect(0, 0, 256, 256);
  // 사이드월 브랜드 문자
  g.font = '900 22px Arial, sans-serif';
  g.fillStyle = '#e8e8e8';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const word = 'ZENITH  ·  ZENITH  ·  ';
  for (let i = 0; i < word.length; i++) {
    const a = (i / word.length) * Math.PI * 2;
    g.save();
    g.translate(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108);
    g.rotate(a + Math.PI / 2);
    g.fillText(word[i], 0, 0);
    g.restore();
  }
  g.strokeStyle = '#f2c318';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(128, 128, 94, 0, Math.PI * 2);
  g.stroke();
  // 휠 커버
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 84);
  grd.addColorStop(0, '#6d737c');
  grd.addColorStop(0.7, '#3a3e45');
  grd.addColorStop(1, '#23262b');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(128, 128, 84, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 6;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 20, 128 + Math.sin(a) * 20);
    g.lineTo(128 + Math.cos(a) * 80, 128 + Math.sin(a) * 80);
    g.stroke();
  }
  g.fillStyle = '#c9ced6';
  g.beginPath();
  g.arc(128, 128, 14, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const side = new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, metalness: 0.1 });
  const tread = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
  tyreMats = [tread, side, side];
  return tyreMats;
}

let shadowTex = null;
function shadowTexture() {
  if (shadowTex) return shadowTex;
  const [c, g] = canvas(64, 32);
  const grd = g.createRadialGradient(32, 16, 2, 32, 16, 31);
  grd.addColorStop(0, 'rgba(0,0,0,0.8)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.45)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 32);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

const teamMats = new Map();
function materialsFor(team, envMap, physical) {
  const key = team.id + (physical ? 'p' : '');
  if (teamMats.has(key)) return teamMats.get(key);
  const Paint = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const gloss = physical ? { clearcoat: 1, clearcoatRoughness: 0.06 } : {};
  const paint = (hex) => new Paint({ color: hex, metalness: 0.1, roughness: 0.38, envMap, envMapIntensity: 0.75, ...gloss });
  const m = {
    primary: paint(team.color),
    accent: paint(team.accent),
    carbon: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.35, roughness: 0.42, envMap, envMapIntensity: 0.7 }),
    endplate: new Paint({ map: endplateTexture(team), metalness: 0.2, roughness: 0.35, envMap, ...gloss }),
    helmet: paint(team.trim),
    visor: new THREE.MeshStandardMaterial({ color: 0x0c0d10, metalness: 0.9, roughness: 0.08, envMap, envMapIntensity: 1.4 }),
    light: new THREE.MeshBasicMaterial({ color: 0x330000 }),
    screen: new THREE.MeshBasicMaterial({ color: 0x3fd6ff }),
  };
  teamMats.set(key, m);
  return m;
}

const liveryMats = [];
export function resetCarMaterials() {
  for (const m of teamMats.values()) Object.values(m).forEach((x) => (x.map && x.map.dispose(), x.dispose()));
  teamMats.clear();
  for (const m of liveryMats) {
    m.map.dispose();
    m.dispose();
  }
  liveryMats.length = 0;
}

export function createCar(team, envMap, { shadows = false, tcamYellow = false, number = 1, physical = false } = {}) {
  const T = TEMPLATE || buildTemplate();
  const M = materialsFor(team, envMap, physical);
  const Paint = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const liveryMat = new Paint({
    map: liveryTexture(team, number),
    metalness: 0.1,
    roughness: 0.36,
    envMap,
    envMapIntensity: 0.75,
    ...(physical ? { clearcoat: 0.8, clearcoatRoughness: 0.08 } : {}),
  });
  liveryMats.push(liveryMat);
  const root = new THREE.Group();
  const add = (geo, mat, parent = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadows;
    parent.add(m);
    return m;
  };
  add(T.livery, liveryMat);
  add(T.primary, M.primary);
  add(T.accent, M.accent);
  add(T.carbon, M.carbon);
  add(T.endplates, M.endplate);
  const helmet = add(T.helmet, M.helmet);
  const visor = add(T.visor, M.visor);
  add(T.tcam, tcamYellow ? new THREE.MeshStandardMaterial({ color: 0xf4e300, roughness: 0.4 }) : M.carbon);
  add(T.screen, M.screen);
  const lightMesh = new THREE.Mesh(T.light, M.light.clone());
  root.add(lightMesh);

  const flapPivot = new THREE.Group();
  flapPivot.position.set(-2.18, 0.97, 0);
  add(T.flap, M.primary, flapPivot);
  root.add(flapPivot);

  const wheels = [];
  const tm = tyreMaterials();
  for (const [x, z, front] of [
    [1.86, 0.8, true],
    [1.86, -0.8, true],
    [-1.72, 0.78, false],
    [-1.72, -0.78, false],
  ]) {
    const steer = new THREE.Group();
    steer.position.set(x, 0.36, z);
    const w = new THREE.Mesh(front ? T.wheelF : T.wheelR, tm);
    w.castShadow = shadows;
    steer.add(w);
    root.add(steer);
    wheels.push({ steer, mesh: w, front });
  }

  const shadow = new THREE.Mesh(T.shadow, new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.9 }));
  shadow.position.y = 0.03;
  shadow.renderOrder = 1;
  root.add(shadow);

  return { root, wheels, flapPivot, helmet, visor, lightMesh, shadow, spin: 0, compound: 'M' };
}

// 타이어 컴파운드 구분은 없어졌지만 호출부 호환을 위해 유지
export function setCarCompound() {}
