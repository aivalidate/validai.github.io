// 오픈휠 머신 3D 모델 (프리미티브와 로프트로 구성, 팀 컬러 리버리)

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';
import { tyreSide } from './textures.js';
import { COMPOUNDS } from './data.js';

// 단면(초타원)을 x축을 따라 이어 붙인 로프트 지오메트리
// stations: [x, 폭, 높이, 중심y, (중심z)]
function loft(stations, M = 14, n = 3.2) {
  const pos = [];
  const idx = [];
  const ring = (st) => {
    const [x, w, h, yc, zc = 0] = st;
    const out = [];
    for (let k = 0; k < M; k++) {
      const a = (k / M) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const z = zc + (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const y = yc + (h / 2) * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      out.push([x, y, z]);
    }
    return out;
  };
  const rings = stations.map(ring);
  rings.forEach((r) => r.forEach((p) => pos.push(...p)));
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < M; k++) {
      const a = i * M + k;
      const b = i * M + ((k + 1) % M);
      const c = (i + 1) * M + k;
      const d = (i + 1) * M + ((k + 1) % M);
      idx.push(a, c, b, b, c, d);
    }
  }
  // 양 끝 막기
  const capA = pos.length / 3;
  const s0 = stations[0];
  pos.push(s0[0], s0[3], s0[4] || 0);
  for (let k = 0; k < M; k++) idx.push(capA, k, (k + 1) % M);
  const capB = pos.length / 3;
  const sl = stations[stations.length - 1];
  const base = (rings.length - 1) * M;
  pos.push(sl[0], sl[3], sl[4] || 0);
  for (let k = 0; k < M; k++) idx.push(capB, base + ((k + 1) % M), base + k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  );
  g.applyMatrix4(m);
  return g;
}

function cyl(r1, r2, len, x, y, z, rx = 0, ry = 0, rz = 0, seg = 10) {
  const g = new THREE.CylinderGeometry(r1, r2, len, seg);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

// 위치/법선만 남기고 합치기
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
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

const mirrorZ = (g) => {
  const c = g.clone();
  c.scale(1, 1, -1);
  // 법선 방향 복구를 위해 면 뒤집기
  const idx = c.index;
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i];
      a[i] = a[i + 1];
      a[i + 1] = t;
    }
  }
  c.computeVertexNormals();
  return c;
};

let TEMPLATE = null;

