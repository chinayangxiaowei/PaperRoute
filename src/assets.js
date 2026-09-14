import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyGouache, aliasPaintMask } from './paint.js';

// 户型族：普通 4 种按地块轮换，特殊 3 种放在特定地块（与原作结构一致）
export const FAMILIES = ['ranch', 'clapboard', 'craftsman', 'cottage'];
export const SPECIAL = ['mansion', 'estate', 'lshape'];

/**
 * 加载房屋 GLB 库。素材接口集中在这里 —— 之后换成自建模时只需替换本文件。
 * 加载失败时回退到程序化盒体房屋，保证游戏始终可玩。
 */
export async function loadHouseLibrary(url = '/art/playable-houses.glb') {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const lib = {};
    for (const name of [...FAMILIES, ...SPECIAL]) {
      const node = gltf.scene.getObjectByName(name);
      if (!node) throw new Error(`House library is missing a required family: ${name}`);
      lib[name] = prepareFamily(node);
    }
    return { lib, fromGLB: true };
  } catch (err) {
    console.warn('[assets] GLB 加载失败，使用程序化后备房屋：', err.message);
    const lib = {};
    for (const name of [...FAMILIES, ...SPECIAL]) lib[name] = buildFallbackHouse(name);
    return { lib, fromGLB: false };
  }
}

// 各户型的"墙板"材质名关键字 —— 变色只动这些，保留门窗/门廊原色
const SIDING_KEYS = ['Ranch /', 'Clapboard / cornflower', 'Clapboard / pale', 'Craftsman /',
  'Cottage / apricot', 'Mansion / sun', 'Estate / pale rose', 'Slate /'];
const WINDOW_KEY = 'Painted window';

function prepareFamily(node) {
  node.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    aliasPaintMask(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.name && m.name.includes(WINDOW_KEY)) {
        // 清晨亮灯的窗户 —— 截图里的暖黄窗光
        m.emissive = new THREE.Color(0xffb254);
        m.emissiveIntensity = 0.85;
      }
      applyGouache(m); // 手绘罩染：让纯色墙面呈现画纸质感
    }
  });
  return node;
}

/**
 * 实例化一户房子：克隆 + 按种子给墙板变色（对应原作的 seeded siding 配色）
 */
export function instantiateHouse(lib, family, rng) {
  const src = lib[family] || lib[FAMILIES[0]];
  const house = src.clone(true);
  const hueShift = (rng() - 0.5) * 0.09;
  const lightShift = (rng() - 0.5) * 0.16;
  const tinted = new Map();
  house.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = mats.map((m) => {
      if (!m.name || !SIDING_KEYS.some((k) => m.name.includes(k))) return m;
      if (!tinted.has(m.uuid)) {
        const c = m.clone();
        c.color.offsetHSL(hueShift, 0.02, lightShift);
        delete c.userData.gouache; // clone 不会带上 onBeforeCompile，需要重新注入
        applyGouache(c);
        tinted.set(m.uuid, c);
      }
      return tinted.get(m.uuid);
    });
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
  });
  return house;
}

/* ---------------- 程序化后备房屋（无 GLB 时） ---------------- */
function buildFallbackHouse(family) {
  const g = new THREE.Group();
  g.name = family;
  const big = family === 'mansion' || family === 'estate' || family === 'lshape';
  const w = big ? 10 : 7, h = big ? 7 : 4.5, d = big ? 10 : 7;
  const siding = new THREE.MeshStandardMaterial({ name: `fallback-siding-${family}`, color: 0xc9b990, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf2ead2, roughness: 0.85 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x5d6e72, roughness: 0.95 });
  const winM = new THREE.MeshStandardMaterial({ color: 0x274b63, emissive: 0xffb254, emissiveIntensity: 0.85 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), siding);
  body.position.y = h / 2;
  g.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, h * 0.55, 4), roofM);
  roof.position.y = h + h * 0.27;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);

  // 正面（+x 方向）门窗
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.1, 1.1), trim);
  door.position.set(d / 2 + 0.02, 1.05, 0);
  g.add(door);
  for (const z of [-w / 4, w / 4]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 1.2), winM);
    win.position.set(d / 2 + 0.02, h * 0.55, z);
    g.add(win);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
