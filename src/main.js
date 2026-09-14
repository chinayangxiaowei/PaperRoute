import * as THREE from 'three';
import { loadHouseLibrary } from './assets.js';
import { buildStreet, setFoliageTexture } from './street.js';
import { buildRiderAsync, buildDogFactory } from './rider.js';
import { Game } from './game.js';
import { Hud, showIntro, showResults } from './hud.js';
import { SoundFX } from './sound.js';
import { heading, roadPoint } from './config.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();

/* ---------- 插画风天空：原作手绘蓝天 + 远景小镇环幕 ---------- */
const texLoader = new THREE.TextureLoader();
const skyTex = texLoader.load('/art/summer-sky.png');
skyTex.mapping = THREE.EquirectangularReflectionMapping;
skyTex.colorSpace = THREE.SRGBColorSpace;
scene.background = skyTex;
scene.environment = skyTex;                    // 给所有材质一层天光环境反射
scene.backgroundRotation.y = Math.PI;          // 贴图接缝转到出发方向（背后）
scene.environmentRotation.y = Math.PI;
scene.backgroundIntensity = 1.0;
scene.environmentIntensity = 0.55;
scene.fog = new THREE.Fog(0xc8dcf0, 60, 240);  // 雾色融入地平线

// 远景小镇环幕（alpha 剪影，绕街道一圈）
const townTex = texLoader.load('/art/summer-town.png');
townTex.colorSpace = THREE.SRGBColorSpace;
townTex.wrapS = THREE.RepeatWrapping;
townTex.repeat.x = 2;                            // 减少平铺次数 = 减少山体接缝
{
  const ringH = 58, ringR = 230;
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(ringR, ringR, ringH, 64, 1, true),
    new THREE.MeshBasicMaterial({
      map: townTex, transparent: true, alphaTest: 0.3, side: THREE.BackSide,
      fog: false, depthWrite: false,
    }));
  ring.position.set(0, ringH / 2 - 6, 210);
  ring.rotation.y = Math.PI / 2;                 // 仅剩的 2 条接缝藏到街道两侧
  scene.add(ring);
}

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 500);

/* ---------- 灯光：明亮夏日晨光 ---------- */
const sun = new THREE.DirectionalLight(0xfff0d6, 2.8);
sun.position.set(40, 45, -25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 200;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbfd8f0, 0x7a9455, 1.15));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------- 启动流程：加载素材 → 建街 → 开场报纸 ---------- */
const boot = async () => {
  const { lib, fromGLB } = await loadHouseLibrary();
  console.log(`[boot] 房屋库来源: ${fromGLB ? 'GLB 素材' : '程序化后备'}`);
  // 手绘树叶贴图（原作素材，失败则树退化为几何体）
  try {
    const ft = await texLoader.loadAsync('/art/painted-foliage.png');
    setFoliageTexture(ft);
  } catch { console.warn('[boot] 树叶贴图不可用，使用几何树'); }
  const street = buildStreet(scene, lib);
  const rider = await buildRiderAsync();
  const dogFactory = await buildDogFactory();
  scene.add(rider.group);
  rider.group.position.set(2.5, 0, 0);

  const hud = new Hud();
  const sfx = new SoundFX();
  const game = new Game(scene, rider, street, hud, (result) => showResults(result), dogFactory, sfx);

  /* ---------- 背景音乐：原作 retro-melody（1.2 倍速，与原作一致），点"开始"后循环播放 ---------- */
  const bgm = new Audio('/audio/retro-melody.mp3');
  bgm.loop = true;
  bgm.volume = 0.4;
  bgm.playbackRate = 1.2;
  const startBgm = () => bgm.play().catch(() => {}); // 浏览器自动播放限制：由按钮点击触发

  showIntro(() => { sfx.unlock(); startBgm(); game.start(); });
  // 验证钩子：?auto 跳过开场直接进入骑行（供无头浏览器截图验证）
  if (new URLSearchParams(location.search).has('auto')) {
    document.getElementById('intro').classList.add('hidden');
    game.start();
    game.invulnerable = 1e9; // 验证模式：免撞死，方便观察全程
    // 确定性预跑：不依赖无头浏览器的虚拟时间推进（跑到第一只狗的位置）
    for (let i = 0; i < 870; i++) {
      game.update(1 / 60);
      if (i % 40 === 0) game.tryThrow(null);
    }
    // 预跑后把相机直接吸附到骑手身后
    const th0 = heading(game.z);
    const a0 = roadPoint(game.z, game.x * 0.6);
    camera.position.set(a0.x - Math.sin(th0) * 9.5, 4.6, a0.z - Math.cos(th0) * 9.5);
  }

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    game.update(dt);

    // 第三人称跟随相机：沿道路切线跟在骑手身后
    const z = game.z, th = heading(z);
    const anchor = roadPoint(z, game.x * 0.6);
    const fx = Math.sin(th), fz = Math.cos(th);
    camera.position.lerp(
      new THREE.Vector3(anchor.x - fx * 9.5, 4.6, anchor.z - fz * 9.5),
      Math.min(1, dt * 5));
    camera.lookAt(anchor.x + fx * 9, 1.1, anchor.z + fz * 9);
    sun.position.set(anchor.x + 40, 45, anchor.z - 25);
    sun.target.position.set(anchor.x, 0, anchor.z);

    renderer.render(scene, camera);
  });
};

boot().catch((err) => {
  document.getElementById('load-text').textContent = `加载失败：${err.message}`;
  console.error(err);
});
