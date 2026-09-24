// three.js 렌더러: 서킷, 풍경, 차량, 카메라, 이펙트

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';
import * as TX from './textures.js';
import { createCar, setCarCompound, resetCarMaterials } from './carmodel.js';
import { clamp, lerp, rng, wrapAngle, wrapDist } from './util.js';
import { brakeAccel, TEAMS } from './data.js';

const LOOKS = {
  meadow: {
    skyTop: '#3d78c7', horizon: '#d3e4ef', bottom: '#71906a', fog: '#cddfeb', fogNear: 300, fogFar: 2800,
    sun: [0.45, 0.75, 0.35], sunColor: '#fff2da', sunI: 2.6, hemiSky: '#d4e8ff', hemiGround: '#6d7560', hemiI: 1.1,
    ground: 'grass', g1: '#4a7a34', g2: '#53843d', trees: 950, treeCols: ['#2e5a2a', '#3b6b2f', '#2a4f28', '#446f33'], hills: '#7d97a8',
  },
  riviera: {
    skyTop: '#2f7fd8', horizon: '#dbe9f3', bottom: '#8d9aa3', fog: '#d6e4ee', fogNear: 280, fogFar: 2400,
    sun: [-0.35, 0.8, 0.45], sunColor: '#fff4e0', sunI: 2.8, hemiSky: '#dcecff', hemiGround: '#8a8478', hemiI: 1.15,
    ground: 'city', city: true, sea: true, hills: '#8aa0ae',
  },
  park: {
    skyTop: '#4b83c9', horizon: '#d9e6ec', bottom: '#6d8b5f', fog: '#d2e0e8', fogNear: 250, fogFar: 2500,
    sun: [0.3, 0.7, -0.5], sunColor: '#fff0d0', sunI: 2.5, hemiSky: '#d8e8ff', hemiGround: '#6b735c', hemiI: 1.1,
    ground: 'grass', g1: '#4c7c33', g2: '#56873b', trees: 1700, treeCols: ['#2d5b26', '#3f6d2c', '#5c7a2a', '#7b8b33', '#2b4d22'], hills: '#7f98a6',
  },
  sakura: {
    skyTop: '#5a8fd6', horizon: '#e8edf3', bottom: '#7d9a70', fog: '#e3e9ef', fogNear: 250, fogFar: 2400,
    sun: [0.5, 0.65, 0.4], sunColor: '#fff4e6', sunI: 2.5, hemiSky: '#e6efff', hemiGround: '#707862', hemiI: 1.15,
    ground: 'grass', g1: '#557f3a', g2: '#5e8a42', trees: 1200, treeCols: ['#f2b8c8', '#e89ab2', '#f7cdd8', '#3b6b2f', '#2f5a2a'], sakura: true, hills: '#8e9fb4',
  },
  desert: {
    skyTop: '#060a1c', horizon: '#2a2440', bottom: '#1a1410', fog: '#1c1a2a', fogNear: 250, fogFar: 2200,
    sun: [0.2, 0.9, 0.3], sunColor: '#fff6e8', sunI: 1.5, hemiSky: '#a9b8e0', hemiGround: '#6b5a44', hemiI: 1.25,
    ground: 'sand', night: true, palms: 120, floodlights: true, hills: '#2a2638',
  },
  island: {
    skyTop: '#3f86d6', horizon: '#d8e6ef', bottom: '#5a7f8f', fog: '#d4e3ec', fogNear: 280, fogFar: 2600,
    sun: [-0.4, 0.75, -0.35], sunColor: '#fff3dc', sunI: 2.6, hemiSky: '#d9ebff', hemiGround: '#6a7460', hemiI: 1.1,
    ground: 'water', island: true, trees: 700, treeCols: ['#2f5a2a', '#3d6a2f', '#c0622b', '#d98c2b', '#2a4f28'], hills: '#7c96a7',
  },
};

