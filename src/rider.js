import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

/* ============ 原作 GLB 模型（本地占位素材，失败时回退程序化模型） ============ */

/** 骑手：posed-rider.glb（含 FittedBicycle，前后轮/脚踏是独立节点，可驱动） */
export async function buildRiderAsync() {
  try {
    const gltf = await new GLTFLoader().loadAsync('/art/posed-rider.glb');
    const root = gltf.scene;

    // 以后轮直径对齐真实轮径 0.68m 做归一化
    const rear = root.getObjectByName('rear-wheel');
    const front = root.getObjectByName('front-wheel');
    if (rear) {
      const wb = new THREE.Box3().setFromObject(rear);
      const dia = Math.max(wb.max.y - wb.min.y, 0.01);
      root.scale.setScalar(0.68 / dia);
    }
    root.updateMatrixWorld(true);
    const all = new THREE.Box3().setFromObject(root);
    root.position.y -= all.min.y; // 落地
    root.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    });

    const group = new THREE.Group();
    group.add(root);
    return {
      group,
      glb: true,
      update(dt, speed, steer) {
        const spin = dt * speed / 0.34;
        if (front) front.rotation.x += spin;
        if (rear) rear.rotation.x += spin;
        group.rotation.z = -steer * 0.12;
      },
    };
  } catch (err) {
    console.warn('[rider] GLB 加载失败，使用程序化模型：', err.message);
    return buildRider();
  }
}

/** 狗工厂：加载一次模板，每只狗用 SkeletonUtils 克隆（带骨骼动画） */
export async function buildDogFactory() {
  try {
    const gltf = await new GLTFLoader().loadAsync('/art/playable-dog.glb');
    const template = gltf.scene;
    return () => {
      const root = skeletonClone(template);
      const b = new THREE.Box3().setFromObject(root);
      const sy = Math.max(b.max.y - b.min.y, 0.01);
      root.scale.setScalar(0.95 / sy); // 肩高归一化
      root.updateMatrixWorld(true);
      const b2 = new THREE.Box3().setFromObject(root);
      root.position.y -= b2.min.y;
      root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

      const legs = ['front_L_upper', 'front_R_upper', 'hind_L_thigh', 'hind_R_thigh']
        .map((n) => root.getObjectByName(n))
        .filter(Boolean)
        .map((bone) => ({ bone, baseX: bone.rotation.x }));
      const tail = root.getObjectByName('tail_0');
      const tailBase = tail ? tail.rotation.y : 0;

      const group = new THREE.Group();
      group.add(root);
      let t = 0;
      return {
        group,
        update(dt, running) {
          if (!running) return;
          t += dt * 11;
          legs.forEach(({ bone, baseX }, i) => {
            bone.rotation.x = baseX + Math.sin(t + (i % 2) * Math.PI) * 0.55;
          });
          if (tail) tail.rotation.y = tailBase + Math.sin(t * 1.6) * 0.4;
        },
      };
    };
  } catch (err) {
    console.warn('[dog] GLB 加载失败，使用程序化模型：', err.message);
    return () => buildDog();
  }
}

/* ============ 程序化后备模型 ============ */

