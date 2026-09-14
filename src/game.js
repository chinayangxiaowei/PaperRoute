import * as THREE from 'three';
import { ROUTE, RULES, roadPoint, heading } from './config.js';

const GRAVITY = 18;

export class Game {
  constructor(scene, rider, street, hud, onEnd, dogFactory, sfx) {
    this.scene = scene;
    this.rider = rider;
    this.hud = hud;
    this.onEnd = onEnd;
    this.sfx = sfx;
    this.mailboxes = street.mailboxes;
    this.hazards = street.hazards;
    this.houses = street.houses || [];

    this.x = (ROUTE.roadLeft + ROUTE.roadRight) / 2;
    this.z = 0;
    this.speed = 0;
    this.steer = 0;
    this.lives = RULES.lives;
    this.papers = RULES.papers;
    this.score = 0;
    this.streak = 0;
    this.delivered = 0;
    this.cooldown = 0;
    this.invulnerable = 0;
    this.time = 0;
    this.over = false;
    this.thrown = [];

    this.keys = new Set();
    addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
      if (e.key === ' ') this.tryThrow(null);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('pointerdown', (e) => {
      // 屏幕左半 = 世界 +X 一侧（right 侧邮箱），与视觉一致
      this.tryThrow(e.clientX < innerWidth / 2 ? 'right' : 'left');
    });

    // 狗：出生在固定地块，靠近后激活追逐（GLB 工厂，失败时工厂内部回退程序化）
    this.dogs = street.dogSpawns.map((s) => {
      const d = dogFactory();
      d.group.position.set(s.x, 0, s.z);
      scene.add(d.group);
      return { ...d, home: s, active: false, distracted: 0 };
    });

    this.paperGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.24, 8);
    this.paperMat = new THREE.MeshStandardMaterial({ color: 0xf0ead6, roughness: 0.7 });
  }

  start() {
    this.speed = RULES.cruiseSpeed;
    this.hud.show();
    this.hud.setLives(this.lives);
    this.hud.setPapers(this.papers);
    this.hud.setPoints(0);
  }

  totalSubscribers() {
    return this.mailboxes.filter((m) => m.subscriber).length;
  }

  /** 投递：side 为 null 时自动选最近亮灯邮箱所在侧；
   *  该侧没有可投邮箱时，自动瞄同侧最近房子的窗户（恶作剧/砸窗玩法，对齐原作） */
  tryThrow(side) {
    if (this.over || this.cooldown > 0 || this.papers <= 0) return;
    const candidates = this.mailboxes.filter((m) =>
      !m.delivered && !m.missed && m.pz > this.z - 3 && m.pz < this.z + 16 &&
      (side === null || m.side === side));

    let aim; // 世界坐标目标点
    if (candidates.length) {
      candidates.sort((a, b) => Math.abs(a.pz - this.z - 6) - Math.abs(b.pz - this.z - 6));
      const target = candidates[0];
      aim = new THREE.Vector3(target.x, 1.15, target.z);
    } else {
      // 没有可投邮箱 → 瞄最近房子一扇没碎的窗户（原作：窗户本就是合法目标）
      const hs = this.houses.filter((h) =>
        h.boxes.some((_, bi) => !h.broken?.has(bi)) &&
        h.hz > this.z - 3 && h.hz < this.z + 16 &&
        (side === null || h.side === side));
      if (!hs.length) return;
      hs.sort((a, b) => Math.abs(a.hz - this.z - 6) - Math.abs(b.hz - this.z - 6));
      const h = hs[0];
      const open = h.boxes.map((b, bi) => ({ b, bi })).filter(({ bi }) => !h.broken?.has(bi));
      const pick = open[Math.floor(Math.random() * open.length)];
      aim = pick.b.getCenter(new THREE.Vector3());
    }

    this.cooldown = RULES.throwCooldown;
    this.papers--;
    this.hud.setPapers(this.papers);
    this.sfx?.play('throw');

    const mesh = new THREE.Mesh(this.paperGeo, this.paperMat);
    mesh.castShadow = true;
    const from = new THREE.Vector3(this.wx ?? this.x, 1.4, (this.wz ?? this.z) + 0.5);
    const dist = from.distanceTo(aim);
    const tof = THREE.MathUtils.clamp(dist / 13, 0.35, 1.1);
    const vel = aim.clone().sub(from).divideScalar(tof);
    vel.y += 0.5 * GRAVITY * tof;
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.thrown.push({ mesh, vel, life: 2.2 });
  }

  crash(reason) {
    if (this.invulnerable > 0 || this.over) return;
    this.invulnerable = RULES.crashInvulnerable;
    this.lives--;
    this.streak = 0;
    this.speed = RULES.brakeSpeed;
    this.hud.setLives(this.lives);
    this.hud.popup(reason, true);
    this.sfx?.play('crash');
    if (this.lives <= 0) this.finish(false);
  }

  deliver(mb) {
    mb.delivered = true;
    mb.boxMat.color.set(0x7fc76b);
    mb.boxMat.emissive.set(0x2f8f3f);
    mb.boxMat.emissiveIntensity = 0.5;
    if (mb.flag) mb.flag.rotation.z = Math.PI / 2;
    if (mb.subscriber) {
      this.streak = Math.min(this.streak + 1, RULES.streakCap);
      const pts = RULES.deliveryPoints * Math.max(1, this.streak);
      this.score += pts;
      this.delivered++;
      this.hud.setPoints(this.score);
      this.hud.popup(`+${pts}${this.streak > 1 ? ' ×' + this.streak : ''}`);
      this.sfx?.play('delivery');
    } else {
      this.hud.popup('Wrong house…', true);
      this.sfx?.play('miss');
    }
  }

  /** 砸碎窗户：订户 → 丢订户+清空连击；非订户 → 恶作剧 +400（对齐原作） */
  smashWindow(h, bi) {
    (h.broken ??= new Set()).add(bi);
    const mesh = h.winMeshes[bi];
    const darken = (m) => {
      const c = m.clone();
      if (c.color) c.color.multiplyScalar(0.22);
      if (c.emissive) { c.emissive.set(0x000000); c.emissiveIntensity = 0; }
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(darken) : darken(mesh.material);
    this.sfx?.play('glass');
    if (h.subscriber) {
      h.subscriber = false;
      h.mb.subscriber = false;
      h.mb.boxMat.emissive.set(0x000000);
      h.mb.boxMat.emissiveIntensity = 0;
      this.streak = 0;
      this.hud.popup('Broken window. Subscriber lost.', true);
      this.sfx?.play('miss');
    } else {
      this.score += 400;
      this.hud.setPoints(this.score);
      this.hud.popup('A little mischief. +400');
    }
  }

  finish(won) {
    if (this.over) return;
    this.over = true;
    this.hud.hide();
    this.onEnd({
      score: this.score,
      delivered: this.delivered,
      total: this.totalSubscribers(),
      won,
    });
  }

  update(dt) {
    if (this.over) return;
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);

    /* ---------- 操控 ---------- */
    const k = this.keys;
    let target = RULES.cruiseSpeed;
    if (k.has('arrowup') || k.has('w')) target = RULES.sprintSpeed;
    if (k.has('arrowdown') || k.has('s')) target = RULES.brakeSpeed;
    this.speed += (target - this.speed) * Math.min(1, dt * 3);

    let steer = 0;
    if (k.has('arrowleft') || k.has('a')) steer -= 1;
    if (k.has('arrowright') || k.has('d')) steer += 1;
    this.steer = steer;
    // 注意：相机朝 +Z 看时屏幕左 = 世界 +X，所以取反，让按键方向与屏幕一致
    this.x = THREE.MathUtils.clamp(
      this.x - steer * RULES.steerSpeed * dt, ROUTE.riderMinX, ROUTE.riderMaxX);
    this.z += this.speed * dt;

    // 世界位置 = 弧形中心线 + 横向偏移，车头沿道路切线
    const th = heading(this.z);
    const wp = roadPoint(this.z, this.x);
    this.wx = wp.x; this.wz = wp.z;
    this.rider.group.position.set(wp.x, 0, wp.z);
    this.rider.group.rotation.y = th;
    this.rider.update(dt, this.speed, steer);
    // 受击闪烁（验证模式的超大 invulnerable 不触发闪烁）
    const flashing = this.invulnerable > 0 && this.invulnerable < 1e8;
    this.rider.group.visible = !flashing || Math.floor(this.time * 12) % 2 === 0;

    /* ---------- 邮箱：亮灯 / 错过（按路线进度比较） ---------- */
    for (const mb of this.mailboxes) {
      const dz = mb.pz - this.z;
      const lit = !mb.delivered && !mb.missed && dz > -2 && dz < 22;
      if (lit !== mb.lit) {
        mb.lit = lit;
        if (mb.subscriber) mb.boxMat.emissiveIntensity = lit ? 0.9 : 0;
      }
      if (lit && mb.subscriber) {
        mb.boxMat.emissiveIntensity = 0.6 + Math.sin(this.time * 6) * 0.3;
      }
      if (!mb.delivered && !mb.missed && mb.subscriber && dz < -6) {
        mb.missed = true;
        this.streak = 0;
        this.hud.popup('Subscriber cancels!', true);
        this.sfx?.play('miss');
      }
    }

    /* ---------- 障碍（按路线进度 + 横向偏移比较） ---------- */
    for (const h of this.hazards) {
      if (Math.abs(h.hz - this.z) < 0.9 && Math.abs(h.offset - this.x) < h.r + 0.25) {
        this.crash(h.type === 'pothole' ? 'Pothole! -1♥' : 'Trash can! -1♥');
      }
    }

    /* ---------- 狗 ---------- */
    for (const d of this.dogs) {
      const p = d.group.position;
      if (!d.active && this.z > d.home.z - 24 && this.z < d.home.z) {
        d.active = true;
        this.hud.popup('The dog!', true);
        this.sfx?.play('bark');
      }
      if (!d.active) continue;
      if (d.distracted > 0) {
        d.distracted -= dt;
        d.update(dt, false);
        continue;
      }
      const dx = (this.wx ?? this.x) - p.x, dz = (this.wz ?? this.z) - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 45 || this.z > d.home.z + 30) { d.active = false; continue; }
      const sp = 8.2;
      p.x += (dx / dist) * sp * dt;
      p.z += (dz / dist) * sp * dt;
      d.group.rotation.y = Math.atan2(dx, dz);
      d.update(dt, true);
      if (dist < 1.0) {
        d.active = false;
        this.crash('Bitten! -1♥');
      }
    }

    /* ---------- 报纸飞行 ---------- */
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const p = this.thrown[i];
      p.vel.y -= GRAVITY * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 14;
      p.life -= dt;
      const pp = p.mesh.position;
      let hit = false;
      for (const mb of this.mailboxes) {
        if (mb.delivered) continue;
        if (Math.abs(mb.z - pp.z) < 0.9 && Math.abs(mb.x - pp.x) < RULES.hitRadius &&
            pp.y > 0.5 && pp.y < 1.9) {
          this.deliver(mb);
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (const d of this.dogs) {
          if (!d.active || d.distracted > 0) continue;
          if (pp.distanceTo(d.group.position.clone().setY(pp.y)) < 1.3) {
            d.distracted = 5;
            this.hud.popup('Dog distracted!');
            hit = true;
            break;
          }
        }
      }
      // 窗户碰撞：玻璃碎裂（恶作剧 +400 / 订户流失）
      if (!hit) {
        for (const h of this.houses) {
          if (Math.abs(h.hz - this.z) > 30) continue;
          for (let bi = 0; bi < h.boxes.length; bi++) {
            if (h.broken?.has(bi)) continue;
            if (h.boxes[bi].containsPoint(pp)) {
              this.smashWindow(h, bi);
              hit = true;
              break;
            }
          }
          if (hit) break;
        }
      }
      if (hit || p.life <= 0 || pp.y < 0) {
        this.scene.remove(p.mesh);
        this.thrown.splice(i, 1);
      }
    }

    /* ---------- 终点 ---------- */
    if (this.z >= ROUTE.finish) this.finish(true);

    /* ---------- HUD ---------- */
    this.hud.setSpeed(this.speed);
    this.hud.setClock(this.time);
    this.hud.drawRadar(this.z, this.mailboxes, this.hazards, this.dogs);
  }
}