const CAM_MODES = ['chase', 'far', 'cockpit', 'tcam'];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.quality = 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.25, 6500);
    this.world = null;
    this.carModels = [];
    this.camMode = 'chase';
    this.camYaw = 0;
    this.camPos = new THREE.Vector3();
    this.shake = 0;
    this.orbit = 0;
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.particles = null;
    this.setQuality('high');
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, q === 'high' ? 2 : q === 'mid' ? 1.4 : 1));
    this.renderer.shadowMap.enabled = q === 'high';
    if (this.sunLight) this.sunLight.castShadow = q === 'high';
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  cycleCamera() {
    this.camMode = CAM_MODES[(CAM_MODES.indexOf(this.camMode) + 1) % CAM_MODES.length];
    return this.camMode;
  }

  dispose(obj) {
    obj.traverse((o) => {
      if (o.geometry && !o.userData.shared) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.userData && m.userData.shared) continue;
          for (const k of ['map', 'alphaMap', 'emissiveMap']) if (m[k]) m[k].dispose();
          m.dispose();
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  loadTrack(track) {
    if (this.world) {
      this.scene.remove(this.world);
      this.dispose(this.world);
    }
    this.clearCars();
    resetCarMaterials();
    if (this.envMap) this.envMap.dispose();
    this.track = track;
    const look = LOOKS[track.def.theme] || LOOKS.meadow;
    this.look = look;
    const W = new THREE.Group();
    this.world = W;
    this.scene.add(W);

    // 하늘
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(look.skyTop) },
        horizon: { value: new THREE.Color(look.horizon) },
        bottom: { value: new THREE.Color(look.bottom) },
        sunDir: { value: new THREE.Vector3(...look.sun).normalize() },
        sunColor: { value: new THREE.Color(look.night ? '#9aa7c7' : look.sunColor) },
        night: { value: look.night ? 1 : 0 },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float night; varying vec3 vDir;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        void main(){ vec3 d = normalize(vDir); float h = d.y; vec3 c;
          if (h > 0.0) c = mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)); else c = mix(horizon, bottom, clamp(-h*6.0,0.0,1.0));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += sunColor * (pow(s, 900.0) * (night > 0.5 ? 0.8 : 3.0) + pow(s, 14.0) * (night > 0.5 ? 0.05 : 0.22));
          if (night > 0.5 && h > 0.05) { vec3 q = floor(d * 380.0); float st = step(0.9965, hash(q)); c += vec3(st) * 0.9 * clamp(h*3.0, 0.0, 1.0); }
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    W.add(this.sky);

    // 환경맵 (차량 도장 반사)
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
    const gnd = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: look.night ? 0x151515 : look.hemiGround }));
    gnd.rotation.x = -Math.PI / 2;
    gnd.position.y = -2;
    envScene.add(gnd);
    this.envMap = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();

    this.scene.fog = new THREE.Fog(look.fog, look.fogNear, look.fogFar);
    this.scene.background = new THREE.Color(look.fog);

    const hemi = new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiI);
    W.add(hemi);
    const sun = new THREE.DirectionalLight(look.sunColor, look.sunI);
    sun.position.set(...look.sun).multiplyScalar(200);
    sun.castShadow = this.quality === 'high';
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 10;
    sc.far = 500;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    W.add(sun);
    W.add(sun.target);
    this.sunLight = sun;
    this.sunDir = new THREE.Vector3(...look.sun).normalize();

    this.buildGround(track, look);
    this.buildSurface(track, look);
    this.buildBarriers(track, look);
    this.buildPit(track, look);
    this.buildStart(track, look);
    this.buildGrandstands(track, look);
    this.buildScenery(track, look);
    this.buildRacingLine(track);
    this.buildParticles();
  }

  mat(opts, shadowRecv = true) {
    const m = new THREE.MeshLambertMaterial(opts);
    m.userData.recv = shadowRecv;
    return m;
  }

  mesh(geo, mat, recv = true, cast = false) {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = recv;
    m.castShadow = cast;
    this.world.add(m);
    return m;
  }

  texAniso(t, rx = 1, ry = 1) {
    t.anisotropy = this.maxAniso;
    t.repeat.set(rx, ry);
    return t;
  }

  // 트랙 샘플을 따라 띠 모양 메시 생성
  // fa(i) -> [횡위치, 높이], fb(i) -> [횡위치, 높이]
  strip(i0, count, fa, fb, vLen = 10, uvSwap = false) {
    const t = this.track;
    const N = t.N;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let k = 0; k <= count; k++) {
      const i = (i0 + k) % N;
      const [la, ya] = fa(i);
      const [lb, yb] = fb(i);
      pos.push(t.px[i] + t.nx[i] * la, ya, t.pz[i] + t.nz[i] * la);
      pos.push(t.px[i] + t.nx[i] * lb, yb, t.pz[i] + t.nz[i] * lb);
      const v = (k * t.ds) / vLen;
      if (uvSwap) uv.push(v, 0, v, 1);
      else uv.push(0, v, 1, v);
      if (k < count) {
        const a = k * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    // 수평 띠는 법선이 위를 향하도록 감기 방향 보정
    if (pos.length >= 12) {
      const ax = pos[3] - pos[0];
      const az = pos[5] - pos[2];
      const bx = pos[6] - pos[0];
      const bz = pos[8] - pos[2];
      // 삼각형 (A0, A1, B0)의 법선 y = -(az*bx - ax*bz)
      const ny = -(az * bx - ax * bz);
      if (ny < 0) {
        for (let i = 0; i < idx.length; i += 3) {
          const t = idx[i + 1];
          idx[i + 1] = idx[i + 2];
          idx[i + 2] = t;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  runs(mask) {
    const N = mask.length;
    const out = [];
    let start = -1;
    // 원형이므로 0이 아닌 구간 경계에서 시작
    let first = 0;
    while (first < N && mask[first]) first++;
    if (first === N) return [[0, N]];
    for (let k = 0; k <= N; k++) {
      const i = (first + k) % N;
      if (mask[i] && start < 0) start = k;
      if ((!mask[i] || k === N) && start >= 0) {
        out.push([(first + start) % N, k - start]);
        start = -1;
      }
    }
    return out;
  }

  buildGround(track, look) {
    const b = track.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 3000;
    let mat;
    if (look.ground === 'grass') mat = this.mat({ map: this.texAniso(TX.grass(look.g1, look.g2), size / 50, size / 50) });
    else if (look.ground === 'sand') mat = this.mat({ map: this.texAniso(TX.sand('#a07a4c'), size / 40, size / 40) });
    else if (look.ground === 'city') mat = this.mat({ map: this.texAniso(TX.concrete('#a39e94'), size / 16, size / 16) });
    else mat = new THREE.MeshStandardMaterial({ map: this.texAniso(TX.water(), size / 30, size / 30), roughness: 0.25, metalness: 0.1, envMap: this.envMap });
    const g = new THREE.PlaneGeometry(size, size);
    g.rotateX(-Math.PI / 2);
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 6;
    mat.polygonOffsetUnits = 6;
    const m = this.mesh(g, mat);
    m.position.set(cx, look.ground === 'water' ? -0.5 : -0.35, cz);

    if (look.sea) {
      // 항구 쪽 바다
      const sg = new THREE.PlaneGeometry(size, size / 2);
      sg.rotateX(-Math.PI / 2);
      const sm = new THREE.MeshStandardMaterial({ map: this.texAniso(TX.water(), 60, 30), roughness: 0.2, metalness: 0.1, envMap: this.envMap });
      const sea = this.mesh(sg, sm);
      this.seaZ = b.maxZ + 45;
      sea.position.set(cx, -0.02, this.seaZ + size / 4);
    }
    if (look.island) {
      // 트랙 주변의 섬
      const gm = this.mat({ map: this.texAniso(TX.grass('#4d7b37', '#56853e'), 1, 1), polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 });
      gm.map.repeat.set(4, 1);
      for (const side of [1, -1]) {
        const g2 = this.strip(0, track.N, (i) => [0, -0.2], (i) => [side * (track.half + (side > 0 ? track.runR[i] : track.runL[i]) + 55), -0.2], 60);
        this.mesh(g2, gm);
      }
    }
  }

  buildSurface(track, look) {
    const N = track.N;
    const H = track.half;
    const asphalt = this.texAniso(TX.asphalt(look.night ? '#34363a' : '#3a3d41'));
    const trackMat = this.mat({ map: asphalt });
    this.mesh(this.strip(0, N, () => [-H, 0], () => [H, 0], 14), trackMat);

    // 연석
    const kerbMat = this.mat({ map: this.texAniso(TX.kerb()) });
    for (const [i0, n] of this.runs(track.kerb)) {
      for (const side of [1, -1]) {
        const g = this.strip(i0, n, () => [side * H, 0.02], () => [side * (H + 1.3), 0.06], 4);
        this.mesh(g, kerbMat);
      }
    }
    // 런오프
    if (track.runoffType === 'asphalt') {
      const rm = this.mat({ map: this.texAniso(look.night ? TX.asphalt('#4a4c50', false) : TX.asphaltRunoff()), polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
      for (const side of [1, -1]) {
        const g = this.strip(0, N, () => [side * H, -0.01], (i) => [side * (H + (side > 0 ? track.runR[i] : track.runL[i])), -0.01], 20);
        this.mesh(g, rm);
      }
      if (look.night) {
        // 사막: 런오프 바깥은 모래
      }
    }
    // 자갈 트랩
    const gm = this.mat({ map: this.texAniso(TX.gravel()), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    for (const [side, mask] of [
      [1, track.gravelR],
      [-1, track.gravelL],
    ]) {
      for (const [i0, n] of this.runs(mask)) {
        const run = side > 0 ? track.runR : track.runL;
        const g = this.strip(i0, n, () => [side * (H + 3), -0.03], (i) => [side * (H + Math.max(3.5, run[i] - 0.6)), -0.03], 6);
        this.mesh(g, gm);
      }
    }
    // 터널
    if (track.tunnel) {
      const [a, b] = track.tunnel;
      const i0 = track.idx(a);
      const n = Math.round(wrapDist(b - a, track.L) / track.ds);
      const wallW = (i, side) => side * (H + (side > 0 ? track.runR[i] : track.runL[i]));
      const cm = this.mat({ map: this.texAniso(TX.concrete('#7c7a75'), 1, 1), side: THREE.DoubleSide });
      const roof = this.strip(i0, n, (i) => [wallW(i, -1) - 1, 7], (i) => [wallW(i, 1) + 1, 7], 8);
      this.mesh(roof, cm);
      for (const side of [1, -1]) this.mesh(this.strip(i0, n, (i) => [wallW(i, side), 0], (i) => [wallW(i, side), 7], 8, true), cm);
      // 터널 안을 어둡게
      const shade = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
      const sh = this.strip(i0, n, (i) => [wallW(i, -1), 0.03], (i) => [wallW(i, 1), 0.03], 8);
      const shm = this.mesh(sh, shade, false);
      shm.renderOrder = 2;
      // 조명
      const lg = new THREE.BoxGeometry(0.4, 0.1, 3);
      const lm = new THREE.MeshBasicMaterial({ color: 0xfff1c8 });
      const cnt = Math.floor(n / 6);
      const inst = new THREE.InstancedMesh(lg, lm, cnt);
      const m4 = new THREE.Matrix4();
      for (let k = 0; k < cnt; k++) {
        const p = track.pointAt(a + k * 12, 0);
        m4.makeRotationY(-p.h);
        m4.setPosition(p.x, 6.9, p.z);
        inst.setMatrixAt(k, m4);
      }
      this.world.add(inst);
    }
  }

  buildBarriers(track, look) {
    const N = track.N;
    const H = track.half;
    const street = look.city || track.def.street;
    if (street || look.island) {
      const wm = this.mat({ map: this.texAniso(TX.concrete('#c9c6bd'), 1, 1), side: THREE.DoubleSide });
      const adm = this.mat({ map: this.texAniso(TX.adBoards(), 1, 1), side: THREE.DoubleSide });
      const fm = new THREE.MeshLambertMaterial({ map: TX.fence(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: false });
      fm.map.repeat.set(1, 1);
      for (const side of [1, -1]) {
        const w = (i) => side * (H + (side > 0 ? track.runR[i] : track.runL[i]));
        this.mesh(this.strip(0, N, (i) => [w(i), 0], (i) => [w(i), 0.3], 6, true), wm);
        this.mesh(this.strip(0, N, (i) => [w(i), 0.3], (i) => [w(i), 1.05], 60, true), adm);
        const f = this.mesh(this.strip(0, N, (i) => [w(i) + side * 0.2, 1.05], (i) => [w(i) + side * 0.5, 4], 3, true), fm, false);
        f.renderOrder = 3;
      }
    } else {
      const adm = this.mat({ map: this.texAniso(TX.adBoards(), 1, 1), side: THREE.DoubleSide });
      const tm = this.mat({ map: this.texAniso(TX.tyreWall(), 1, 1), side: THREE.DoubleSide });
      for (const side of [1, -1]) {
        const w = (i) => side * (H + (side > 0 ? track.runR[i] : track.runL[i]));
        this.mesh(this.strip(0, N, (i) => [w(i), 0], (i) => [w(i), 0.55], 4, true), tm);
        this.mesh(this.strip(0, N, (i) => [w(i) + side * 0.35, 0.55], (i) => [w(i) + side * 0.35, 1.35], 60, true), adm);
      }
    }
  }

  buildPit(track, look) {
    const pit = track.pit;
    const L = track.L;
    const ds = track.ds;
    const iFrom = track.idx(pit.entry);
    const n = Math.round((pit.exit - pit.entry) / ds);
    const rOf = (i) => wrapDist(i * ds, L);
    const pm = this.mat({ map: this.texAniso(TX.asphalt('#44474b', false)), polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    const lane = this.strip(iFrom, n, (i) => [track.pitD(rOf(i)) - 4.5 * pit.side, -0.02], (i) => [track.pitD(rOf(i)) + 4.5 * pit.side, -0.02], 14);
    this.mesh(lane, pm);
    // 피트월
    const wm = this.mat({ map: this.texAniso(TX.concrete('#d8d5cc'), 1, 1), side: THREE.DoubleSide });
    const fm = new THREE.MeshLambertMaterial({ map: TX.fence(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: false });
    const wFrom = track.idx(pit.entry + 100);
    const wn = Math.round((pit.exit - pit.entry - 200) / ds);
    const ww = pit.side * pit.wall;
    this.mesh(this.strip(wFrom, wn, () => [ww, 0], () => [ww, 1.1], 6, true), wm);
    this.mesh(this.strip(wFrom, wn, () => [ww, 1.1], () => [ww, 3.2], 3, true), fm, false).renderOrder = 3;
    // 차고
    const box = new THREE.BoxGeometry(1, 1, 1);
    const roofMat = this.mat({ color: 0x9aa3ad });
    track.pit.boxes.forEach((r, t) => {
      const team = TEAMS[t];
      const color = team.color;
      const accent = team.accent;
      const front = this.mat({ map: TX.garage(color, accent) });
      const side = this.mat({ color: 0xc9ced4 });
      const mats = [side, side, roofMat, side, side, side];
      mats[pit.side > 0 ? 5 : 4] = front;
      const m = new THREE.Mesh(box, mats);
      const p = track.pointAt(r, pit.side * (pit.garage + 5));
      m.position.set(p.x, 3, p.z);
      m.scale.set(13.5, 6, 10);
      m.rotation.y = -p.h;
      this.world.add(m);
      // 피트 박스 표시
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }));
      mark.rotation.x = -Math.PI / 2;
      mark.rotation.z = -p.h;
      const q = track.pointAt(r, pit.side * (pit.lane + 2.6));
      mark.position.set(q.x, -0.005, q.z);
      this.world.add(mark);
    });
    // 패독 건물
    const r0 = pit.boxes[0] - 20;
    const r1 = pit.boxes[9] + 20;
    const pbFrom = track.idx(r0);
    const pbn = Math.round((r1 - r0) / ds);
    const bm = this.mat({ map: this.texAniso(TX.windows('#e3e6ea'), 1, 1), side: THREE.DoubleSide });
    const back = pit.side * (pit.garage + 10);
    this.mesh(this.strip(pbFrom, pbn, () => [back, 0], () => [back, 11], 18, true), bm);
    this.mesh(this.strip(pbFrom, pbn, () => [pit.side * (pit.garage - 1.5), 11], () => [back + pit.side * 2, 11.5], 20), roofMat);
  }

  buildStart(track, look) {
    const H = track.half;
    // 체커 라인
    const cm = new THREE.MeshLambertMaterial({ map: TX.checker() });
    cm.map.repeat.set(track.width / 2, 1);
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const p0 = track.pointAt(0, 0);
    const line = new THREE.Mesh(g, cm);
    line.scale.set(1.4, 1, track.width);
    line.position.set(p0.x, 0.015, p0.z);
    line.rotation.y = -p0.h;
    line.receiveShadow = true;
    this.world.add(line);
    // 그리드 박스
    const gm = new THREE.MeshBasicMaterial({ color: 0xf0f0f0 });
    const slot = new THREE.PlaneGeometry(0.25, 2.4);
    slot.rotateX(-Math.PI / 2);
    for (let k = 0; k < 20; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const p = track.pointAt(track.L - (10 + k * 8) + 2.6, side * 3.2);
      const m = new THREE.Mesh(slot, gm);
      m.position.set(p.x, 0.012, p.z);
      m.rotation.y = -p.h;
      this.world.add(m);
    }
    // 출발 신호 갠트리
    const gp = track.pointAt(6, 0);
    const gantry = new THREE.Group();
    gantry.position.set(gp.x, 0, gp.z);
    gantry.rotation.y = -gp.h;
    const steel = this.mat({ color: 0x2b2f36 });
    const colG = new THREE.BoxGeometry(0.8, 8.5, 0.8);
    for (const s of [1, -1]) {
      const c = new THREE.Mesh(colG, steel);
      c.position.set(0, 4.25, s * (H + 2.8));
      gantry.add(c);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, track.width + 6), steel);
    beam.position.set(0, 7.6, 0);
    gantry.add(beam);
    this.startLights = [];
    const lg = new THREE.BoxGeometry(0.3, 0.6, 0.6);
    for (let k = 0; k < 5; k++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x2a0606 });
      const l = new THREE.Mesh(lg, m);
      l.position.set(-0.62, 7.6, (k - 2) * 1.2);
      gantry.add(l);
      this.startLights.push(m);
    }
    this.world.add(gantry);
  }

  buildGrandstands(track, look) {
    const pit = track.pit;
    const side = -pit.side;
    const crowdTex = TX.crowd();
    crowdTex.repeat.set(4, 1);
    const seat = this.mat({ map: crowdTex, side: THREE.DoubleSide });
    const roof = this.mat({ color: look.night ? 0x3a3f47 : 0xe8ebef, emissive: look.night ? 0x111317 : 0x4a4f57, side: THREE.DoubleSide });
    const frame = this.mat({ color: 0x5a616b });
    const len = 44;
    const place = (r, sideSign, depth = 16) => {
      const i = track.idx(r);
      const run = sideSign > 0 ? track.runR[i] : track.runL[i];
      const clear = sideSign > 0 ? track.clearR[i] : track.clearL[i];
      const off = track.half + run + 4;
      if (clear < (off + depth + 10) * 2 - track.width) return;
      const p = track.pointAt(r, sideSign * off);
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = -p.h;
      // 경사진 관중석 (트랙에서 멀어질수록 높아짐)
      const sg = new THREE.PlaneGeometry(len, Math.hypot(depth, depth * 0.62));
      const sm = new THREE.Mesh(sg, seat);
      sm.rotation.x = -Math.PI / 2 + sideSign * Math.atan(0.62);
      sm.position.set(0, (depth * 0.62) / 2 + 1, sideSign * (depth / 2));
      if (sideSign < 0) sm.rotation.z = Math.PI;
      g.add(sm);
      const back = new THREE.Mesh(new THREE.BoxGeometry(len, depth * 0.62 + 5, 0.5), frame);
      back.position.set(0, (depth * 0.62 + 5) / 2, sideSign * (depth + 0.3));
      g.add(back);
      const rf = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.3, depth + 3), roof);
      rf.position.set(0, depth * 0.62 + 5.5, sideSign * (depth / 2 + 0.5));
      rf.rotation.x = sideSign * 0.08;
      g.add(rf);
      this.world.add(g);
    };
    for (let r = pit.entry + 60; r < pit.exit - 40; r += len + 2) place(r, side);
    // 느린 코너 바깥 관중석
    const cand = [];
    for (let i = 0; i < track.N; i += 5) {
      const r = wrapDist(i * track.ds, track.L);
      if (r > pit.entry - 100 && r < pit.exit + 100) continue;
      cand.push({ i, v: track.profile[i] });
    }
    cand.sort((a, b) => a.v - b.v);
    const used = [];
    for (const c of cand) {
      if (used.length >= 4) break;
      if (used.some((u) => Math.abs(wrapDist((u - c.i) * track.ds, track.L)) < 400)) continue;
      used.push(c.i);
      const k = track.curv[c.i];
      const outside = k > 0 ? -1 : 1;
      place(c.i * track.ds + 30, outside, 12);
    }
  }

  // 트랙과의 최소 거리 (풍경 배치용)
  buildNearGrid(track) {
    const cell = 50;
    const grid = new Map();
    for (let i = 0; i < track.N; i += 2) {
      const k = Math.floor(track.px[i] / cell) + ',' + Math.floor(track.pz[i] / cell);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    return (x, z, need) => {
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      const R = Math.ceil(need / cell) + 1;
      let best = Infinity;
      for (let a = -R; a <= R; a++) {
        for (let b = -R; b <= R; b++) {
          const list = grid.get(cx + a + ',' + (cz + b));
          if (!list) continue;
          for (const i of list) {
            const d = Math.hypot(track.px[i] - x, track.pz[i] - z);
            const side = (x - track.px[i]) * track.nx[i] + (z - track.pz[i]) * track.nz[i] > 0 ? track.runR[i] : track.runL[i];
            const margin = d - (track.half + side);
            if (margin < best) best = margin;
          }
        }
      }
      return best;
    };
  }

  buildScenery(track, look) {
    const b = track.bounds;
    const near = this.buildNearGrid(track);
    const R = rng(track.N * 7 + 3);
    const pit = track.pit;
    const inPitArea = (x, z) => {
      const loc = track.locate(x, z);
      const r = wrapDist(loc.s, track.L);
      return r > pit.entry - 60 && r < pit.exit + 60 && Math.abs(loc.d) < 70;
    };
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    const margin = 700;

    const scatter = (count, minGap, maxGap, fn) => {
      let placed = 0;
      let tries = 0;
      while (placed < count && tries < count * 30) {
        tries++;
        const x = b.minX - margin + R() * (b.maxX - b.minX + margin * 2);
        const z = b.minZ - margin + R() * (b.maxZ - b.minZ + margin * 2);
        const g = near(x, z, maxGap);
        if (g < minGap || g > maxGap) continue;
        if (this.seaZ && z > this.seaZ - 10) continue;
        if (inPitArea(x, z)) continue;
        fn(x, z, placed, g);
        placed++;
      }
      return placed;
    };

    if (look.trees) {
      const n = this.quality === 'low' ? Math.floor(look.trees * 0.5) : look.trees;
      const fol = look.sakura ? new THREE.IcosahedronGeometry(1, 1) : new THREE.ConeGeometry(1, 2.4, 7);
      const trunk = new THREE.CylinderGeometry(0.18, 0.25, 1, 5);
      trunk.translate(0, 0.5, 0);
      const fm = new THREE.MeshLambertMaterial({ flatShading: true });
      const tm = new THREE.MeshLambertMaterial({ color: 0x5a4030 });
      const fI = new THREE.InstancedMesh(fol, fm, n);
      const tI = new THREE.InstancedMesh(trunk, tm, n);
      const island = look.island;
      const got = scatter(n, 6, island ? 50 : 400, (x, z, k) => {
        const s = 3 + R() * 4;
        const th = s * (0.5 + R() * 0.4);
        m4.compose(new THREE.Vector3(x, th + s * (look.sakura ? 0.7 : 1.1), z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6), new THREE.Vector3(s, s * (look.sakura ? 0.85 : 1.1), s));
        fI.setMatrixAt(k, m4);
        col.set(look.treeCols[Math.floor(R() * look.treeCols.length)]);
        col.offsetHSL(0, 0, (R() - 0.5) * 0.08);
        fI.setColorAt(k, col);
        m4.compose(new THREE.Vector3(x, 0, z), q.identity(), new THREE.Vector3(s * 0.35, th + s * 0.4, s * 0.35));
        tI.setMatrixAt(k, m4);
      });
      fI.count = got;
      tI.count = got;
      this.world.add(fI, tI);
    }

    if (look.city) {
      const n = this.quality === 'low' ? 260 : 520;
      const bg = new THREE.BoxGeometry(1, 1, 1);
      bg.translate(0, 0.5, 0);
      const bmTex = TX.windows('#efe6d6');
      const bm = new THREE.MeshLambertMaterial({ map: bmTex });
      const inst = new THREE.InstancedMesh(bg, bm, n);
      const cols = ['#f1e3c6', '#f4d7c1', '#e8e2d4', '#f6efe2', '#e7c9a9', '#d9d2c3', '#f2e7d5', '#e3b8a0'];
      const got = scatter(n, 4, 260, (x, z, k, gap) => {
        const w = 14 + R() * 22;
        const d = 14 + R() * 22;
        const h = (gap < 30 ? 12 : 18) + R() * (gap < 30 ? 16 : 40);
        const loc = track.locate(x, z);
        const yaw = -track.head[loc.i] + (R() < 0.3 ? R() * 0.4 : 0);
        m4.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(w, h, d));
        inst.setMatrixAt(k, m4);
        col.set(cols[Math.floor(R() * cols.length)]);
        inst.setColorAt(k, col);
      });
      inst.count = got;
      this.world.add(inst);
      // 요트
      if (this.seaZ) {
        const yg = new THREE.BoxGeometry(1, 1, 1);
        const ym = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const yi = new THREE.InstancedMesh(yg, ym, 60);
        for (let k = 0; k < 60; k++) {
          const x = b.minX - 100 + R() * (b.maxX - b.minX + 200);
          const z = this.seaZ + 20 + R() * 180;
          m4.compose(new THREE.Vector3(x, 0.8, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 0.3), new THREE.Vector3(14 + R() * 18, 2 + R() * 3, 4 + R() * 3));
          yi.setMatrixAt(k, m4);
        }
        this.world.add(yi);
      }
    }

    if (look.palms) {
      const n = look.palms;
      const trunk = new THREE.CylinderGeometry(0.2, 0.3, 1, 5);
      trunk.translate(0, 0.5, 0);
      const crown = new THREE.ConeGeometry(1, 0.6, 7);
      const tI = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x6a5238 }), n);
      const cI = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: 0x3f6b2a, flatShading: true }), n);
      const got = scatter(n, 10, 250, (x, z, k) => {
        const h = 7 + R() * 5;
        m4.compose(new THREE.Vector3(x, 0, z), q.identity(), new THREE.Vector3(1, h, 1));
        tI.setMatrixAt(k, m4);
        m4.compose(new THREE.Vector3(x, h, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 3), new THREE.Vector3(3.5, 2, 3.5));
        cI.setMatrixAt(k, m4);
      });
      tI.count = cI.count = got;
      this.world.add(tI, cI);
      // 모래 언덕
      const dg = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const dI = new THREE.InstancedMesh(dg, new THREE.MeshLambertMaterial({ color: 0x8a6a44 }), 50);
      const gotD = scatter(50, 60, 700, (x, z, k) => {
        const s = 30 + R() * 60;
        m4.compose(new THREE.Vector3(x, -1, z), q.identity(), new THREE.Vector3(s, 4 + R() * 10, s * (0.6 + R() * 0.6)));
        dI.setMatrixAt(k, m4);
      });
      dI.count = gotD;
      this.world.add(dI);
    }

    if (look.floodlights) {
      const list = [];
      for (let s = 0; s < track.L; s += 70) {
        const side = Math.floor(s / 70) % 2 ? 1 : -1;
        const i = track.idx(s);
        const run = side > 0 ? track.runR[i] : track.runL[i];
        list.push(track.pointAt(s, side * (track.half + run + 5)));
      }
      const pole = new THREE.CylinderGeometry(0.25, 0.35, 22, 6);
      pole.translate(0, 11, 0);
      const head = new THREE.BoxGeometry(2.5, 1.2, 2.5);
      const pI = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ color: 0x555a62 }), list.length);
      const hI = new THREE.InstancedMesh(head, new THREE.MeshBasicMaterial({ color: 0xfff6dc }), list.length);
      list.forEach((p, k) => {
        m4.makeTranslation(p.x, 0, p.z);
        pI.setMatrixAt(k, m4);
        m4.makeTranslation(p.x, 22, p.z);
        hI.setMatrixAt(k, m4);
      });
      this.world.add(pI, hI);
      // 조명 빛 번짐
      const glowTex = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, 'rgba(255,245,220,0.9)');
        grd.addColorStop(1, 'rgba(255,245,220,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
      })();
      const sm = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
      for (const p of list) {
        const sp = new THREE.Sprite(sm);
        sp.position.set(p.x, 22, p.z);
        sp.scale.set(14, 14, 1);
        this.world.add(sp);
      }
    }

    // 먼 산
    const hg = new THREE.ConeGeometry(1, 1, 6);
    const hm = new THREE.MeshLambertMaterial({ color: look.hills, flatShading: true, fog: true });
    const hn = 36;
    const hI = new THREE.InstancedMesh(hg, hm, hn);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const rad = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 1600;
    for (let k = 0; k < hn; k++) {
      const a = (k / hn) * Math.PI * 2 + R() * 0.1;
      const s = 300 + R() * 500;
      m4.compose(new THREE.Vector3(cx + Math.cos(a) * rad, (s * 0.35) / 2 - 5, cz + Math.sin(a) * rad), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6), new THREE.Vector3(s, s * (0.25 + R() * 0.25), s));
      hI.setMatrixAt(k, m4);
    }
    this.world.add(hI);
  }

  buildRacingLine(track) {
    const N = track.N;
    const g = this.strip(0, N, (i) => [track.off[i] - 0.45, 0.03], (i) => [track.off[i] + 0.45, 0.03], 10);
    const colors = new Float32Array((N + 1) * 2 * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.lineMesh = new THREE.Mesh(g, m);
    this.lineMesh.renderOrder = 1;
    this.lineMesh.visible = false;
    this.world.add(this.lineMesh);
    this.lineColors = colors;
    this.lineDirty = new Set();
  }

  // 레이싱 라인 색: 현재 속도로 해당 지점까지 멈출 수 있는지로 판단
  updateRacingLine(car, mode) {
    if (!this.lineMesh) return;
    this.lineMesh.visible = mode !== 'off';
    if (mode === 'off' || !car) return;
    const t = this.track;
    const N = t.N;
    const col = this.lineColors;
    const set = (i, r, g, b) => {
      for (const v of [i, i === 0 ? N : -1]) {
        if (v < 0) continue;
        const o = v * 6;
        col[o] = col[o + 3] = r;
        col[o + 1] = col[o + 4] = g;
        col[o + 2] = col[o + 5] = b;
      }
    };
    for (const i of this.lineDirty) set(i, 0, 0, 0);
    this.lineDirty.clear();
    const i0 = t.idx(car.s);
    const prof = car.profile;
    const v = Math.max(car.v, 0);
    const dec = brakeAccel(v, 0.92);
    const ahead = Math.min(N - 1, Math.round((mode === 'full' ? 320 : 260) / t.ds));
    for (let k = 2; k < ahead; k++) {
      const i = (i0 + k) % N;
      const dist = k * t.ds;
      const vAllowed = Math.sqrt(prof[i] * prof[i] + 2 * dec * dist);
      const need = v / vAllowed;
      let r = 0;
      let g = 0;
      let b = 0;
      const fade = 1 - k / ahead;
      if (need > 1.0) {
        r = 1;
        g = 0.12;
        b = 0.08;
      } else if (need > 0.93) {
        r = 1;
        g = 0.75;
        b = 0.1;
      } else if (mode === 'full' || prof[i] < 80) {
        r = 0.15;
        g = 0.9;
        b = 0.35;
        if (mode !== 'full') {
          const w = clamp((80 - prof[i]) / 20, 0, 1);
          r *= w;
          g *= w;
          b *= w;
        }
      }
      const a = 0.85 * Math.min(1, fade * 2.5);
      set(i, r * a, g * a, b * a);
      this.lineDirty.add(i);
    }
    this.lineMesh.geometry.attributes.color.needsUpdate = true;
  }

  buildParticles() {
    const n = 500;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g2 = c.getContext('2d');
    const grd = g2.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = grd;
    g2.fillRect(0, 0, 32, 32);
    const m = new THREE.PointsMaterial({ size: 0.28, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    this.world.add(pts);
    this.particles = { pts, pos, col, vel: new Float32Array(n * 3), life: new Float32Array(n), base: new Float32Array(n * 3), next: 0, n };
  }

  emit(x, y, z, vx, vy, vz, r, g, b, life) {
    const P = this.particles;
    if (!P) return;
    const i = P.next;
    P.next = (P.next + 1) % P.n;
    P.pos.set([x, y, z], i * 3);
    P.vel.set([vx, vy, vz], i * 3);
    P.base.set([r, g, b], i * 3);
    P.life[i] = life;
  }

  sparks(car, n = 14) {
    for (let k = 0; k < n; k++) {
      this.emit(car.x + (Math.random() - 0.5), 0.3, car.z + (Math.random() - 0.5), (Math.random() - 0.5) * 8 + Math.cos(car.h) * car.v * 0.6, 1 + Math.random() * 4, (Math.random() - 0.5) * 8 + Math.sin(car.h) * car.v * 0.6, 1, 0.75, 0.3, 0.3 + Math.random() * 0.4);
    }
  }

  updateParticles(dt) {
    const P = this.particles;
    if (!P) return;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) {
        P.pos[i * 3 + 1] = -100;
        continue;
      }
      P.life[i] -= dt;
      P.vel[i * 3 + 1] -= 9 * dt * (P.base[i * 3] > 0.9 ? 1 : 0.1);
      for (let a = 0; a < 3; a++) P.pos[i * 3 + a] += P.vel[i * 3 + a] * dt;
      if (P.pos[i * 3 + 1] < 0.05) P.pos[i * 3 + 1] = 0.05;
      const f = Math.min(1, P.life[i] * 2);
      for (let a = 0; a < 3; a++) P.col[i * 3 + a] = P.base[i * 3 + a] * f;
    }
    P.pts.geometry.attributes.position.needsUpdate = true;
    P.pts.geometry.attributes.color.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  clearCars() {
    for (const m of this.carModels) {
      this.scene.remove(m.root);
      m.root.traverse((o) => {
        if (o.material && o.material.map && o.material.map.isCanvasTexture && o === m.shadow) return;
      });
    }
    this.carModels = [];
  }

  setCars(cars, teams) {
    this.clearCars();
    this.teams = teams;
    for (const car of cars) {
      const model = createCar(car.team, this.envMap, { shadows: this.quality === 'high', tcamYellow: car.driver.num % 2 === 0 });
      model.car = car;
      setCarCompound(model, car.compound);
      this.scene.add(model.root);
      this.carModels.push(model);
    }
  }

  // 메뉴 배경 등에서 쓰는 전시용 차량
  showcase(team) {
    this.clearCars();
    const fake = { team, driver: { num: 1 }, compound: 'S', x: 0, z: 0, h: 0, v: 0, steerAngle: 0.18, s: 0 };
    const t = this.track;
    const p = t.pointAt(t.L - 10, -3.2);
    fake.x = p.x;
    fake.z = p.z;
    fake.h = t.head[t.idx(t.L - 10)];
    this.setCars([fake]);
    this.showcaseCar = fake;
  }

  updateCars(dt, S) {
    for (const m of this.carModels) {
      const c = m.car;
      const r = m.root;
      r.position.set(c.x, 0, c.z);
      r.rotation.order = 'YZX';
      r.rotation.y = -c.h;
      r.rotation.z = clamp((c.accel || 0) * 0.0012, -0.02, 0.012);
      r.rotation.x = clamp((c.latAcc || 0) * 0.0005, -0.02, 0.02);
      m.spin += ((c.v || 0) * dt) / 0.36;
      for (const w of m.wheels) {
        w.mesh.rotation.z = -m.spin;
        if (w.front) w.steer.rotation.y = -(c.steerAngle || 0);
      }
      m.flapPivot.rotation.z = c.drsOpen ? -0.05 : -0.55;
      setCarCompound(m, c.compound);
      const blink = c.brake > 0.3 || (c.pitState && c.pitState !== 'box') ? (performance.now() % 250 < 125 ? 1 : 0) : 0;
      m.lightMesh.material.color.setHex(blink ? 0xff2020 : 0x300404);
      // 잔디/자갈 먼지
      if (c.surface >= 2 && c.surface <= 3 && c.v > 8 && Math.random() < 0.5) {
        const col = c.surface === 3 ? [0.45, 0.4, 0.3] : [0.2, 0.26, 0.12];
        this.emit(c.x - Math.cos(c.h) * 2, 0.3, c.z - Math.sin(c.h) * 2, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, ...col, 0.8);
      }
    }
  }

  // 타임 트라이얼 고스트 카
  setGhost(team) {
    if (this.ghostModel) {
      this.scene.remove(this.ghostModel.root);
      this.ghostModel = null;
    }
    if (!team) return;
    const m = createCar(team, this.envMap);
    const gm = new THREE.MeshBasicMaterial({ color: 0x9cc8ff, transparent: true, opacity: 0.28, depthWrite: false });
    m.root.traverse((o) => {
      if (o.isMesh) {
        o.material = gm;
        o.castShadow = false;
      }
    });
    m.shadow.visible = false;
    m.root.visible = false;
    this.scene.add(m.root);
    this.ghostModel = m;
  }

  updateGhost(pos) {
    const m = this.ghostModel;
    if (!m) return;
    if (!pos) {
      m.root.visible = false;
      return;
    }
    m.root.visible = true;
    m.root.position.set(pos.x, 0, pos.z);
    m.root.rotation.y = -pos.h;
  }

  setLights(n, green = false) {
    if (!this.startLights) return;
    this.startLights.forEach((m, k) => m.color.setHex(k < n ? 0xff1a14 : 0x2a0606));
  }

  updateCamera(dt, car, mode = this.camMode) {
    const cam = this.camera;
    if (!car) return;
    if (cam.view && cam.view.enabled) cam.clearViewOffset();
    const f = new THREE.Vector3(Math.cos(car.h), 0, Math.sin(car.h));
    const pos = new THREE.Vector3(car.x, 0, car.z);
    const m = this.carModels.find((x) => x.car === car);
    const inCar = mode === 'cockpit' || mode === 'tcam';
    if (m) {
      m.helmet.visible = mode !== 'cockpit';
      m.visor.visible = mode !== 'cockpit';
    }
    this.shake = Math.max(0, this.shake - dt * 3);
    const kerbShake = car.surface === 1 ? 0.012 : car.surface >= 2 ? 0.02 : 0;
    const sh = (this.shake * 0.25 + kerbShake * Math.min(1, car.v / 30)) * (Math.random() - 0.5);
    if (inCar) {
      const lx = mode === 'cockpit' ? 0.22 : -0.05;
      const ly = mode === 'cockpit' ? 1.04 : 1.24;
      cam.near = mode === 'cockpit' ? 0.3 : 0.2;
      cam.position.set(car.x + f.x * lx, ly + sh, car.z + f.z * lx);
      const look = new THREE.Vector3(car.x + f.x * 30, ly - 0.9 + sh, car.z + f.z * 30);
      cam.lookAt(look);
      cam.fov = lerp(cam.fov, 66 + Math.min(10, car.v * 0.1), 1 - Math.exp(-dt * 4));
      this.camYaw = car.h;
      this.camPos.copy(cam.position);
    } else {
      cam.near = 0.25;
      const far = mode === 'far';
      const dist = far ? 10.5 : 6.6;
      const hgt = far ? 3.4 : 2.05;
      // 진행 방향(요)만 부드럽게 따라가고 거리는 고정
      const yawTarget = car.v < -1 ? car.h + Math.PI : car.h;
      this.camYaw += wrapAngle(yawTarget - this.camYaw) * (1 - Math.exp(-dt * (far ? 4.5 : 6)));
      const fy = new THREE.Vector3(Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
      const want = pos.clone().addScaledVector(fy, -(dist + Math.min(1.2, Math.abs(car.v) * 0.012)));
      want.y = hgt;
      this.camPos.copy(want);
      cam.position.copy(this.camPos);
      cam.position.y += sh;
      const look = pos.clone().addScaledVector(fy, 5);
      look.y = far ? 1.0 : 0.95;
      cam.lookAt(look);
      cam.fov = lerp(cam.fov, 58 + Math.min(14, car.v * 0.15), 1 - Math.exp(-dt * 4));
    }
    cam.updateProjectionMatrix();
    this.followLight(pos);
  }

  // 메뉴용 궤도 카메라
  updateOrbit(dt, target, offset = true) {
    this.orbit += dt * 0.12;
    const cam = this.camera;
    const r = 9.5;
    cam.near = 0.25;
    cam.position.set(target.x + Math.cos(this.orbit) * r, 2.4 + Math.sin(this.orbit * 0.7) * 0.6, target.z + Math.sin(this.orbit) * r);
    cam.lookAt(target.x, 0.5, target.z);
    cam.fov = 46;
    // 메뉴가 왼쪽을 덮으므로 차량을 화면 오른쪽에 배치
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (offset && w > 760 && h > 480) cam.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    this.followLight(new THREE.Vector3(target.x, 0, target.z));
  }

  followLight(pos) {
    if (!this.sunLight) return;
    this.sunLight.target.position.copy(pos);
    this.sunLight.position.copy(pos).addScaledVector(this.sunDir, 200);
    this.sky.position.copy(this.camera.position);
  }

  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  }

  render(dt) {
    this.updateParticles(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