// 程序化报童 + 自行车（占位模型，接口与 GLB 角色一致：group + update）
export function buildRider() {
  const group = new THREE.Group();
  const bike = new THREE.Group();
  const body = new THREE.Group();
  group.add(bike, body);

  const frameM = new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.5, metalness: 0.4 });
  const tireM = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9 });
  const skinM = new THREE.MeshStandardMaterial({ color: 0xe8b98d, roughness: 0.8 });
  const shirtM = new THREE.MeshStandardMaterial({ color: 0x3e6f8e, roughness: 0.85 });
  const shortsM = new THREE.MeshStandardMaterial({ color: 0x8a4f38, roughness: 0.9 });
  const capM = new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.8 });
  const bagM = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.85 });

  // 车轮：TorusGeometry 默认在 XY 平面（面朝 Z），需绕 Y 转 90° 让轮面与前进方向（Z）平行
  const wheelGeo = new THREE.TorusGeometry(0.34, 0.05, 8, 20);
  wheelGeo.rotateY(Math.PI / 2);
  const wheelF = new THREE.Mesh(wheelGeo, tireM);
  const wheelB = new THREE.Mesh(wheelGeo, tireM);
  wheelF.position.set(0, 0.34, 0.52);
  wheelB.position.set(0, 0.34, -0.42);
  bike.add(wheelF, wheelB);

  // 车架
  const bar = (x1, y1, z1, x2, y2, z2, r = 0.03) => {
    const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), frameM);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    bike.add(m);
    return m;
  };
  bar(0, 0.34, -0.42, 0, 0.85, -0.1);   // 座管
  bar(0, 0.34, 0.52, 0, 0.8, 0.42);     // 前管
  bar(0, 0.85, -0.1, 0, 0.8, 0.42);     // 上管
  bar(0, 0.34, -0.42, 0, 0.34, 0.52, 0.02); // 下叉
  bar(0, 0.8, 0.42, 0, 0.95, 0.42, 0.025);  // 把立
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.44, 6), frameM);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, 0.97, 0.42);
  bike.add(handle);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.26), tireM);
  seat.position.set(0, 0.88, -0.12);
  bike.add(seat);

  // 男孩身体
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.32, 4, 8), shirtM);
  torso.position.set(0, 1.2, -0.05);
  torso.rotation.x = 0.25;
  body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skinM);
  head.position.set(0, 1.56, 0.02);
  body.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), capM);
  cap.position.copy(head.position).add(new THREE.Vector3(0, 0.02, 0));
  body.add(cap);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 12, 1, false, 0, Math.PI), capM);
  brim.position.copy(head.position).add(new THREE.Vector3(0, 0.05, 0.14));
  body.add(brim);

  // 手臂（前伸握把）
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.4, 4, 6), shirtM);
    arm.position.set(s * 0.18, 1.28, 0.22);
    arm.rotation.x = 1.0;
    body.add(arm);
  }
  // 腿（踩踏动画在 update 中驱动）
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.42, 4, 6), shortsM);
    leg.position.set(s * 0.11, 0.75, -0.05);
    body.add(leg);
    legs.push(leg);
  }
  // 报纸挎包
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.12), bagM);
  bag.position.set(0.26, 1.15, -0.18);
  body.add(bag);

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

  let pedal = 0;
  return {
    group,
    update(dt, speed, steer) {
      pedal += dt * speed * 2.4;
      const spin = dt * speed / 0.34;
      wheelF.rotation.x += spin;
      wheelB.rotation.x += spin;
      legs[0].rotation.x = Math.sin(pedal) * 0.55;
      legs[1].rotation.x = Math.sin(pedal + Math.PI) * 0.55;
      group.rotation.z = -steer * 0.12;           // 过弯压弯
      body.position.y = Math.abs(Math.sin(pedal)) * 0.02;
    },
  };
}

// 简易狗模型：追逐障碍
export function buildDog() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.4, 4, 8), fur);
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.35;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), fur);
  head.position.set(0, 0.5, 0.38);
  g.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.16), fur);
  snout.position.set(0, 0.45, 0.52);
  g.add(snout);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.015, 0.3, 5), fur);
  tail.position.set(0, 0.5, -0.32);
  tail.rotation.x = -0.9;
  g.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.1, 0.2], [0.1, 0.2], [-0.1, -0.18], [0.1, -0.18]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.32, 5), fur);
    leg.position.set(x, 0.16, z);
    g.add(leg);
    legs.push(leg);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  let t = 0;
  return {
    group: g,
    update(dt, running) {
      if (!running) return;
      t += dt * 12;
      legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t + (i % 2) * Math.PI) * 0.7; });
      tail.rotation.z = Math.sin(t * 1.5) * 0.4;
    },
  };
}
