import * as THREE from 'three';
import { ROUTE, SEED, mulberry32, centerX, heading, roadPoint } from './config.js';
import { FAMILIES, instantiateHouse } from './assets.js';
import { applyWash } from './paint.js';

const M = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0x565c74, roughness: 0.96 }),
  pavement: new THREE.MeshStandardMaterial({ color: 0xb3af9e, roughness: 0.95 }),
  curb: new THREE.MeshStandardMaterial({ color: 0xc6c1ab, roughness: 0.9 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x5e8a46, roughness: 1 }),
  lawn: new THREE.MeshStandardMaterial({ color: 0x6da054, roughness: 1 }),
  driveway: new THREE.MeshStandardMaterial({ color: 0xb0ad9b, roughness: 0.95 }),
  line: new THREE.MeshStandardMaterial({ color: 0xe8dfb2, roughness: 0.9 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4e34, roughness: 1 }),
  fence: new THREE.MeshStandardMaterial({ color: 0xf3edd8, roughness: 0.9 }),
  post: new THREE.MeshStandardMaterial({ color: 0x5d4a36, roughness: 0.95 }),
  pothole: new THREE.MeshStandardMaterial({ color: 0x2b3044, roughness: 1 }),
  can: new THREE.MeshStandardMaterial({ color: 0x7d8b91, roughness: 0.6, metalness: 0.5 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.8 }),
  lampGlow: new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffc76b, emissiveIntensity: 1.6 }),
};

/* ---------- 手绘树叶贴图（原作素材，本地占位） ---------- */
let foliageTex = null;
export function setFoliageTexture(tex) {
  foliageTex = tex;
  if (foliageTex) {
    foliageTex.colorSpace = THREE.SRGBColorSpace;
    foliageTex.anisotropy = 4;
  }
}

// 街道大面积材质统一叠水粉罩染（路面/人行道/路缘/草地/草坪/车道）
for (const key of ['asphalt', 'pavement', 'curb', 'grass', 'lawn', 'driveway']) {
  applyWash(M[key], key === 'asphalt' ? 0.06 : 0.09);
}

// 特殊地块：豪宅 / 庄园 / L 形房（对应原作特定 lotIndex 的 mansion/estate）
const SPECIAL_LOTS = { 6: 'estate', 12: 'mansion', 17: 'lshape' };