function buildTemplate() {
  // 메인 섀시 (노즈 → 콕핏 → 엔진 커버)
  const body = loft([
    [2.98, 0.14, 0.08, 0.3],
    [2.75, 0.24, 0.16, 0.32],
    [2.3, 0.32, 0.24, 0.36],
    [1.6, 0.46, 0.36, 0.42],
    [1.0, 0.66, 0.48, 0.46],
    [0.55, 0.8, 0.56, 0.47],
    [0.0, 0.84, 0.58, 0.47],
    [-0.45, 0.86, 0.66, 0.5],
    [-1.1, 0.72, 0.56, 0.48],
    [-1.8, 0.44, 0.4, 0.42],
    [-2.3, 0.22, 0.24, 0.38],
  ]);
  // 사이드포드
  const podR = loft(
    [
      [0.62, 0.34, 0.3, 0.36, 0.56],
      [0.4, 0.52, 0.44, 0.39, 0.6],
      [-0.3, 0.56, 0.46, 0.38, 0.6],
      [-1.0, 0.42, 0.34, 0.33, 0.52],
      [-1.7, 0.22, 0.2, 0.28, 0.4],
    ],
    12,
    3,
  );
  const podL = mirrorZ(podR);
  // 에어박스 & 엔진 커버 상단
  const airbox = loft(
    [
      [0.05, 0.26, 0.26, 0.92],
      [-0.25, 0.34, 0.36, 0.9],
      [-0.9, 0.24, 0.26, 0.8],
      [-1.7, 0.1, 0.12, 0.62],
    ],
    10,
    2.6,
  );
  // 노즈 끝 & 윙 등 액센트
  const primary = merge([body, podR, podL]);

  const accent = merge([
    airbox,
    box(0.5, 0.24, 0.025, 2.72, 0.2, 0.975),
    box(0.5, 0.24, 0.025, 2.72, 0.2, -0.975),
    box(0.55, 0.52, 0.03, -2.35, 0.74, 0.49),
    box(0.55, 0.52, 0.03, -2.35, 0.74, -0.49),
    box(0.26, 0.05, 0.3, 2.9, 0.305, 0),
  ]);

  const carbon = merge([
    // 플로어
    box(3.2, 0.04, 1.72, -0.35, 0.06, 0),
    box(3.0, 0.1, 0.08, -0.4, 0.1, 0.86),
    box(3.0, 0.1, 0.08, -0.4, 0.1, -0.86),
    // 프론트 윙
    box(0.42, 0.03, 1.95, 2.76, 0.1, 0),
    box(0.26, 0.03, 1.9, 2.66, 0.17, 0, 0, 0, 0.35),
    box(0.18, 0.03, 1.86, 2.58, 0.23, 0, 0, 0, 0.55),
    box(0.06, 0.2, 0.04, 2.7, 0.2, 0.12),
    box(0.06, 0.2, 0.04, 2.7, 0.2, -0.12),
    // 리어 윙 메인 플레인 & 빔 윙
    box(0.32, 0.04, 0.96, -2.3, 0.84, 0),
    box(0.22, 0.03, 0.9, -2.2, 0.42, 0),
    box(0.06, 0.42, 0.05, -2.25, 0.62, 0),
    // 디퓨저
    box(0.5, 0.2, 1.1, -2.05, 0.14, 0, 0, 0, -0.35),
    // 샤크핀
    box(1.3, 0.3, 0.02, -1.55, 0.86, 0),
    // 서스펜션 암
    box(0.05, 0.03, 0.62, 1.95, 0.42, 0.5, 0, 0.35, 0.05),
    box(0.05, 0.03, 0.62, 1.95, 0.42, -0.5, 0, -0.35, 0.05),
    box(0.05, 0.03, 0.62, 1.7, 0.3, 0.52, 0, -0.3, 0),
    box(0.05, 0.03, 0.62, 1.7, 0.3, -0.52, 0, 0.3, 0),
    box(0.05, 0.03, 0.55, -1.7, 0.42, 0.55, 0, 0.3, 0),
    box(0.05, 0.03, 0.55, -1.7, 0.42, -0.55, 0, -0.3, 0),
    box(0.05, 0.03, 0.55, -1.85, 0.3, 0.55, 0, -0.2, 0),
    box(0.05, 0.03, 0.55, -1.85, 0.3, -0.55, 0, 0.2, 0),
    // 미러
    box(0.12, 0.06, 0.14, 0.72, 0.84, 0.5),
    box(0.12, 0.06, 0.14, 0.72, 0.84, -0.5),
    box(0.03, 0.12, 0.03, 0.72, 0.77, 0.42),
    box(0.03, 0.12, 0.03, 0.72, 0.77, -0.42),
    // 콕핏 테두리 / 운전대
    box(0.7, 0.05, 0.54, 0.3, 0.77, 0),
    box(0.06, 0.12, 0.24, 0.62, 0.82, 0),
    // 롤후프 흡기구
    box(0.06, 0.2, 0.2, 0.08, 0.93, 0),
  ]);

  // 헤일로
  const halo = merge([
    (() => {
      const g = new THREE.TorusGeometry(0.36, 0.032, 8, 24, Math.PI);
      g.rotateX(Math.PI / 2);
      g.rotateY(Math.PI / 2);
      g.translate(0.3, 0.9, 0);
      return g;
    })(),
    cyl(0.03, 0.035, 0.26, 0.7, 0.82, 0, 0, 0, 0.45),
    cyl(0.025, 0.025, 0.2, -0.03, 0.83, 0.34),
    cyl(0.025, 0.025, 0.2, -0.03, 0.83, -0.34),
  ]);

  const helmet = new THREE.SphereGeometry(0.13, 16, 12);
  helmet.translate(0.18, 0.9, 0);
  const visor = box(0.05, 0.05, 0.18, 0.3, 0.92, 0);

  // DRS 플랩 (회전축 = 앞쪽 모서리)
  const flap = new THREE.BoxGeometry(0.2, 0.03, 0.94);
  flap.translate(-0.1, 0, 0);

  const tcam = box(0.1, 0.05, 0.18, -0.02, 1.08, 0);
  const light = box(0.03, 0.06, 0.12, -2.43, 0.5, 0);

  // 바퀴 (원통 축 = z)
  const wheelF = new THREE.CylinderGeometry(0.36, 0.36, 0.36, 22, 1);
  wheelF.rotateX(Math.PI / 2);
  const wheelR = new THREE.CylinderGeometry(0.36, 0.36, 0.44, 22, 1);
  wheelR.rotateX(Math.PI / 2);
  const shadow = new THREE.PlaneGeometry(6.2, 2.4);
  shadow.rotateX(-Math.PI / 2);

  TEMPLATE = { primary, accent, carbon, halo, helmet, visor, flap, tcam, light, wheelF, wheelR, shadow };
  return TEMPLATE;
}

