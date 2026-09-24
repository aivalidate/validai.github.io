// 캔버스로 생성하는 텍스처들 (외부 이미지 없음)

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';
import { rng } from './util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function noise(g, w, h, n, colors, size = 1, seed = 1) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillRect(Math.floor(r() * w), Math.floor(r() * h), size, size);
  }
}

// 아스팔트: 가로(u)=트랙 폭, 세로(v)=진행 방향
export function asphalt(base = '#3a3d41', lines = true) {
  const [c, g] = canvas(256, 512);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 512);
  noise(g, 256, 512, 26000, ['#2e3134', '#44474c', '#35383c', '#4b4f54', '#2a2c2f'], 1, 7);
  // 타이어 자국 (가운데 약간 어둡게)
  const grd = g.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.35, 'rgba(0,0,0,0.12)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.18)');
  grd.addColorStop(0.65, 'rgba(0,0,0,0.12)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 512);
  const r = rng(3);
  g.globalAlpha = 0.06;
  for (let i = 0; i < 40; i++) {
    g.fillStyle = r() < 0.5 ? '#000' : '#fff';
    g.fillRect(r() * 256, 0, 1 + r() * 2, 512);
  }
  g.globalAlpha = 1;
  if (lines) {
    g.fillStyle = '#e9ecef';
    g.fillRect(2, 0, 5, 512);
    g.fillRect(249, 0, 5, 512);
  }
  return tex(c);
}

export function kerb(a = '#d6262b', b = '#f2f2f2') {
  const [c, g] = canvas(64, 128);
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = b;
  g.fillRect(0, 64, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, 10, 128);
  noise(g, 64, 128, 500, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.1)'], 1, 5);
  return tex(c);
}

export function grass(c1 = '#4b7a35', c2 = '#548540') {
  const [c, g] = canvas(256, 256);
  // 잔디 깎은 줄무늬
  g.fillStyle = c1;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = c2;
  g.fillRect(0, 128, 256, 128);
  noise(g, 256, 256, 18000, ['rgba(20,40,10,0.35)', 'rgba(120,160,70,0.25)', 'rgba(60,90,30,0.3)'], 1, 11);
  return tex(c);
}

export function sand(base = '#c9a46a') {
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 20000, ['rgba(120,80,40,0.25)', 'rgba(255,240,200,0.25)', 'rgba(90,60,30,0.2)'], 1, 13);
  return tex(c);
}

export function gravel() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#b9a98a';
  g.fillRect(0, 0, 128, 128);
  noise(g, 128, 128, 5000, ['#8f826a', '#d8cdb4', '#a39579', '#6f6553'], 2, 17);
  return tex(c);
}

export function concrete(base = '#9a978f') {
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 14000, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.1)'], 1, 19);
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }
  return tex(c);
}

// 광고판 (가상의 스폰서)
const SPONSORS = [
  ['NOVAFUEL', '#0c2c6b', '#ffd23f'],
  ['KAIROS', '#111111', '#ffffff'],
  ['HELIX', '#e6392d', '#ffffff'],
  ['ORBITEL', '#ffffff', '#1a3cb8'],
  ['VANTA', '#16161a', '#39e0b3'],
  ['MERIDIAN', '#0f5a3c', '#ffffff'],
  ['ZENITH TYRES', '#f3c300', '#161616'],
  ['STRATOS AIR', '#1c86d8', '#ffffff'],
  ['PULSE', '#7a1fd1', '#ffffff'],
  ['APEXWATCH', '#f4f1ea', '#b3122e'],
];

export function adBoards() {
  const [c, g] = canvas(2048, 64);
  const w = 2048 / SPONSORS.length;
  SPONSORS.forEach(([name, bg, fg], i) => {
    g.fillStyle = bg;
    g.fillRect(i * w, 0, w, 64);
    g.fillStyle = fg;
    g.font = '900 34px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, i * w + w / 2, 34, w - 20);
  });
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 58, 2048, 6);
  return tex(c);
}