export function buildStreet(scene, houseLib) {
  const rng = mulberry32(SEED);
  const root = new THREE.Group();
  root.name = 'street';
  scene.add(root);

  const R = ROUTE;
  const zStart = -30, zEnd = R.finish + 80;

  /* ---------- 弧形带状路面 / 人行道 / 路缘（顶面与旧直路一致：路面 0、人行道 0.02、路缘 0.11） ---------- */
  root.add(ribbon(zStart, zEnd, R.roadLeft, R.roadRight, -0.1, 0.1, M.asphalt));
  root.add(ribbon(zStart, zEnd, R.roadLeft - 2.3, R.roadLeft - 0.1, -0.1, 0.12, M.pavement));
  root.add(ribbon(zStart, zEnd, R.roadRight + 0.1, R.roadRight + 2.3, -0.1, 0.12, M.pavement));
  root.add(ribbon(zStart, zEnd, R.roadLeft - 0.3, R.roadLeft, -0.11, 0.22, M.curb));
  root.add(ribbon(zStart, zEnd, R.roadRight, R.roadRight + 0.3, -0.11, 0.22, M.curb));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(320, (zEnd - zStart) + 240), M.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.13, (zStart + zEnd) / 2);
  ground.receiveShadow = true;
  root.add(ground);

  // 路面中线（虚线，沿曲线摆放；路面 -4~9，中心偏移 2.5）
  const midOffset = (R.roadLeft + R.roadRight) / 2;
  for (let z = zStart; z < zEnd; z += 6) {
    const p = roadPoint(z, midOffset);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 2.2), M.line);
    dash.position.set(p.x, 0.01, p.z);
    dash.rotation.y = p.th;
    root.add(dash);
  }

  /* ---------- 订阅户：种子化挑选 10 户 ---------- */
  const subscriberSet = pickSubscribers(rng);

  /* ---------- 逐地块沿弧线摆放 ---------- */
  const mailboxes = [];
  const hazards = [];
  const dogSpawns = [];
  const houses = [];   // 每栋房：窗户世界包围盒 + 订户状态（砸窗户玩法用）

  for (const side of ['left', 'right']) {
    const sideSign = side === 'left' ? -1 : 1;
    for (let i = 0; i < R.houseCount; i++) {
      const z = R.firstHouse + i * R.houseSpacing + (side === 'right' ? R.rightOffset : 0);
      const th = heading(z);
      const key = `${side}:${i}`;
      const subscriber = subscriberSet.has(key);
      const family = SPECIAL_LOTS[i] || FAMILIES[(i + (side === 'right' ? 2 : 0)) % FAMILIES.length];

      const place = (obj, offset, rotExtra = 0, zOverride = null) => {
        const p = roadPoint(zOverride ?? z, offset);
        obj.position.set(p.x, obj.position.y, p.z);
        obj.rotation.y = (zOverride != null ? heading(zOverride) : th) + rotExtra;
        root.add(obj);
        return p;
      };

      // 草坪：只铺在房子周围，不越过人行道（左侧人行道外缘 -6.4，右侧 11.4）
      const lawnOffset = side === 'left' ? -13 : 19;
      place(boxMesh(M.lawn, [side === 'left' ? 12 : 10, 0.05, R.houseSpacing - 1.2], -0.03), lawnOffset);

      // 房子（GLB 实例 + 种子化变色）
      const house = instantiateHouse(houseLib, family, rng);
      place(house, side === 'left' ? R.leftHouseX : R.rightHouseX, side === 'right' ? Math.PI : 0);

      // 车道 / 门前小路：连接房门与人行道，不伸进路面
      const dwOffset = side === 'left' ? -8.3 : 14.8;
      const dwWidth = side === 'left' ? 7.4 : 7;
      if (rng() < 0.7) place(boxMesh(M.driveway, [dwWidth, 0.04, 2.6], -0.025), dwOffset);
      place(boxMesh(M.driveway, [dwWidth * 0.8, 0.04, 1.1], -0.025), dwOffset);

      // 邮箱
      const mbOffset = side === 'left' ? R.leftMailboxX : R.rightMailboxX;
      const mb = buildMailbox(side, subscriber);
      const mp = place(mb.group, mbOffset, side === 'right' ? Math.PI : 0);
      mb.x = mp.x; mb.z = mp.z; mb.offset = mbOffset; mb.pz = z;
      mailboxes.push(mb);

      // 登记房屋：收集窗户网格（材质名含 'Painted window'），供砸窗户判定
      {
        const winMeshes = [];
        house.traverse((o) => {
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          if (mats.some((m) => m.name && m.name.includes('Painted window'))) winMeshes.push(o);
        });
        houses.push({ side, index: i, hz: z, subscriber, mb, winMeshes, boxes: [] });
      }

      // 树：种在房侧草坪，错开正门（z 方向偏开 4~7m），横向避让人行道与房子前墙
      if (rng() < 0.75) {
        const tOffset = side === 'left' ? -(6.7 + rng() * 0.9) : (12.8 + rng() * 2.4);
        const tz = z + (rng() < 0.5 ? -1 : 1) * (4 + rng() * 3);
        place(buildTree(0.8 + rng() * 0.7, rng), tOffset, 0, tz);
      }

      // 白色栅栏：草坪前缘（缩短长度，避免弯道上切入路面）
      if (rng() < 0.45) {
        place(buildFence(R.houseSpacing * 0.55), side === 'left' ? -7.2 : 12.4);
      }

      // 障碍：坑洼（路上）与垃圾桶（路缘）
      if (i > 1 && rng() < 0.4) {
        const hz = z + (rng() - 0.5) * 12;
        const hOffset = R.roadLeft + 1.5 + rng() * (R.roadRight - R.roadLeft - 3);
        const hp = roadPoint(hz, hOffset);
        const p = new THREE.Mesh(new THREE.CircleGeometry(0.7 + rng() * 0.3, 20), M.pothole);
        p.rotation.x = -Math.PI / 2;
        p.position.set(hp.x, 0.015, hp.z);
        root.add(p);
        hazards.push({ type: 'pothole', x: hp.x, z: hp.z, offset: hOffset, hz, r: 0.85 });
      }
      if (i > 1 && rng() < 0.3) {
        const cOffset = side === 'left' ? R.roadLeft - 0.9 : R.roadRight + 0.9;
        const cz = z + (rng() - 0.5) * 8;
        const cp = roadPoint(cz, cOffset);
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.8, 10), M.can);
        can.position.set(cp.x, 0.4, cp.z);
        can.castShadow = true;
        root.add(can);
        hazards.push({ type: 'can', x: cp.x, z: cp.z, offset: cOffset, hz: cz, r: 0.6 });
      }

      // 狗的出没点（固定在几块订阅户地块，门前草坪带）
      if ((i === 5 && side === 'right') || (i === 10 && side === 'left') || (i === 15 && side === 'right')) {
        const dp = roadPoint(z + 4, side === 'left' ? -7 : 13);
        dogSpawns.push({ x: dp.x, z: dp.z });
      }
    }
  }

  /* ---------- 路灯（沿弧线交错） ---------- */
  for (let z = 10, k = 0; z < R.finish + 40; z += 34, k++) {
    const offset = k % 2 ? R.roadLeft - 1.6 : R.roadRight + 1.6;
    const p = roadPoint(z, offset);
    const lamp = buildLamp(k % 2 ? 1 : -1);
    lamp.position.set(p.x, 0, p.z);
    lamp.rotation.y = p.th;
    root.add(lamp);
  }

  /* ---------- 终点横幅 ---------- */
  {
    const th = heading(R.finish);
    const banner = new THREE.Group();
    const w = R.roadRight - R.roadLeft;
    addBox(banner, M.post, [0.2, 6, 0.2], [R.roadLeft - 1, 3, 0]);
    addBox(banner, M.post, [0.2, 6, 0.2], [R.roadRight + 1, 3, 0]);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w + 2, 1.4),
      new THREE.MeshStandardMaterial({ map: makeBannerTexture(), side: THREE.DoubleSide, roughness: 0.9 }));
    cloth.position.set((R.roadLeft + R.roadRight) / 2, 5.2, 0);
    cloth.rotation.y = Math.PI; // 平面正面默认朝 +Z（顺路），转 180° 让正面迎着骑手，文字不镜像
    banner.add(cloth);
    const p = roadPoint(R.finish, 0);
    banner.position.set(p.x, 0, p.z);
    banner.rotation.y = th;   // 本地 X 轴 = 道路横向，横幅跨路
    root.add(banner);
  }

  /* ---------- 窗户世界包围盒（场景静态，一次性计算） ---------- */
  root.updateWorldMatrix(true, true);
  for (const h of houses) {
    h.boxes = h.winMeshes.map((m) => new THREE.Box3().setFromObject(m).expandByScalar(0.25));
  }

  return { root, mailboxes, hazards, dogSpawns, houses };
}

