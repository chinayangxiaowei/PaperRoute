// 路线与玩法常量 —— 参考 paperroute.lol 的数值（20 户/侧、间距 17m、z=20 起步）
export const ROUTE = {
  houseCount: 20,        // 每侧地块数
  houseSpacing: 17,      // 地块间距（米）
  firstHouse: 20,        // 第一栋房 z 坐标
  rightOffset: 7,        // 右侧地块沿 z 错开
  streetEnd: 365,
  finish: 380,           // 冲线 z
  roadLeft: -4,          // 路面边界
  roadRight: 9,
  leftHouseX: -13.1,     // 左侧房屋基准 x（房正门朝 +x）
  rightHouseX: 23,       // 右侧房屋基准 x（旋转 180°）
  leftMailboxX: -5.5,
  rightMailboxX: 10.5,
  riderMinX: -3.4,
  riderMaxX: 8.4,
};

export const RULES = {
  cruiseSpeed: 7,
  sprintSpeed: 11.5,
  brakeSpeed: 3,
  steerSpeed: 7.5,
  lives: 3,
  papers: 16,
  subscribers: 10,
  throwCooldown: 0.35,
  hitRadius: 1.3,
  crashInvulnerable: 2.2,
  streakCap: 5,
  deliveryPoints: 100,
};

// 确定性随机数（mulberry32）—— 和原作一样，街区布局由种子决定
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED = 20260914;

/* ---------------- 弧形街道中心线 ----------------
 * 参考原作 "curved neighbourhood"：路线不是直线，
 * 中心线 x 随 z 缓慢摆动（缓弯 S 形），所有物件按中心线 + 垂直偏移摆放。
 */
export function centerX(z) {
  return 7 * Math.sin(z * 0.018) + 2.5 * Math.sin(z * 0.05 + 1.2);
}
// 前进方向与 +Z 轴的夹角（弧度）
export function heading(z) {
  const d = 7 * 0.018 * Math.cos(z * 0.018) + 2.5 * 0.05 * Math.cos(z * 0.05 + 1.2);
  return Math.atan2(d, 1);
}
// 世界坐标 = 中心线 + 沿道路右手法向的偏移
export function roadPoint(z, offset) {
  const th = heading(z);
  return {
    x: centerX(z) + Math.cos(th) * offset,
    z: z - Math.sin(th) * offset,
    th,
  };
}