export function tyreWall() {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#1b1c1e';
  g.fillRect(0, 0, 256, 64);
  for (let x = 0; x < 256; x += 16) {
    for (let y = 0; y < 64; y += 16) {
      g.fillStyle = (x / 16 + y / 16) % 2 ? '#26282b' : '#141517';
      g.beginPath();
      g.arc(x + 8, y + 8, 7, 0, Math.PI * 2);
      g.fill();
    }
  }
  return tex(c);
}

export function fence() {
  const [c, g] = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(190,195,200,0.9)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
  g.fillStyle = 'rgba(120,125,130,1)';
  g.fillRect(0, 0, 64, 3);
  return tex(c);
}

export function crowd() {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#2b2f36';
  g.fillRect(0, 0, 512, 256);
  const r = rng(23);
  const cols = ['#e63946', '#f1faee', '#ffb703', '#219ebc', '#fb8500', '#8ecae6', '#2a9d8f', '#e9c46a', '#ffffff', '#d62828', '#3a86ff'];
  for (let y = 4; y < 256; y += 10) {
    g.fillStyle = '#1d2026';
    g.fillRect(0, y + 6, 512, 3);
    for (let x = 2; x < 512; x += 6) {
      if (r() < 0.85) {
        g.fillStyle = cols[Math.floor(r() * cols.length)];
        g.fillRect(x, y + (r() * 2) | 0, 4, 5);
        g.fillStyle = '#e0b89a';
        g.fillRect(x + 1, y - 2, 2, 2);
      }
    }
  }
  return tex(c);
}

export function windows(base = '#d8c9a8') {
  const [c, g] = canvas(128, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 256);
  const r = rng(29);
  for (let y = 8; y < 256; y += 20) {
    for (let x = 8; x < 128; x += 20) {
      g.fillStyle = r() < 0.2 ? '#f7e7b5' : r() < 0.5 ? '#3d4a5a' : '#566779';
      g.fillRect(x, y, 11, 13);
    }
  }
  noise(g, 128, 256, 1500, ['rgba(0,0,0,0.08)'], 2, 31);
  return tex(c);
}

// 타이어 옆면 (컴파운드 색 띠)
export function tyreSide(color) {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#141414';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#2b2d31';
  g.beginPath();
  g.arc(64, 64, 38, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#50545b';
  g.beginPath();
  g.arc(64, 64, 14, 0, Math.PI * 2);
  g.fill();
  // 회전을 보여주는 휠 스포크
  g.strokeStyle = '#3c4046';
  g.lineWidth = 5;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    g.beginPath();
    g.moveTo(64, 64);
    g.lineTo(64 + Math.cos(a) * 36, 64 + Math.sin(a) * 36);
    g.stroke();
  }
  const t = tex(c, false);
  return t;
}

export function checker() {
  const [c, g] = canvas(64, 16);
  for (let x = 0; x < 64; x += 8) {
    for (let y = 0; y < 16; y += 8) {
      g.fillStyle = (x + y) % 16 === 0 ? '#111' : '#f4f4f4';
      g.fillRect(x, y, 8, 8);
    }
  }
  const t = tex(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function garage(color, accent) {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#dfe3e8';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 26);
  g.fillStyle = accent;
  g.fillRect(0, 26, 256, 6);
  g.fillStyle = '#1b1e24';
  g.fillRect(24, 44, 208, 84);
  g.fillStyle = '#2d323b';
  for (let y = 48; y < 128; y += 10) g.fillRect(28, y, 200, 4);
  return tex(c, false);
}

export function asphaltRunoff() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#6d7075';
  g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 16000, ['#5e6166', '#7b7e83', '#686b70'], 1, 37);
  // 런오프 줄무늬 (파랑/흰)
  g.fillStyle = 'rgba(40,90,200,0.35)';
  for (let y = 0; y < 256; y += 64) g.fillRect(0, y, 256, 20);
  return tex(c);
}

export function water() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#1d5f86';
  g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 3000, ['rgba(255,255,255,0.08)', 'rgba(0,30,60,0.2)'], 3, 41);
  return tex(c);
}