/** 沿中心线的带状几何（路面/人行道/路缘通用） */
function ribbon(zStart, zEnd, offsetA, offsetB, yBottom, height, mat) {
  const step = 2;
  const positions = [];
  const indices = [];
  let vi = 0;
  for (let z = zStart; z <= zEnd; z += step) {
    const a = roadPoint(z, offsetA), b = roadPoint(z, offsetB);
    positions.push(a.x, yBottom, a.z, b.x, yBottom, b.z,
                   a.x, yBottom + height, a.z, b.x, yBottom + height, b.z);
    if (vi > 0) {
      const s = vi - 4;
      // 顶面（注意绕序：保证法线朝上 +Y）
      indices.push(s + 2, vi + 2, s + 3, s + 3, vi + 2, vi + 3);
      // 两个侧面
      indices.push(s, s + 2, vi, s + 2, vi + 2, vi);
      indices.push(s + 1, vi + 1, s + 3, s + 3, vi + 1, vi + 3);
    }
    vi += 4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** 终点横幅贴图：米色底 + 格纹上下边 + FINISH 字样 */
function makeBannerTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 112;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4edd8';
  ctx.fillRect(0, 0, c.width, c.height);
  // 上下黑白格纹边
  const s = 14;
  for (const row of [0, c.height - s]) {
    for (let x = 0; x < c.width; x += s) {
      ctx.fillStyle = (x / s) % 2 ? '#1d1a14' : '#f4edd8';
      ctx.fillRect(x, row, s, s);
    }
  }
  ctx.fillStyle = '#1d1a14';
  ctx.font = '900 62px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('— FINISH —', c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function pickSubscribers(rng) {
  const all = [];
  for (const side of ['left', 'right']) {
    for (let i = 0; i < ROUTE.houseCount; i++) all.push(`${side}:${i}`);
  }
  const pool = all.filter((k) => !k.endsWith(':0') && !k.endsWith(':1'));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return new Set(pool.slice(0, 10));
}

function buildMailbox(side, subscriber) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.09), M.post);
  post.position.y = 0.5;
  g.add(post);

  const boxMat = new THREE.MeshStandardMaterial({
    color: subscriber ? 0xf2ce7c : 0x8d927e,
    roughness: 0.6,
    emissive: subscriber ? 0xffb54d : 0x000000,
    emissiveIntensity: 0,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.55), boxMat);
  box.position.y = 1.12;
  box.castShadow = true;
  g.add(box);

  let flag = null;
  if (subscriber) {
    flag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xd8443c, emissive: 0xd8443c, emissiveIntensity: 0.4 }));
    flag.position.set(0.2, 1.35, -0.15);
    g.add(flag);
  }
  return { group: g, box, boxMat, flag, side, x: 0, z: 0, offset: 0, subscriber, delivered: false, missed: false, lit: false };
}