const tyreMats = {};
function tyreMaterials(compound) {
  if (tyreMats[compound]) return tyreMats[compound];
  const side = new THREE.MeshStandardMaterial({ map: tyreSide(COMPOUNDS[compound].color), roughness: 0.8 });
  const tread = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  tyreMats[compound] = [tread, side, side];
  return tyreMats[compound];
}

let shadowTex = null;
function shadowTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 16, 2, 32, 16, 30);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.save();
  g.scale(1, 0.5);
  g.fillRect(0, 0, 64, 64);
  g.restore();
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 32);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

const teamMats = new Map();
function materialsFor(team, envMap) {
  const key = team.id;
  if (teamMats.has(key)) return teamMats.get(key);
  const paint = (hex) => new THREE.MeshStandardMaterial({ color: hex, metalness: 0.45, roughness: 0.32, envMap, envMapIntensity: 0.9 });
  const m = {
    primary: paint(team.color),
    accent: paint(team.accent),
    carbon: new THREE.MeshStandardMaterial({ color: 0x17191c, metalness: 0.3, roughness: 0.5, envMap, envMapIntensity: 0.5 }),
    halo: new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.6, roughness: 0.35, envMap }),
    helmet: paint(team.trim),
    visor: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.8, roughness: 0.15, envMap }),
    light: new THREE.MeshBasicMaterial({ color: 0x330000 }),
  };
  teamMats.set(key, m);
  return m;
}

export function resetCarMaterials() {
  for (const m of teamMats.values()) Object.values(m).forEach((x) => x.dispose());
  teamMats.clear();
}

export function createCar(team, envMap, { shadows = false, tcamYellow = false } = {}) {
  const T = TEMPLATE || buildTemplate();
  const M = materialsFor(team, envMap);
  const root = new THREE.Group();
  const add = (geo, mat, parent = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadows;
    parent.add(m);
    return m;
  };
  add(T.primary, M.primary);
  add(T.accent, M.accent);
  add(T.carbon, M.carbon);
  add(T.halo, M.halo);
  const helmet = add(T.helmet, M.helmet);
  const visor = add(T.visor, M.visor);
  add(T.tcam, tcamYellow ? new THREE.MeshStandardMaterial({ color: 0xf4e300 }) : M.carbon);
  const lightMesh = new THREE.Mesh(T.light, M.light.clone());
  root.add(lightMesh);

  const flapPivot = new THREE.Group();
  flapPivot.position.set(-2.18, 0.94, 0);
  add(T.flap, M.primary, flapPivot);
  root.add(flapPivot);

  const wheels = [];
  const tm = tyreMaterials('M');
  for (const [x, z, front] of [
    [1.85, 0.8, true],
    [1.85, -0.8, true],
    [-1.72, 0.77, false],
    [-1.72, -0.77, false],
  ]) {
    const steer = new THREE.Group();
    steer.position.set(x, 0.36, z);
    const w = new THREE.Mesh(front ? T.wheelF : T.wheelR, tm);
    w.castShadow = shadows;
    steer.add(w);
    root.add(steer);
    wheels.push({ steer, mesh: w, front });
  }

  const shadow = new THREE.Mesh(T.shadow, new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 }));
  shadow.position.y = 0.03;
  shadow.renderOrder = 1;
  root.add(shadow);

  return { root, wheels, flapPivot, helmet, visor, lightMesh, shadow, spin: 0, compound: 'M' };
}

export function setCarCompound(model, compound) {
  if (model.compound === compound) return;
  model.compound = compound;
  const tm = tyreMaterials(compound);
  model.wheels.forEach((w) => (w.mesh.material = tm));
}
