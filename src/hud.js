// HUD：DOM 更新 + 雷达小地图 + 得分弹字
import { ROUTE } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.radar = $('radar').getContext('2d');
    this.points = 0;
  }

  show() { $('hud').classList.remove('hidden'); }
  hide() { $('hud').classList.add('hidden'); }

  setPoints(p) { $('hud-points').textContent = String(p).padStart(5, '0'); }
  setSpeed(ms) { $('hud-speed').textContent = `${Math.round(ms * 3.6)} km/h`; }
  setLives(n) { $('hud-lives').textContent = '♥'.repeat(Math.max(0, n)) || '💔'; }
  setPapers(n) { $('papers-left').textContent = n; }
  setClock(seconds) {
    const t = 6 * 60 + 15 + Math.floor(seconds / 4); // 6:15 出发，游戏时间 4 倍速
    $('hud-topleft').querySelector('.hud-day').textContent =
      `MONDAY · ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  }

  popup(text, bad = false) {
    const box = $('score-popups');
    const stacked = box.childElementCount; // 同时多个事件时纵向错开
    const el = document.createElement('div');
    el.className = 'popup' + (bad ? ' bad' : '');
    el.textContent = text;
    el.style.left = `${42 + Math.random() * 12}%`;
    el.style.top = `${44 - stacked * 7}%`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  /** 雷达：前方 80m 的邮箱 / 障碍，骑手在底部 */
  drawRadar(riderZ, mailboxes, hazards, dogs) {
    const ctx = this.radar, W = 150, H = 180;
    ctx.clearRect(0, 0, W, H);
    const range = 80;
    const zToY = (z) => H - 16 - ((z - riderZ) / range) * (H - 30);
    // 屏幕左 = 世界 +X，雷达同样按镜像绘制，与玩家视角一致
    const xToX = (x) => W - 15 - ((x - ROUTE.roadLeft) / (ROUTE.roadRight - ROUTE.roadLeft)) * (W - 30);

    // 路面
    ctx.fillStyle = 'rgba(244,237,216,.12)';
    ctx.fillRect(15, 6, W - 30, H - 22);
    ctx.strokeStyle = 'rgba(244,237,216,.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(W / 2, 6); ctx.lineTo(W / 2, H - 16); ctx.stroke();
    ctx.setLineDash([]);

    for (const h of hazards) {
      const y = zToY(h.hz ?? h.z);
      if (y < 6 || y > H - 14) continue;
      ctx.fillStyle = h.type === 'pothole' ? '#0d0f18' : '#6b7a80';
      ctx.beginPath(); ctx.arc(xToX(h.offset ?? h.x), y, 4, 0, 7); ctx.fill();
    }
    for (const mb of mailboxes) {
      const y = zToY(mb.pz ?? mb.z);
      if (y < 6 || y > H - 14) continue;
      if (mb.delivered) ctx.fillStyle = '#7fc76b';
      else if (mb.missed) ctx.fillStyle = '#556';
      else if (mb.subscriber) ctx.fillStyle = '#ffd76b';
      else ctx.fillStyle = 'rgba(244,237,216,.4)';
      const x = mb.side === 'left' ? W - 8 : 8;
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const d of dogs) {
      if (!d.active) continue;
      const y = zToY(d.group.position.z);
      if (y < 6 || y > H - 14) continue;
      ctx.fillStyle = '#ff5f6b';
      ctx.beginPath(); ctx.arc(xToX(d.group.position.x), y, 4, 0, 7); ctx.fill();
    }
    // 骑手箭头
    ctx.fillStyle = '#f4edd8';
    ctx.beginPath();
    ctx.moveTo(W / 2, H - 10); ctx.lineTo(W / 2 - 6, H - 2); ctx.lineTo(W / 2 + 6, H - 2);
    ctx.fill();
  }
}

export function showIntro(onStart) {
  $('loading').classList.add('hidden');
  $('intro').classList.remove('hidden');
  $('start-btn').onclick = () => {
    $('intro').classList.add('hidden');
    onStart();
  };
}

export function showResults({ score, delivered, total, won }, onRetry) {
  const grade = delivered >= total ? 'S' : delivered >= total * 0.8 ? 'A' : delivered >= total * 0.5 ? 'B' : 'C';
  $('res-headline').textContent = won
    ? (grade === 'S' ? 'PERFECT MORNING!' : 'ROUTE COMPLETE!')
    : 'WEEK ENDS EARLY.';
  $('res-byline').textContent = won
    ? 'Every paper where it belongs. Cedar Hollow approves.'
    : 'The street fought back. Tomorrow is another morning.';
  $('res-score').textContent = score;
  $('res-delivered').textContent = `${delivered}/${total}`;
  $('res-grade').textContent = grade;
  $('results').classList.remove('hidden');
  $('retry-btn').onclick = () => location.reload();
}