function buildTree(s, rng = Math.random) {
  const t = new THREE.Group();
  const trunkH = 2.0 * s;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.22 * s, trunkH, 7), M.trunk);
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  t.add(trunk);

  if (foliageTex) {
    // 原作做法：手绘树叶贴图 + 交叉面片（alphaTest 裁切）
    const tint = new THREE.Color().setHSL(0.26 + rng() * 0.06, 0.45, 0.5 + rng() * 0.12);
    const mat = new THREE.MeshStandardMaterial({
      map: foliageTex, alphaTest: 0.45, side: THREE.DoubleSide,
      roughness: 1, metalness: 0, color: tint,
    });
    const layers = [
      { y: trunkH + 0.9 * s, size: 3.4 * s, count: 2, rot: 0 },
      { y: trunkH + 1.9 * s, size: 2.6 * s, count: 2, rot: Math.PI / 4 },
      { y: trunkH + 0.1 * s, size: 2.4 * s, count: 1, rot: Math.PI / 6 },
    ];
    for (const L of layers) {
      for (let i = 0; i < L.count; i++) {
        const card = new THREE.Mesh(new THREE.PlaneGeometry(L.size, L.size), mat);
        card.position.y = L.y;
        card.rotation.y = L.rot + (i * Math.PI) / L.count;
        card.castShadow = true;
        t.add(card);
      }
    }
  } else {
    // 无贴图时的几何后备
    const leafM = new THREE.MeshStandardMaterial({ color: 0x4f7a40, roughness: 1 });
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry((1.1 - i * 0.22) * s, 8, 6), leafM);
      leaf.position.set((Math.sin(i * 2.4) * 0.35) * s, (1.9 + i * 0.75) * s, (Math.cos(i * 2.4) * 0.35) * s);
      leaf.castShadow = true;
      t.add(leaf);
    }
  }
  return t;
}

function buildFence(len) {
  const f = new THREE.Group();
  const n = Math.floor(len / 0.55);
  for (let i = 0; i < n; i++) {
    addBox(f, M.fence, [0.07, 0.75, 0.16], [0, 0.37, -len / 2 + i * 0.55]);
  }
  addBox(f, M.fence, [0.05, 0.08, len], [0, 0.62, 0]);
  return f;
}

function buildLamp(dir) {
  const g = new THREE.Group();
  addBox(g, M.lamp, [0.12, 4.6, 0.12], [0, 2.3, 0]);
  addBox(g, M.lamp, [1.4, 0.1, 0.1], [dir * 0.65, 4.6, 0]);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), M.lampGlow);
  bulb.position.set(dir * 1.3, 4.5, 0);
  g.add(bulb);
  return g;
}

function boxMesh(mat, [w, h, d], y = null) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.y = y ?? (h / 2 - 0.03);
  m.receiveShadow = true;
  return m;
}

function addBox(parent, mat, [w, h, d], [x, y, z]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = h > 0.2;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
