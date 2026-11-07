/* ============================================================
 * utils.js — 工具函数与对象池
 * 碰撞检测、随机数、几何计算、实体移动、通用对象池。
 * ============================================================ */
(function (global) {
  'use strict';
  const PF = global.PF;
  const { CFG } = PF;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const distance = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  /** 简单的 32 位 LCG，保证每次重开布局一致。 */
  function createRng(seed) {
    let state = seed >>> 0;
    return function rng() {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function randomRange(rng, min, max) {
    return min + (max - min) * rng();
  }

  function expandRect(rect, amount) {
    return {
      x: rect.x - amount,
      y: rect.y - amount,
      w: rect.w + amount * 2,
      h: rect.h + amount * 2
    };
  }

  function pointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  function aabbOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /**
   * 线段 vs 轴对齐矩形。
   * 返回最近的命中参数 t（0~1），不命中返回 null。
   */
  function rayAABB(ox, oy, dx, dy, rect) {
    let tmin = 0;
    let tmax = 1;

    if (Math.abs(dx) < 1e-9) {
      if (ox < rect.x || ox > rect.x + rect.w) return null;
    } else {
      let t1 = (rect.x - ox) / dx;
      let t2 = (rect.x + rect.w - ox) / dx;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    if (Math.abs(dy) < 1e-9) {
      if (oy < rect.y || oy > rect.y + rect.h) return null;
    } else {
      let t1 = (rect.y - oy) / dy;
      let t2 = (rect.y + rect.h - oy) / dy;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    if (tmin < 0 || tmin > 1) return null;
    return tmin;
  }

  /** 受墙体与树木阻挡的中心点移动，带轴分离滑行。 */
  function moveBody(game, body, dx, dy, halfW, halfH) {
    const wall = CFG.WORLD.WALL;

    // X 轴
    let nx = clamp(body.x + dx, wall + halfW, CFG.WORLD.W - wall - halfW);
    for (const tree of game.trees) {
      if (!tree.blocksMovement()) continue;
      const b = tree.getBody();
      const top = body.y - halfH;
      const bottom = body.y + halfH;
      if (
        nx - halfW < b.x + b.w &&
        nx + halfW > b.x &&
        top < b.y + b.h &&
        bottom > b.y
      ) {
        if (dx > 0) nx = b.x - halfW;
        else if (dx < 0) nx = b.x + b.w + halfW;
      }
    }
    for (const obsidian of game.obsidianWalls || []) {
      const top = body.y - halfH;
      const bottom = body.y + halfH;
      if (
        nx - halfW < obsidian.x + obsidian.w &&
        nx + halfW > obsidian.x &&
        top < obsidian.y + obsidian.h &&
        bottom > obsidian.y
      ) {
        if (dx > 0) nx = obsidian.x - halfW;
        else if (dx < 0) nx = obsidian.x + obsidian.w + halfW;
      }
    }
    body.x = nx;

    // Y 轴
    let ny = clamp(body.y + dy, wall + halfH, CFG.WORLD.H - wall - halfH);
    for (const tree of game.trees) {
      if (!tree.blocksMovement()) continue;
      const b = tree.getBody();
      const left = body.x - halfW;
      const right = body.x + halfW;
      if (
        left < b.x + b.w &&
        right > b.x &&
        ny - halfH < b.y + b.h &&
        ny + halfH > b.y
      ) {
        if (dy > 0) ny = b.y - halfH;
        else if (dy < 0) ny = b.y + b.h + halfH;
      }
    }
    for (const obsidian of game.obsidianWalls || []) {
      const left = body.x - halfW;
      const right = body.x + halfW;
      if (
        left < obsidian.x + obsidian.w &&
        right > obsidian.x &&
        ny - halfH < obsidian.y + obsidian.h &&
        ny + halfH > obsidian.y
      ) {
        if (dy > 0) ny = obsidian.y - halfH;
        else if (dy < 0) ny = obsidian.y + obsidian.h + halfH;
      }
    }
    body.y = ny;
  }

  function isCircleBlocked(game, x, y, radius) {
    const wall = CFG.WORLD.WALL;
    if (x - radius < wall || x + radius > CFG.WORLD.W - wall) return true;
    if (y - radius < wall || y + radius > CFG.WORLD.H - wall) return true;
    for (const tree of game.trees) {
      if (!tree.blocksMovement()) continue;
      if (pointInRect(x, y, expandRect(tree.getBody(), radius))) return true;
    }
    for (const obsidian of game.obsidianWalls || []) {
      if (pointInRect(x, y, expandRect(obsidian, radius))) return true;
    }
    return false;
  }

  /** 通用对象池：减少高频实体的创建与销毁。 */
  class ObjectPool {
    constructor(size, factory) {
      this.items = [];
      this.cursor = 0;
      for (let i = 0; i < size; i += 1) {
        this.items.push(factory());
      }
    }

    reset() {
      for (const item of this.items) item.active = false;
      this.cursor = 0;
    }

    acquire() {
      let item = this.items.find((candidate) => !candidate.active);
      if (!item) {
        // 池满时复用最老的槽位，保证游戏手感不被打断。
        item = this.items[this.cursor];
        this.cursor = (this.cursor + 1) % this.items.length;
      }
      return item;
    }

    get activeCount() {
      let count = 0;
      for (const item of this.items) if (item.active) count += 1;
      return count;
    }
  }


  Object.assign(PF, {
    clamp, lerp, distance, easeOutCubic,
    createRng, randomRange, expandRect, pointInRect,
    aabbOverlap, rayAABB, moveBody, isCircleBlocked,
    ObjectPool
  });
})(window);
