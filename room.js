/* ============================================================
 * room.js — 大地图房间模板、怪物预算与 4 房间流程
 * 出生房 -> 随机战斗房 -> 随机战斗房 -> Boss 房
 * 只负责关卡结构、密度生成、门锁与全局重置，不改战斗/Boss核心。
 * ============================================================ */
(function (global) {
  'use strict';
  const PF = global.PF;
  const { CFG, PALETTE, ENEMY_ARCHETYPES, LEVELS } = PF;
  const {
    Player, Tree, Enemy, Boss, SwampFrogBoss, SandwormBoss, SnowmanChiefBoss,
    LavaDragonBoss, EvilMageBoss, AbyssWhaleBoss, DeityBoss,
    GasPod, Cactus, Campfire
  } = PF;
  const {
    clamp, distance, randomRange, aabbOverlap, pointInRect, expandRect, moveBody
  } = PF;

  // 1280×800 大地图上的门和绝对安全区
  const ROOM_LAYOUT = {
    ENTRY: { x: 640, y: 700 },                   // 固定在下方
    BACK_ENTRY: { x: 640, y: 112 },               // 返回上一间时从上方内侧出现
    TOP_DOOR: { x: 608, y: 16, w: 64, h: 68 },     // 固定在正上方
    BOTTOM_DOOR: { x: 608, y: 716, w: 64, h: 68 },
    SAFE_RADIUS: 150,                            // 毒水/毒囊/树木安全区
    ENEMY_SAFE_RADIUS: 250,                      // 怪物距入口/上下门的最小直线距离
    TREE_MARGIN: 78,
    TREE_GAP: 60,                                // 树间距，缩小后仍不重叠
    TREE_TIGHT_GAP: 46,
    TREE_CORRIDOR_HALF: 80                       // 中央通道半宽：不种树，保证可走
  };

  // 每个战斗房的强制生成预算
  const ROOM_ENEMY_BUDGET = {
    gruntMin: 15,
    gruntMax: 20,
    eliteMin: 2,
    eliteMax: 3,
    zoneAttempts: 120,
    roomAttempts: 800,
    separationPadding: 2         // 小怪中心距约 20px，绝不重叠
  };

  const ROOM_TREE_BUDGET = {
    min: 10,
    max: 15,
    attemptsPerTree: 900
  };

  const doorCenter = (rect) => ({
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2
  });

  const TOP_DOOR_CENTER = doorCenter(ROOM_LAYOUT.TOP_DOOR);
  const BOTTOM_DOOR_CENTER = doorCenter(ROOM_LAYOUT.BOTTOM_DOOR);
  const SAFE_POINTS = [
    ROOM_LAYOUT.ENTRY,
    TOP_DOOR_CENTER,
    BOTTOM_DOOR_CENTER
  ];

  const makeEntry = () => ({ ...ROOM_LAYOUT.ENTRY });
  const makeExitDoor = () => ({ ...ROOM_LAYOUT.TOP_DOOR });

  // ============================================================
  // 战斗房模板库 A / B / C
  // 每套模板定义刷怪区域和树点；怪物数量由预算随机决定。
  // ============================================================
  const ROOM_TEMPLATES = [
    {
      id: 'A',
      name: '林间空地',
      entry: makeEntry(),
      exitDoor: makeExitDoor(),
      spawnZones: [
        { label: '左上', x: 90, y: 180, w: 450, h: 240 },
        { label: '右上', x: 740, y: 180, w: 450, h: 240 },
        { label: '左下', x: 90, y: 430, w: 450, h: 150 },
        { label: '右下', x: 740, y: 430, w: 450, h: 150 }
      ]
    },
    {
      id: 'B',
      name: '斜穿火线',
      entry: makeEntry(),
      exitDoor: makeExitDoor(),
      spawnZones: [
        { label: '左上', x: 120, y: 190, w: 400, h: 230 },
        { label: '右上', x: 760, y: 190, w: 400, h: 230 },
        { label: '左下', x: 120, y: 430, w: 400, h: 150 },
        { label: '右下', x: 760, y: 430, w: 400, h: 150 }
      ]
    },
    {
      id: 'C',
      name: '双生回廊',
      entry: makeEntry(),
      exitDoor: makeExitDoor(),
      spawnZones: [
        { label: '左上', x: 80, y: 170, w: 450, h: 240 },
        { label: '右上', x: 750, y: 170, w: 450, h: 240 },
        { label: '左下', x: 100, y: 420, w: 440, h: 160 },
        { label: '右下', x: 740, y: 420, w: 450, h: 160 }
      ]
    }
  ];

  // ============================================================
  // 通用工具
  // ============================================================

  function randomInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function shuffleInPlace(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  // ============================================================
  // 树木战略分布
  // ============================================================

  function isTreePositionValid(x, y, trees, minGap) {
    const margin = ROOM_LAYOUT.TREE_MARGIN;
    if (x < CFG.WORLD.WALL + margin || x > CFG.WORLD.W - CFG.WORLD.WALL - margin) return false;
    if (y < CFG.WORLD.WALL + margin || y > CFG.WORLD.H - CFG.WORLD.WALL - margin) return false;

    for (const point of SAFE_POINTS) {
      if (distance(x, y, point.x, point.y) < ROOM_LAYOUT.SAFE_RADIUS) return false;
    }

    // 中央纵向通道留空，避免树木堵死从入口到出口的路。
    if (Math.abs(x - CFG.WORLD.W / 2) < ROOM_LAYOUT.TREE_CORRIDOR_HALF) return false;

    for (const tree of trees) {
      if (distance(x, y, tree.x, tree.y) < minGap) return false;
    }
    return true;
  }

  function randomTreePointInZone(zone) {
    const margin = ROOM_LAYOUT.TREE_MARGIN;
    const minX = Math.max(CFG.WORLD.WALL + margin, zone.x);
    const maxX = Math.min(CFG.WORLD.W - CFG.WORLD.WALL - margin, zone.x + zone.w);
    const minY = Math.max(CFG.WORLD.WALL + margin, zone.y);
    const maxY = Math.min(CFG.WORLD.H - CFG.WORLD.WALL - margin, zone.y + zone.h);
    if (maxX <= minX || maxY <= minY) return null;
    return {
      x: randomRange(Math.random, minX, maxX),
      y: randomRange(Math.random, minY, maxY)
    };
  }

  function findTreeInZone(zone, trees, minGap) {
    for (let attempt = 0; attempt < ROOM_TREE_BUDGET.attemptsPerTree; attempt += 1) {
      const point = randomTreePointInZone(zone);
      if (!point) return null;
      if (isTreePositionValid(point.x, point.y, trees, minGap)) return point;
    }
    return null;
  }

  function findTreeAnywhere(trees, minGap) {
    const margin = ROOM_LAYOUT.TREE_MARGIN;
    const minX = CFG.WORLD.WALL + margin;
    const maxX = CFG.WORLD.W - CFG.WORLD.WALL - margin;
    const minY = CFG.WORLD.WALL + margin;
    const maxY = CFG.WORLD.H - CFG.WORLD.WALL - margin;

    for (let attempt = 0; attempt < ROOM_TREE_BUDGET.attemptsPerTree; attempt += 1) {
      const x = randomRange(Math.random, minX, maxX);
      const y = randomRange(Math.random, minY, maxY);
      if (isTreePositionValid(x, y, trees, minGap)) return { x, y };
    }
    return null;
  }

  function findTreeGridFallback(trees, minGap) {
    const margin = ROOM_LAYOUT.TREE_MARGIN;
    for (let y = CFG.WORLD.WALL + margin; y <= CFG.WORLD.H - CFG.WORLD.WALL - margin; y += 14) {
      for (let x = CFG.WORLD.WALL + margin; x <= CFG.WORLD.W - CFG.WORLD.WALL - margin; x += 14) {
        if (isTreePositionValid(x, y, trees, minGap)) return { x, y };
      }
    }
    return null;
  }

  /** 先在每个刷怪区放一棵战术树，再用 while 补足 10~15 棵。 */
  function createTreeCover(game, room, template) {
    const target = randomInt(ROOM_TREE_BUDGET.min, ROOM_TREE_BUDGET.max);
    const zones = template.spawnZones;
    let tacticalIndex = 0;
    let tacticalGuard = 0;
    const tacticalLimit = zones.length * ROOM_TREE_BUDGET.attemptsPerTree;

    while (tacticalIndex < zones.length && tacticalGuard < tacticalLimit) {
      let point = findTreeInZone(zones[tacticalIndex], room.trees, ROOM_LAYOUT.TREE_GAP);
      if (!point) {
        point = findTreeInZone(zones[tacticalIndex], room.trees, ROOM_LAYOUT.TREE_TIGHT_GAP);
      }
      if (point) {
        room.trees.push(new Tree(game, point.x, point.y));
        tacticalIndex += 1;
      }
      tacticalGuard += 1;
    }

    let fillGuard = 0;
    const fillLimit = target * ROOM_TREE_BUDGET.attemptsPerTree * 2;
    while (room.trees.length < target && fillGuard < fillLimit) {
      let point = findTreeAnywhere(room.trees, ROOM_LAYOUT.TREE_GAP);
      if (!point) point = findTreeAnywhere(room.trees, ROOM_LAYOUT.TREE_TIGHT_GAP);
      if (!point) point = findTreeGridFallback(room.trees, ROOM_LAYOUT.TREE_TIGHT_GAP);
      if (point) room.trees.push(new Tree(game, point.x, point.y));
      fillGuard += 1;
    }

    room.treeBudget = target;
  }

  // ============================================================
  // 怪物区域配额与强制生成
  // ============================================================

  function isEnemyPositionValid(x, y, archetype, trees, enemies) {
    const radius = archetype.radius;
    const wallMargin = CFG.WORLD.WALL + radius + 8;
    if (x < wallMargin || x > CFG.WORLD.W - wallMargin) return false;
    if (y < wallMargin || y > CFG.WORLD.H - wallMargin) return false;

    // 怪物距入口/上下门必须大于 250px，避免出生即贴脸。
    for (const point of SAFE_POINTS) {
      if (distance(x, y, point.x, point.y) <= ROOM_LAYOUT.ENEMY_SAFE_RADIUS) return false;
    }

    // 不与树木的碰撞体重叠
    for (const tree of trees) {
      const blocked = expandRect(tree.getBody(), radius + 6);
      if (pointInRect(x, y, blocked)) return false;
    }

    // 怪物之间至少留出各自半径 + 2px，不重叠
    for (const other of enemies) {
      const minGap = radius + other.radius + ROOM_ENEMY_BUDGET.separationPadding;
      if (distance(x, y, other.x, other.y) < minGap) return false;
    }

    return true;
  }

  function randomPointInZone(zone, radius) {
    const wallMargin = CFG.WORLD.WALL + radius + 8;
    const minX = Math.max(wallMargin, zone.x);
    const maxX = Math.min(CFG.WORLD.W - wallMargin, zone.x + zone.w);
    const minY = Math.max(wallMargin, zone.y);
    const maxY = Math.min(CFG.WORLD.H - wallMargin, zone.y + zone.h);
    if (maxX <= minX || maxY <= minY) return null;
    return {
      x: randomRange(Math.random, minX, maxX),
      y: randomRange(Math.random, minY, maxY)
    };
  }

  function findEnemyInZone(zone, archetype, trees, enemies) {
    for (let attempt = 0; attempt < ROOM_ENEMY_BUDGET.zoneAttempts; attempt += 1) {
      const point = randomPointInZone(zone, archetype.radius);
      if (!point) return null;
      if (isEnemyPositionValid(point.x, point.y, archetype, trees, enemies)) {
        return point;
      }
    }
    return null;
  }

  /** 随机点失败后，在指定刷怪区内做密集网格扫描，避免外溢到相邻区域。 */
  function findEnemyInZoneGrid(zone, archetype, trees, enemies) {
    const margin = CFG.WORLD.WALL + archetype.radius + 8;
    const minX = Math.max(margin, zone.x);
    const maxX = Math.min(CFG.WORLD.W - margin, zone.x + zone.w);
    const minY = Math.max(margin, zone.y);
    const maxY = Math.min(CFG.WORLD.H - margin, zone.y + zone.h);
    for (let y = minY; y <= maxY; y += 10) {
      for (let x = minX; x <= maxX; x += 10) {
        if (isEnemyPositionValid(x, y, archetype, trees, enemies)) {
          return { x, y };
        }
      }
    }
    return null;
  }

  function findEnemyAnywhere(archetype, trees, enemies) {
    const margin = CFG.WORLD.WALL + archetype.radius + 8;
    for (let attempt = 0; attempt < ROOM_ENEMY_BUDGET.roomAttempts; attempt += 1) {
      const x = randomRange(Math.random, margin, CFG.WORLD.W - margin);
      const y = randomRange(Math.random, margin, CFG.WORLD.H - margin);
      if (isEnemyPositionValid(x, y, archetype, trees, enemies)) {
        return { x, y };
      }
    }
    return null;
  }

  function findEnemyGridFallback(archetype, trees, enemies) {
    const margin = CFG.WORLD.WALL + archetype.radius + 8;
    for (let y = margin; y <= CFG.WORLD.H - margin; y += 14) {
      for (let x = margin; x <= CFG.WORLD.W - margin; x += 14) {
        if (isEnemyPositionValid(x, y, archetype, trees, enemies)) {
          return { x, y };
        }
      }
    }
    return null;
  }

  /**
   * 4 个刷怪区，每区 3~5 只小怪；2~3 只精英分散在不同区域。
   * 用 while 循环填充槽位，直到硬预算全部生成。
   */
  function placeEnemyFormation(game, room, template, level) {
    const zones = template.spawnZones;
    const smallType = level.enemyTypes[0];
    const eliteType = level.enemyTypes[1] || smallType;
    const gruntTarget = randomInt(ROOM_ENEMY_BUDGET.gruntMin, ROOM_ENEMY_BUDGET.gruntMax);
    const eliteTarget = randomInt(ROOM_ENEMY_BUDGET.eliteMin, ROOM_ENEMY_BUDGET.eliteMax);

    const gruntQuotas = zones.map(() => 3);
    let remainingGrunts = gruntTarget - zones.length * 3;
    let quotaGuard = 0;
    while (remainingGrunts > 0 && quotaGuard < 100) {
      const eligible = [];
      for (let i = 0; i < gruntQuotas.length; i += 1) {
        if (gruntQuotas[i] < 5) eligible.push(i);
      }
      if (eligible.length === 0) break;
      const zoneIndex = eligible[Math.floor(Math.random() * eligible.length)];
      gruntQuotas[zoneIndex] += 1;
      remainingGrunts -= 1;
      quotaGuard += 1;
    }

    const eliteZoneIndices = shuffleInPlace(
      zones.map((_, index) => index)
    ).slice(0, Math.min(eliteTarget, zones.length));
    const eliteZones = new Set(eliteZoneIndices);

    const slots = [];
    for (let i = 0; i < zones.length; i += 1) {
      for (let g = 0; g < gruntQuotas[i]; g += 1) {
        slots.push({ type: smallType, zoneIndex: i });
      }
      if (eliteZones.has(i)) {
        slots.push({ type: eliteType, zoneIndex: i });
      }
    }
    shuffleInPlace(slots);

    const enemies = [];
    let slotIndex = 0;
    let guard = 0;
    const guardLimit = slots.length * ROOM_ENEMY_BUDGET.zoneAttempts * 4 + 2000;

    while (slotIndex < slots.length && guard < guardLimit) {
      const slot = slots[slotIndex];
      const archetype = ENEMY_ARCHETYPES[slot.type];
      let point = findEnemyInZone(
        zones[slot.zoneIndex],
        archetype,
        room.trees,
        enemies
      );
      if (!point) {
        point = findEnemyInZoneGrid(
          zones[slot.zoneIndex],
          archetype,
          room.trees,
          enemies
        );
      }

      if (!point) {
        const order = shuffleInPlace(
          zones.map((_, index) => index)
        );
        for (const zoneIndex of order) {
          if (zoneIndex === slot.zoneIndex) continue;
          point = findEnemyInZone(zones[zoneIndex], archetype, room.trees, enemies);
          if (point) break;
        }
      }

      if (!point) point = findEnemyAnywhere(archetype, room.trees, enemies);
      if (!point) point = findEnemyGridFallback(archetype, room.trees, enemies);

      if (point) {
        enemies.push(new Enemy(game, archetype, point.x, point.y));
        slotIndex += 1;
      }
      guard += 1;
    }

    room.enemies = enemies;
    room.initialEnemyCount = enemies.length;
    room.enemyBudget = {
      grunts: gruntTarget,
      elites: eliteTarget,
      total: gruntTarget + eliteTarget
    };
  }

  // ============================================================
  // 房间数据生成
  // ============================================================

  function makeDoors(index, totalRooms) {
    const doors = [];

    if (index < totalRooms - 1) {
      doors.push({
        side: 'top',
        rect: { ...ROOM_LAYOUT.TOP_DOOR },
        target: index + 1
      });
    }
    if (index > 0) {
      doors.push({
        side: 'bottom',
        rect: { ...ROOM_LAYOUT.BOTTOM_DOOR },
        target: index - 1
      });
    }

    return doors;
  }

  function instantiateCombatRoom(game, template, index, level, totalRooms) {
    const room = {
      index,
      kind: 'combat',
      templateId: template.id,
      templateName: template.name,
      entry: { ...template.entry },
      exitDoor: { ...template.exitDoor },
      doors: makeDoors(index, totalRooms),
      enemies: [],
      trees: [],
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false
    };

    createTreeCover(game, room, template);
    placeEnemyFormation(game, room, template, level);
    return room;
  }

  function makeSpawnRoom(level, totalRooms) {
    return {
      index: 0,
      kind: 'spawn',
      templateId: 'spawn',
      templateName: '出生房',
      entry: { ...ROOM_LAYOUT.ENTRY },
      exitDoor: { ...ROOM_LAYOUT.TOP_DOOR },
      doors: makeDoors(0, totalRooms),
      enemies: [],
      trees: [],
      unlocked: true,
      openProgress: 1,
      initialEnemyCount: 0,
      cleared: true,
      visited: true
    };
  }

  function makeBossRoom(game) {
    const initialTrees = CFG.BOSS.INITIAL_TREES.map(
      (position) => new Tree(game, position.x, position.y)
    );

    return {
      index: 3,
      kind: 'boss',
      templateId: 'boss',
      templateName: 'Boss 房',
      entry: { x: 640, y: 700 },
      exitDoor: null,
      doors: [],
      enemies: [],
      trees: initialTrees,
      boss: null,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false
    };
  }

  function insideSafeZones(x, y, safeZones, safeRadius, padding = 0) {
    for (const point of safeZones) {
      if (distance(x, y, point.x, point.y) < safeRadius + padding) return true;
    }
    return false;
  }

  function createPoisonPuddles(
    level, safeZones, countMinOverride, countMaxOverride
  ) {
    const cfg = level.mechanics.poison;
    const countMin = Number.isFinite(countMinOverride)
      ? countMinOverride
      : cfg.countMin;
    const countMax = Number.isFinite(countMaxOverride)
      ? countMaxOverride
      : cfg.countMax;
    const target = randomInt(countMin, countMax);
    const puddles = [];
    let attempts = 0;

    while (puddles.length < target && attempts < 16000) {
      attempts += 1;
      const radius = randomRange(Math.random, cfg.radiusMin, cfg.radiusMax);
      const margin = CFG.WORLD.WALL + radius + 12;
      const x = randomRange(Math.random, margin, CFG.WORLD.W - margin);
      const y = randomRange(Math.random, margin, CFG.WORLD.H - margin);

      // 中央安全通道保持无泥；两端的出生/传送阵安全区也保持无泥。
      if (Math.abs(x - CFG.WORLD.W / 2) < cfg.corridorHalf + radius + 8) continue;
      if (insideSafeZones(x, y, safeZones, cfg.safeRadius, radius + 6)) continue;

      let overlaps = false;
      for (const puddle of puddles) {
        if (distance(x, y, puddle.x, puddle.y) < puddle.r + radius + 18) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      puddles.push({
        x,
        y,
        r: radius,
        phase: Math.random() * Math.PI * 2
      });
    }

    // 极端情况下用稍小的水洼补足最低数量，但仍保持安全区/通道约束。
    attempts = 0;
    while (puddles.length < countMin && attempts < 20000) {
      attempts += 1;
      const radius = randomRange(Math.random, 52, 68);
      const margin = CFG.WORLD.WALL + radius + 12;
      const x = randomRange(Math.random, margin, CFG.WORLD.W - margin);
      const y = randomRange(Math.random, margin, CFG.WORLD.H - margin);
      if (Math.abs(x - CFG.WORLD.W / 2) < cfg.corridorHalf + radius + 8) continue;
      if (insideSafeZones(x, y, safeZones, cfg.safeRadius, radius + 6)) continue;

      let overlaps = false;
      for (const puddle of puddles) {
        if (distance(x, y, puddle.x, puddle.y) < puddle.r + radius + 14) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      puddles.push({
        x,
        y,
        r: radius,
        phase: Math.random() * Math.PI * 2
      });
    }

    return puddles;
  }

  function createGasPods(game, level, safeZones, puddles) {
    const cfg = level.mechanics.gasPod;
    const zones = level.spawnZones;
    const target = randomInt(cfg.countMin, cfg.countMax);
    const pods = [];
    let attempts = 0;

    while (pods.length < target && attempts < 14000) {
      attempts += 1;
      const zone = pods.length < zones.length ? zones[pods.length] : null;
      let x = randomRange(
        Math.random,
        CFG.WORLD.WALL + cfg.radius + 16,
        CFG.WORLD.W - CFG.WORLD.WALL - cfg.radius - 16
      );
      let y = randomRange(
        Math.random,
        CFG.WORLD.WALL + cfg.radius + 16,
        CFG.WORLD.H - CFG.WORLD.WALL - cfg.radius - 16
      );

      if (zone) {
        x = randomRange(Math.random, zone.x, zone.x + zone.w);
        y = randomRange(Math.random, zone.y, zone.y + zone.h);
      }

      if (insideSafeZones(x, y, safeZones, level.mechanics.poison.safeRadius, cfg.radius + 4)) {
        continue;
      }

      let blocked = false;
      for (const puddle of puddles) {
        if (distance(x, y, puddle.x, puddle.y) < puddle.r + cfg.radius + 12) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      for (const pod of pods) {
        if (distance(x, y, pod.x, pod.y) < 68) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      pods.push(new GasPod(game, x, y, cfg));
    }

    return pods;
  }

  function isSwampEnemyPositionValid(x, y, archetype, room, safeZones) {
    const radius = archetype.radius;
    const cfg = room.levelMechanics;
    const wallMargin = CFG.WORLD.WALL + radius + 8;
    if (x < wallMargin || x > CFG.WORLD.W - wallMargin) return false;
    if (y < wallMargin || y > CFG.WORLD.H - wallMargin) return false;

    if (insideSafeZones(x, y, safeZones, ROOM_LAYOUT.ENEMY_SAFE_RADIUS, radius + 2)) return false;

    for (const puddle of room.poisonPuddles) {
      if (distance(x, y, puddle.x, puddle.y) < puddle.r + radius + 8) return false;
    }

    for (const pod of room.pods) {
      if (distance(x, y, pod.x, pod.y) < pod.radius + radius + 10) return false;
    }

    for (const other of room.enemies) {
      const minGap = radius + other.radius + ROOM_ENEMY_BUDGET.separationPadding;
      if (distance(x, y, other.x, other.y) < minGap) return false;
    }

    return true;
  }

  function placeSwampEnemies(game, room, level) {
    const zones = level.spawnZones;
    const budget = level.enemyBudget;
    const gruntTarget = randomInt(budget.gruntMin, budget.gruntMax);
    const eliteTarget = randomInt(budget.eliteMin, budget.eliteMax);
    const safeZones = [room.entry];
    for (const door of room.doors) safeZones.push(doorCenter(door.rect));

    const quotas = zones.map(() => 3);
    let remaining = gruntTarget - zones.length * 3;
    let guardQuota = 0;
    while (remaining > 0 && guardQuota < 100) {
      const eligible = [];
      for (let i = 0; i < quotas.length; i += 1) {
        if (quotas[i] < 5) eligible.push(i);
      }
      if (eligible.length === 0) break;
      const index = eligible[Math.floor(Math.random() * eligible.length)];
      quotas[index] += 1;
      remaining -= 1;
      guardQuota += 1;
    }

    const eliteZoneIndices = shuffleInPlace(
      zones.map((_, index) => index)
    ).slice(0, Math.min(eliteTarget, zones.length));
    const eliteZones = new Set(eliteZoneIndices);

    const smallTypes = level.enemyTypes.filter(
      (type) => !ENEMY_ARCHETYPES[type].isElite
    );
    const eliteTypes = level.enemyTypes.filter(
      (type) => ENEMY_ARCHETYPES[type].isElite
    );
    const pickSmall = () => smallTypes.length
      ? smallTypes[Math.floor(Math.random() * smallTypes.length)]
      : level.enemyTypes[0];
    const pickElite = () => eliteTypes.length
      ? eliteTypes[Math.floor(Math.random() * eliteTypes.length)]
      : pickSmall();
    const slots = [];
    for (let i = 0; i < zones.length; i += 1) {
      for (let g = 0; g < quotas[i]; g += 1) {
        slots.push({ type: pickSmall(), zoneIndex: i });
      }
      if (eliteZones.has(i)) slots.push({ type: pickElite(), zoneIndex: i });
    }
    shuffleInPlace(slots);

    let slotIndex = 0;
    let guard = 0;
    const guardLimit = slots.length * 200 + 2400;

    while (slotIndex < slots.length && guard < guardLimit) {
      guard += 1;
      const slot = slots[slotIndex];
      const archetype = ENEMY_ARCHETYPES[slot.type];
      let point = null;

      for (let z = 0; z < zones.length && !point; z += 1) {
        const zone = zones[(slot.zoneIndex + z) % zones.length];
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const x = randomRange(Math.random, zone.x, zone.x + zone.w);
          const y = randomRange(Math.random, zone.y, zone.y + zone.h);
          if (isSwampEnemyPositionValid(x, y, archetype, room, safeZones)) {
            point = { x, y };
            break;
          }
        }
      }

      if (!point) {
        for (let attempt = 0; attempt < 800; attempt += 1) {
          const margin = CFG.WORLD.WALL + archetype.radius + 8;
          const x = randomRange(Math.random, margin, CFG.WORLD.W - margin);
          const y = randomRange(Math.random, margin, CFG.WORLD.H - margin);
          if (isSwampEnemyPositionValid(x, y, archetype, room, safeZones)) {
            point = { x, y };
            break;
          }
        }
      }

      if (!point) continue;
      room.enemies.push(new Enemy(game, archetype, point.x, point.y));
      slotIndex += 1;
    }

    room.enemyBudget = {
      grunts: gruntTarget,
      elites: eliteTarget,
      total: gruntTarget + eliteTarget
    };
  }

  function makeLevel2CombatRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    const safeZones = [entry];
    for (const door of doors) safeZones.push(doorCenter(door.rect));

    const poisonPuddles = createPoisonPuddles(level, safeZones);
    const pods = createGasPods(game, level, safeZones, poisonPuddles);

    const room = {
      index,
      kind: 'swamp',
      templateId: `level2-swamp-${index}`,
      templateName: `${level.name} · 沼泽区 ${index}`,
      entry,
      exitDoor: { ...ROOM_LAYOUT.TOP_DOOR },
      doors,
      enemies: [],
      trees: [],
      pods,
      poisonPuddles,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };

    placeSwampEnemies(game, room, level);
    room.initialEnemyCount = room.enemies.length;
    return room;
  }

  function makeLevel2BossRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    const safeZones = [entry];
    for (const door of doors) safeZones.push(doorCenter(door.rect));

    const poisonPuddles = createPoisonPuddles(level, safeZones, 1, 2);
    const pods = createGasPods(game, level, safeZones, poisonPuddles);

    return {
      index,
      kind: 'boss',
      templateId: 'level2-boss',
      templateName: '沼泽 Boss 房',
      entry,
      exitDoor: null,
      doors,
      enemies: [],
      trees: [],
      pods,
      poisonPuddles,
      boss: null,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };
  }

  function createQuicksandZones(level, safeZones) {
    const cfg = level.mechanics.quicksand;
    const target = randomInt(cfg.countMin, cfg.countMax);
    const zones = [];
    let attempts = 0;

    while (zones.length < target && attempts < 16000) {
      attempts += 1;
      const radius = randomRange(Math.random, cfg.radiusMin, cfg.radiusMax);
      const margin = CFG.WORLD.WALL + radius + 12;
      const x = randomRange(Math.random, margin, CFG.WORLD.W - margin);
      const y = randomRange(Math.random, margin, CFG.WORLD.H - margin);

      if (insideSafeZones(x, y, safeZones, cfg.safeRadius, radius + 6)) continue;
      if (Math.abs(x - CFG.WORLD.W / 2) < cfg.corridorHalf + radius) continue;

      let overlaps = false;
      for (const zone of zones) {
        if (distance(x, y, zone.x, zone.y) < radius + zone.radius + 12) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      zones.push({
        x,
        y,
        radius,
        phase: Math.random() * Math.PI * 2
      });
    }

    return zones;
  }

  function createCacti(game, level, safeZones, quicksandZones) {
    const cfg = level.mechanics.cactus;
    const target = randomInt(cfg.countMin, cfg.countMax);
    const cacti = [];
    let attempts = 0;

    while (cacti.length < target && attempts < 16000) {
      attempts += 1;
      const margin = CFG.WORLD.WALL + cfg.radius + 12;
      const x = randomRange(Math.random, margin, CFG.WORLD.W - margin);
      const y = randomRange(Math.random, margin, CFG.WORLD.H - margin);

      if (insideSafeZones(x, y, safeZones, ROOM_LAYOUT.SAFE_RADIUS, cfg.radius + 4)) {
        continue;
      }

      let blocked = false;
      for (const zone of quicksandZones) {
        if (distance(x, y, zone.x, zone.y) < zone.radius + cfg.radius + 18) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      for (const cactus of cacti) {
        if (distance(x, y, cactus.x, cactus.y) < cfg.radius * 2 + 14) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      cacti.push(new Cactus(game, x, y, cfg));
    }

    return cacti;
  }

  function isDesertEnemyPositionValid(x, y, archetype, room, safeZones) {
    const radius = archetype.radius;
    const wallMargin = CFG.WORLD.WALL + radius + 8;
    if (x < wallMargin || x > CFG.WORLD.W - wallMargin) return false;
    if (y < wallMargin || y > CFG.WORLD.H - wallMargin) return false;

    if (insideSafeZones(x, y, safeZones, ROOM_LAYOUT.ENEMY_SAFE_RADIUS, radius + 2)) {
      return false;
    }

    for (const zone of room.quicksandZones) {
      if (distance(x, y, zone.x, zone.y) < zone.radius + radius + 8) return false;
    }

    for (const cactus of room.cacti) {
      if (!cactus.dead && distance(x, y, cactus.x, cactus.y) < cactus.radius + radius + 10) {
        return false;
      }
    }

    for (const campfire of room.campfires || []) {
      if (!campfire.dead &&
        distance(x, y, campfire.x, campfire.y) < campfire.radius + radius + 24) {
        return false;
      }
    }

    for (const lava of room.lavaPools || []) {
      if (distance(x, y, lava.x, lava.y) < lava.radius + radius + 18) {
        return false;
      }
    }
    for (const wall of room.obsidianWalls || []) {
      const closestX = clamp(x, wall.x, wall.x + wall.w);
      const closestY = clamp(y, wall.y, wall.y + wall.h);
      if (distance(x, y, closestX, closestY) < radius + 14) {
        return false;
      }
    }
    for (const trap of room.spikeTraps || []) {
      const closestX = clamp(x, trap.x, trap.x + trap.w);
      const closestY = clamp(y, trap.y, trap.y + trap.h);
      if (distance(x, y, closestX, closestY) < radius + 16) {
        return false;
      }
    }

    for (const other of room.enemies) {
      const minGap = radius + other.radius + ROOM_ENEMY_BUDGET.separationPadding;
      if (distance(x, y, other.x, other.y) < minGap) return false;
    }

    return true;
  }

  function placeDesertEnemies(game, room, level) {
    const zones = level.spawnZones;
    const budget = level.enemyBudget;
    const gruntTarget = randomInt(budget.gruntMin, budget.gruntMax);
    const eliteTarget = randomInt(budget.eliteMin, budget.eliteMax);
    const safeZones = [room.entry];
    for (const door of room.doors) safeZones.push(doorCenter(door.rect));

    const quotas = zones.map(() => 3);
    let remaining = gruntTarget - zones.length * 3;
    let quotaGuard = 0;
    while (remaining > 0 && quotaGuard < 100) {
      const eligible = [];
      for (let i = 0; i < quotas.length; i += 1) {
        if (quotas[i] < 5) eligible.push(i);
      }
      if (eligible.length === 0) break;
      const index = eligible[Math.floor(Math.random() * eligible.length)];
      quotas[index] += 1;
      remaining -= 1;
      quotaGuard += 1;
    }

    const eliteZoneIndices = shuffleInPlace(
      zones.map((_, index) => index)
    ).slice(0, Math.min(eliteTarget, zones.length));
    const eliteZones = new Set(eliteZoneIndices);

    const smallTypes = level.enemyTypes.filter(
      (type) => !ENEMY_ARCHETYPES[type].isElite
    );
    const eliteTypes = level.enemyTypes.filter(
      (type) => ENEMY_ARCHETYPES[type].isElite
    );
    const pickSmall = () => smallTypes.length
      ? smallTypes[Math.floor(Math.random() * smallTypes.length)]
      : level.enemyTypes[0];
    const pickElite = () => eliteTypes.length
      ? eliteTypes[Math.floor(Math.random() * eliteTypes.length)]
      : pickSmall();
    const slots = [];
    for (let i = 0; i < zones.length; i += 1) {
      for (let g = 0; g < quotas[i]; g += 1) {
        slots.push({ type: pickSmall(), zoneIndex: i });
      }
      if (eliteZones.has(i)) slots.push({ type: pickElite(), zoneIndex: i });
    }
    shuffleInPlace(slots);

    let slotIndex = 0;
    let guard = 0;
    const guardLimit = slots.length * 200 + 2400;

    while (slotIndex < slots.length && guard < guardLimit) {
      guard += 1;
      const slot = slots[slotIndex];
      const archetype = ENEMY_ARCHETYPES[slot.type];
      let point = null;

      for (let z = 0; z < zones.length && !point; z += 1) {
        const zone = zones[(slot.zoneIndex + z) % zones.length];
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const x = randomRange(Math.random, zone.x, zone.x + zone.w);
          const y = randomRange(Math.random, zone.y, zone.y + zone.h);
          if (isDesertEnemyPositionValid(x, y, archetype, room, safeZones)) {
            point = { x, y };
            break;
          }
        }
      }

      if (!point) {
        for (let attempt = 0; attempt < 800; attempt += 1) {
          const margin = CFG.WORLD.WALL + archetype.radius + 8;
          const x = randomRange(Math.random, margin, CFG.WORLD.W - margin);
          const y = randomRange(Math.random, margin, CFG.WORLD.H - margin);
          if (isDesertEnemyPositionValid(x, y, archetype, room, safeZones)) {
            point = { x, y };
            break;
          }
        }
      }

      if (!point) continue;
      room.enemies.push(new Enemy(game, archetype, point.x, point.y));
      slotIndex += 1;
    }

    room.enemyBudget = {
      grunts: gruntTarget,
      elites: eliteTarget,
      total: gruntTarget + eliteTarget
    };
  }

  function makeDesertCombatRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    const safeZones = [entry];
    for (const door of doors) safeZones.push(doorCenter(door.rect));

    const quicksandZones = createQuicksandZones(level, safeZones);
    const cacti = createCacti(game, level, safeZones, quicksandZones);

    const room = {
      index,
      kind: 'desert',
      templateId: `level3-desert-${index}`,
      templateName: `${level.name} · 荒漠区 ${index}`,
      entry,
      exitDoor: { ...ROOM_LAYOUT.TOP_DOOR },
      doors,
      enemies: [],
      trees: [],
      pods: [],
      poisonPuddles: [],
      quicksandZones,
      cacti,
      curseSandZones: [],
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };

    placeDesertEnemies(game, room, level);
    room.initialEnemyCount = room.enemies.length;
    return room;
  }

  function makeDesertBossRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    const safeZones = [entry];
    for (const door of doors) safeZones.push(doorCenter(door.rect));

    const quicksandZones = createQuicksandZones(level, safeZones)
      .slice(0, randomInt(2, 3));
    const cacti = createCacti(game, level, safeZones, quicksandZones);

    return {
      index,
      kind: 'boss',
      templateId: 'level3-boss',
      templateName: '深渊沙虫巢穴',
      entry,
      exitDoor: null,
      doors,
      enemies: [],
      trees: [],
      pods: [],
      poisonPuddles: [],
      quicksandZones,
      cacti,
      curseSandZones: [],
      boss: null,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };
  }

  function createCampfires(
    game, level, safeZones, countMinOverride, countMaxOverride
  ) {
    const cfg = level.mechanics.campfire;
    const countMin = Number.isFinite(countMinOverride)
      ? countMinOverride
      : cfg.countMin;
    const countMax = Number.isFinite(countMaxOverride)
      ? countMaxOverride
      : cfg.countMax;
    const target = randomInt(countMin, countMax);
    const zones = shuffleInPlace([...(level.spawnZones || [])]);
    const campfires = [];

    for (let i = 0; i < target; i += 1) {
      const zone = zones[i % Math.max(1, zones.length)];
      let placed = false;

      for (let attempt = 0; attempt < 1200; attempt += 1) {
        const x = zone
          ? randomRange(Math.random, zone.x + 30, zone.x + zone.w - 30)
          : randomRange(
            Math.random,
            CFG.WORLD.WALL + 70,
            CFG.WORLD.W - CFG.WORLD.WALL - 70
          );
        const y = zone
          ? randomRange(Math.random, zone.y + 30, zone.y + zone.h - 30)
          : randomRange(
            Math.random,
            CFG.WORLD.WALL + 70,
            CFG.WORLD.H - CFG.WORLD.WALL - 70
          );

        if (insideSafeZones(x, y, safeZones, cfg.safeRadius, cfg.radius + 8)) {
          continue;
        }

        let overlaps = false;
        for (const fire of campfires) {
          if (distance(x, y, fire.x, fire.y) < 230) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;

        campfires.push(new Campfire(game, x, y, {
          ...cfg,
          warmRadius: level.mechanics.cold.fireRadius
        }));
        placed = true;
        break;
      }

      if (!placed && zone) {
        campfires.push(new Campfire(
          game,
          clamp(zone.x + zone.w / 2, 90, CFG.WORLD.W - 90),
          clamp(zone.y + zone.h / 2, 90, CFG.WORLD.H - 120),
          { ...cfg, warmRadius: level.mechanics.cold.fireRadius }
        ));
      }
    }

    return campfires;
  }

  function makeIceCombatRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    const safeZones = [entry];
    for (const door of doors) safeZones.push(doorCenter(door.rect));

    const room = {
      index,
      kind: 'ice',
      templateId: 'level4-ice',
      templateName: '霜雪战斗房',
      entry,
      exitDoor: null,
      doors,
      enemies: [],
      trees: [],
      pods: [],
      poisonPuddles: [],
      cacti: [],
      quicksandZones: [],
      curseSandZones: [],
      campfires: createCampfires(game, level, safeZones),
      boss: null,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };
    placeDesertEnemies(game, room, level);
    room.initialEnemyCount = room.enemies.length;
    return room;
  }

  function createLavaPools(level, safeZones) {
    const cfg = level.mechanics.lava;
    const target = randomInt(cfg.countMin, cfg.countMax);
    const pools = [];
    let attempts = 0;

    while (pools.length < target && attempts < 12000) {
      attempts += 1;
      const radius = randomRange(Math.random, cfg.radiusMin, cfg.radiusMax);
      const margin = CFG.WORLD.WALL + radius + 16;
      const x = randomRange(Math.random, margin, CFG.WORLD.W - margin);
      const y = randomRange(Math.random, margin, CFG.WORLD.H - margin);
      if (insideSafeZones(x, y, safeZones, cfg.safeRadius, radius + 8)) continue;

      let overlaps = false;
      for (const pool of pools) {
        if (distance(x, y, pool.x, pool.y) < radius + pool.radius + 20) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      pools.push({ x, y, radius, phase: Math.random() * Math.PI * 2 });
    }
    return pools;
  }

  function wallOverlapsLava(wall, pools) {
    for (const pool of pools) {
      const closestX = clamp(pool.x, wall.x, wall.x + wall.w);
      const closestY = clamp(pool.y, wall.y, wall.y + wall.h);
      if (distance(pool.x, pool.y, closestX, closestY) < pool.radius + 18) {
        return true;
      }
    }
    return false;
  }

  function createObsidianWalls(level, safeZones, lavaPools, isBoss = false) {
    const cfg = level.mechanics.obsidianWalls;
    const target = isBoss
      ? cfg.bossCount
      : randomInt(cfg.countMin, cfg.countMax);
    const shapes = [
      { w: 100, h: 100 },
      { w: 50, h: 200 },
      { w: 200, h: 50 }
    ];
    const walls = [];
    let attempts = 0;

    while (walls.length < target && attempts < 12000) {
      attempts += 1;
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      const x = randomRange(
        Math.random,
        CFG.WORLD.WALL + 24,
        CFG.WORLD.W - CFG.WORLD.WALL - shape.w - 24
      );
      const y = randomRange(
        Math.random,
        CFG.WORLD.WALL + 24,
        CFG.WORLD.H - CFG.WORLD.WALL - shape.h - 24
      );
      const cx = x + shape.w / 2;
      const cy = y + shape.h / 2;
      const half = Math.max(shape.w, shape.h) / 2;

      if (insideSafeZones(cx, cy, safeZones, cfg.safeRadius, half + 10)) continue;
      // Boss 房中央留出通道，巨龙可以绕行。
      if (isBoss && x < 830 && x + shape.w > 450) continue;

      const wall = { x, y, w: shape.w, h: shape.h };
      if (wallOverlapsLava(wall, lavaPools)) continue;

      let overlaps = false;
      for (const other of walls) {
        if (
          x < other.x + other.w + cfg.gap &&
          x + shape.w + cfg.gap > other.x &&
          y < other.y + other.h + cfg.gap &&
          y + shape.h + cfg.gap > other.y
        ) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      walls.push(wall);
    }
    return walls;
  }

  function createWhirlpools(level, safeZones, isBoss = false) {
    const cfg = level.mechanics.whirlpools;
    const target = isBoss ? 2 : randomInt(cfg.countMin, cfg.countMax);
    const pools = [];
    let attempts = 0;
    while (pools.length < target && attempts < 10000) {
      attempts += 1;
      const radius = randomRange(Math.random, cfg.radiusMin, cfg.radiusMax);
      const x = randomRange(
        Math.random,
        CFG.WORLD.WALL + radius + 16,
        CFG.WORLD.W - CFG.WORLD.WALL - radius - 16
      );
      const y = randomRange(
        Math.random,
        CFG.WORLD.WALL + radius + 16,
        CFG.WORLD.H - CFG.WORLD.WALL - radius - 16
      );
      if (insideSafeZones(x, y, safeZones, cfg.safeRadius, radius + 12)) {
        continue;
      }
      let overlaps = false;
      for (const pool of pools) {
        if (distance(x, y, pool.x, pool.y) < radius + pool.radius + 32) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      pools.push({
        x, y, radius, strength: cfg.pull,
        phase: Math.random() * Math.PI * 2
      });
    }
    return pools;
  }

  function makeAbyssCombatRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    const safeZones = [entry];
    for (const door of doors) safeZones.push(doorCenter(door.rect));
    const room = {
      index,
      kind: 'abyss',
      templateId: `level7-abyss-${index}`,
      templateName: `深海迷境 · 水域 ${index}`,
      entry,
      exitDoor: null,
      doors,
      enemies: [],
      trees: [],
      pods: [],
      poisonPuddles: [],
      cacti: [],
      quicksandZones: [],
      curseSandZones: [],
      campfires: [],
      lavaPools: [],
      obsidianWalls: [],
      spikeTraps: [],
      whirlpools: createWhirlpools(level, safeZones),
      boss: null,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };
    placeDesertEnemies(game, room, level);
    room.initialEnemyCount = room.enemies.length;
    return room;
  }

  function makeAbyssBossRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    const safeZones = [entry];
    for (const door of doors) safeZones.push(doorCenter(door.rect));
    return {
      index,
      kind: 'boss',
      templateId: 'level7-boss',
      templateName: '深渊巨鲸的巢穴',
      entry,
      exitDoor: null,
      doors,
      enemies: [],
      trees: [],
      pods: [],
      poisonPuddles: [],
      cacti: [],
      quicksandZones: [],
      curseSandZones: [],
      campfires: [],
      lavaPools: [],
      obsidianWalls: [],
      spikeTraps: [],
      whirlpools: createWhirlpools(level, safeZones, true),
      boss: null,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };
  }

  function makeDivineBossRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    return {
      index,
      kind: 'boss',
      templateId: 'level8-divine',
      templateName: '神明之巅',
      entry,
      exitDoor: null,
      doors,
      enemies: [],
      trees: [],
      pods: [],
      poisonPuddles: [],
      cacti: [],
      quicksandZones: [],
      curseSandZones: [],
      campfires: [],
      lavaPools: [],
      obsidianWalls: [],
      spikeTraps: [],
      whirlpools: [],
      boss: null,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };
  }

  function createSpikeTraps(level, safeZones, isBoss = false) {
    const cfg = level.mechanics.spikes;
    const target = isBoss ? 3 : randomInt(cfg.countMin, cfg.countMax);
    const traps = [];
    let attempts = 0;
    while (traps.length < target && attempts < 10000) {
      attempts += 1;
      const size = randomRange(Math.random, cfg.sizeMin, cfg.sizeMax);
      const x = randomRange(
        Math.random,
        CFG.WORLD.WALL + 20,
        CFG.WORLD.W - CFG.WORLD.WALL - size - 20
      );
      const y = randomRange(
        Math.random,
        CFG.WORLD.WALL + 20,
        CFG.WORLD.H - CFG.WORLD.WALL - size - 20
      );
      const cx = x + size / 2;
      const cy = y + size / 2;
      if (insideSafeZones(cx, cy, safeZones, cfg.safeRadius, size / 2 + 10)) {
        continue;
      }
      let overlaps = false;
      for (const trap of traps) {
        if (
          x < trap.x + trap.w + 36 &&
          x + size + 36 > trap.x &&
          y < trap.y + trap.h + 36 &&
          y + size + 36 > trap.y
        ) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      traps.push({ x, y, w: size, h: size, phase: Math.random() * Math.PI * 2 });
    }
    return traps;
  }

  function makeDungeonCombatRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    const safeZones = [entry];
    for (const door of doors) safeZones.push(doorCenter(door.rect));
    const room = {
      index,
      kind: 'dungeon',
      templateId: `level6-dungeon-${index}`,
      templateName: `黑暗地牢 · 地牢区 ${index}`,
      entry,
      exitDoor: null,
      doors,
      enemies: [],
      trees: [],
      pods: [],
      poisonPuddles: [],
      cacti: [],
      quicksandZones: [],
      curseSandZones: [],
      campfires: [],
      lavaPools: [],
      obsidianWalls: [],
      spikeTraps: createSpikeTraps(level, safeZones),
      boss: null,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };
    placeDesertEnemies(game, room, level);
    room.initialEnemyCount = room.enemies.length;
    return room;
  }

  function makeDungeonBossRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    const safeZones = [entry];
    for (const door of doors) safeZones.push(doorCenter(door.rect));
    return {
      index,
      kind: 'boss',
      templateId: 'level6-boss',
      templateName: '邪恶法师祭坛',
      entry,
      exitDoor: null,
      doors,
      enemies: [],
      trees: [],
      pods: [],
      poisonPuddles: [],
      cacti: [],
      quicksandZones: [],
      curseSandZones: [],
      campfires: [],
      lavaPools: [],
      obsidianWalls: [],
      spikeTraps: createSpikeTraps(level, safeZones, true),
      boss: null,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };
  }

  function makeVolcanoCombatRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    const safeZones = [entry];
    for (const door of doors) safeZones.push(doorCenter(door.rect));

    const lavaPools = createLavaPools(level, safeZones);
    const obsidianWalls = createObsidianWalls(level, safeZones, lavaPools);
    const room = {
      index,
      kind: 'volcano',
      templateId: 'level5-volcano',
      templateName: '熔岩战斗房',
      entry,
      exitDoor: null,
      doors,
      enemies: [],
      trees: [],
      pods: [],
      poisonPuddles: [],
      cacti: [],
      quicksandZones: [],
      curseSandZones: [],
      campfires: [],
      lavaPools,
      obsidianWalls,
      boss: null,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };
    placeDesertEnemies(game, room, level);
    room.initialEnemyCount = room.enemies.length;
    return room;
  }

  function makeVolcanoBossRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    const safeZones = [entry];
    for (const door of doors) safeZones.push(doorCenter(door.rect));
    const lavaPools = createLavaPools(level, safeZones).slice(0, 3);
    const obsidianWalls = createObsidianWalls(level, safeZones, lavaPools, true);
    return {
      index,
      kind: 'boss',
      templateId: 'level5-boss',
      templateName: '熔岩巨龙巢穴',
      entry,
      exitDoor: null,
      doors,
      enemies: [],
      trees: [],
      pods: [],
      poisonPuddles: [],
      cacti: [],
      quicksandZones: [],
      curseSandZones: [],
      campfires: [],
      lavaPools,
      obsidianWalls,
      boss: null,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };
  }

  function makeIceBossRoom(game, level, index, totalRooms) {
    const entry = { x: 640, y: 700 };
    const doors = makeDoors(index, totalRooms);
    const safeZones = [entry];
    for (const door of doors) safeZones.push(doorCenter(door.rect));
    return {
      index,
      kind: 'boss',
      templateId: 'level4-boss',
      templateName: '雪人头目王座',
      entry,
      exitDoor: null,
      doors,
      enemies: [],
      trees: [],
      pods: [],
      poisonPuddles: [],
      cacti: [],
      quicksandZones: [],
      curseSandZones: [],
      campfires: createCampfires(
        game, level, safeZones,
        level.mechanics.campfire.bossCount,
        level.mechanics.campfire.bossCount
      ),
      boss: null,
      unlocked: false,
      openProgress: 0,
      initialEnemyCount: 0,
      cleared: false,
      visited: false,
      levelMechanics: level.mechanics,
      treeBudget: 0
    };
  }

  /**
   * 按 currentLevel 生成整层。
   * Level1：出生房 + 两个随机战斗房 + Boss 房。
   * Level2：出生房 + 2~3 个沼泽战斗房 + 沼泽巨蛙 Boss 房。
   * Level3：出生房 + 2~3 个沙漠战斗房 + 深渊沙虫 Boss 房。
   */
  function generateLevel(game) {
    const level = game.currentLevel || LEVELS.Level1;
    if (level.id === 2) {
      const combatCount = randomInt(level.combatRoomMin, level.combatRoomMax);
      const totalRooms = combatCount + 2;
      const rooms = [makeSpawnRoom(level, totalRooms)];
      for (let i = 1; i <= combatCount; i += 1) {
        rooms.push(makeLevel2CombatRoom(game, level, i, totalRooms));
      }
      rooms.push(makeLevel2BossRoom(game, level, totalRooms - 1, totalRooms));
      return rooms;
    }

    if (level.id === 3) {
      const combatCount = randomInt(level.combatRoomMin, level.combatRoomMax);
      const totalRooms = combatCount + 2;
      const rooms = [makeSpawnRoom(level, totalRooms)];
      for (let i = 1; i <= combatCount; i += 1) {
        rooms.push(makeDesertCombatRoom(game, level, i, totalRooms));
      }
      rooms.push(makeDesertBossRoom(game, level, totalRooms - 1, totalRooms));
      return rooms;
    }

    if (level.id === 4) {
      const combatCount = randomInt(level.combatRoomMin, level.combatRoomMax);
      const totalRooms = combatCount + 2;
      const rooms = [makeSpawnRoom(level, totalRooms)];
      for (let i = 1; i <= combatCount; i += 1) {
        rooms.push(makeIceCombatRoom(game, level, i, totalRooms));
      }
      rooms.push(makeIceBossRoom(game, level, totalRooms - 1, totalRooms));
      return rooms;
    }

    if (level.id === 5) {
      const combatCount = randomInt(level.combatRoomMin, level.combatRoomMax);
      const totalRooms = combatCount + 2;
      const rooms = [makeSpawnRoom(level, totalRooms)];
      for (let i = 1; i <= combatCount; i += 1) {
        rooms.push(makeVolcanoCombatRoom(game, level, i, totalRooms));
      }
      rooms.push(makeVolcanoBossRoom(game, level, totalRooms - 1, totalRooms));
      return rooms;
    }

    if (level.id === 6) {
      const combatCount = randomInt(level.combatRoomMin, level.combatRoomMax);
      const totalRooms = combatCount + 2;
      const rooms = [makeSpawnRoom(level, totalRooms)];
      for (let i = 1; i <= combatCount; i += 1) {
        rooms.push(makeDungeonCombatRoom(game, level, i, totalRooms));
      }
      rooms.push(makeDungeonBossRoom(game, level, totalRooms - 1, totalRooms));
      return rooms;
    }

    if (level.id === 7) {
      const combatCount = randomInt(level.combatRoomMin, level.combatRoomMax);
      const totalRooms = combatCount + 2;
      const rooms = [makeSpawnRoom(level, totalRooms)];
      for (let i = 1; i <= combatCount; i += 1) {
        rooms.push(makeAbyssCombatRoom(game, level, i, totalRooms));
      }
      rooms.push(makeAbyssBossRoom(game, level, totalRooms - 1, totalRooms));
      return rooms;
    }

    if (level.id === 8) {
      return [
        makeSpawnRoom(level, 2),
        makeDivineBossRoom(game, level, 1, 2)
      ];
    }

    const templates = level.roomTemplates || ROOM_TEMPLATES;
    const pickTemplate = () => templates[
      Math.floor(Math.random() * templates.length)
    ];

    const template2 = pickTemplate();
    const template3 = pickTemplate();

    return [
      makeSpawnRoom(level, 4),
      instantiateCombatRoom(game, template2, 1, level, 4),
      instantiateCombatRoom(game, template3, 2, level, 4),
      makeBossRoom(game)
    ];
  }

  // ============================================================
  // 房间状态机
  // ============================================================

  class RoomSystems extends PF.BossSystems {
    /** 重置当前层：Boss 房死亡优先回到 Boss 房存档点。 */
    reset() {
      if (
        this.state === 'dead' &&
        this.deathInBossRoom &&
        this.bossCheckpoint &&
        this.bossCheckpoint.levelId === this.currentLevelId &&
        this.respawnAtBossCheckpoint()
      ) {
        return;
      }
      this.startLevel(this.currentLevelId || 1, { preservePlayer: false });
    }

    /**
     * 将 Boss 房恢复到首次进入时的绝对初始状态。
     * 三层各自重建专属交互物，绝不跨层混用。
     */
    resetBossArena(currentLevel) {
      const levelId = typeof currentLevel === 'object' && currentLevel
        ? currentLevel.id
        : currentLevel;
      const level = LEVELS[`Level${levelId}`] || this.currentLevel;
      const bossIndex = this.bossCheckpoint
        ? this.bossCheckpoint.roomIndex
        : this.levelRooms.length - 1;
      const room = this.levelRooms && this.levelRooms[bossIndex];
      if (!room || room.kind !== 'boss') return false;

      // 弹幕、尖刺、爆炸、毒水计时和所有临时粒子上限清空。
      this.orbs.reset();
      this.particles.length = 0;
      this.spikes.length = 0;
      this.gasExplosions.length = 0;
      this.rollGhosts = [];
      this.rollTraps = [];
      this.meteors = [];
      this.meteorFlashTimer = 0;
      this.meteorCooldown = 0;
      this.fireSpiritBombs = [];
      this.lavaBalls = [];
      this.activeChasers.clear();
      this.poisonTickTimer = 0;
      this.lavaTickTimer = 0;
      this.quicksandStay = 0;
      this.quicksandSink = 0;
      this.quicksandCooldown = 0;
      this.quicksandSinkZone = null;
      this.blizzardActive = false;
      this.blizzardTimer = 0;

      // 先彻底废弃上一把的树、毒水、毒囊、仙人掌、流沙和诅咒沙。
      room.enemies.length = 0;
      room.trees = [];
      room.pods = [];
      room.poisonPuddles = [];
      room.cacti = [];
      room.quicksandZones = [];
      room.curseSandZones = [];
      room.campfires = [];
      room.lavaPools = [];
      room.obsidianWalls = [];
      room.spikeTraps = [];
      room.whirlpools = [];

      const safeZones = [room.entry];
      for (const door of room.doors || []) {
        safeZones.push(doorCenter(door.rect));
      }

      if (levelId === 1) {
        room.trees = CFG.BOSS.INITIAL_TREES.map(
          (position) => new Tree(this, position.x, position.y)
        );
      } else if (levelId === 2) {
        room.poisonPuddles = createPoisonPuddles(level, safeZones, 1, 2);
        room.pods = createGasPods(this, level, safeZones, room.poisonPuddles);
      } else if (levelId === 3) {
        room.quicksandZones = createQuicksandZones(level, safeZones)
          .slice(0, randomInt(2, 3));
        room.cacti = createCacti(this, level, safeZones, room.quicksandZones);
      } else if (levelId === 4) {
        room.campfires = createCampfires(
          this, level, safeZones,
          level.mechanics.campfire.bossCount,
          level.mechanics.campfire.bossCount
        );
      } else if (levelId === 5) {
        room.lavaPools = createLavaPools(level, safeZones).slice(0, 3);
        room.obsidianWalls = createObsidianWalls(
          level, safeZones, room.lavaPools, true
        );
      } else if (levelId === 6) {
        room.spikeTraps = createSpikeTraps(level, safeZones, true);
      } else if (levelId === 7) {
        room.whirlpools = createWhirlpools(level, safeZones, true);
      } else if (levelId === 8) {
        // 最终层无小怪、陷阱或环境交互物。
      } else {
        return false;
      }

      this.trees = room.trees;
      this.pods = room.pods;
      this.cacti = room.cacti;
      this.quicksandZones = room.quicksandZones;
      this.curseSandZones = room.curseSandZones;
      this.campfires = room.campfires;
      this.lavaPools = room.lavaPools;
      this.obsidianWalls = room.obsidianWalls;
      this.spikeTraps = room.spikeTraps || [];
      this.whirlpools = room.whirlpools || [];
      this.fireSpiritBombs = [];
      this.lavaBalls = [];
      this.evilOrbs = [];
      this.evilRays = [];
      this.executionerHooks = [];
      this.inkPools = [];
      this.spikeTrapCooldown = 0;
      this.enemies = room.enemies;
      this.bossTrees = room.trees;

      let BossClass = Boss;
      if (levelId === 2) BossClass = SwampFrogBoss;
      else if (levelId === 3) BossClass = SandwormBoss;
      else if (levelId === 4) BossClass = SnowmanChiefBoss;
      else if (levelId === 5) BossClass = LavaDragonBoss;
      else if (levelId === 6) BossClass = EvilMageBoss;
      else if (levelId === 7) BossClass = AbyssWhaleBoss;
      else if (levelId === 8) BossClass = DeityBoss;
      room.boss = new BossClass(this);
      this.boss = room.boss;
      this.bossRoomExitUnlocked = false;
      room.cleared = false;
      room.unlocked = false;
      room.openProgress = 0;
      return true;
    }

    /** Boss 房内死亡：保留已清理的小怪，只重置 Boss 与完整地形。 */
    respawnAtBossCheckpoint() {
      if (!this.levelRooms || !this.bossCheckpoint) return false;
      const bossIndex = this.bossCheckpoint.roomIndex;
      const room = this.levelRooms[bossIndex];
      if (!room || room.kind !== 'boss') return false;
      if (!this.resetBossArena(this.currentLevelId)) return false;

      this.player = new Player(this);
      this.currentRoomIndex = bossIndex;
      this.state = 'playing';
      this.stage.classList.remove('is-dead', 'is-cleared');
      this.hideOverlay();
      this.enterRoom(bossIndex, 'reset');

      this.player.invuln = Math.max(this.player.invuln, 1.0);
      this.player.potionCharges = CFG.POTION.CHARGES;
      this.setGameState('PLAYING', 'Boss 存档点复活');
      this.showToast('存档点复活 · 场地已复原 · Boss 血量重置 · 药水已刷新', 2.8);
      this.deathInBossRoom = false;
      this.deathRoomIndex = null;
      this.updateHud(true);
      return true;
    }

    /**
     * 切换/重开一层。
     * preservePlayer=true 时保留当前 HP 与强化，仅重置层内房间。
     */
    startLevel(levelId, options = {}) {
      const level = LEVELS[`Level${levelId}`] || LEVELS.Level1;
      const preservePlayer = Boolean(options.preservePlayer);
      const skipLoadingState = Boolean(options.skipLoadingState);
      this.pendingLayerId = null;
      if (PF.UI && typeof PF.UI.cancelLoading === 'function') PF.UI.cancelLoading();
      if (!skipLoadingState) {
        this.setGameState('LOADING', `加载 ${level.layerName} · ${level.name}`);
      }

      this.currentLevelId = level.id;
      this.currentLevel = level;
      this.state = 'playing';
      this.scene = 'forest';
      this.bossCheckpoint = null;
      this.deathInBossRoom = false;
      this.deathRoomIndex = null;
      this.time = 0;
      this.clearTimer = 0;
      this.portalCooldown = 0;
      this.portalHintCooldown = 0;
      this.bossDoorUnlocked = false;
      this.bossRoomExitUnlocked = false;
      this.portalOpenProgress = 0;
      this.toastTimer = 0;
      this.particles.length = 0;
      this.rollGhosts = [];
      this.trees = [];
      this.enemies = [];
      this.pods = [];
      this.cacti = [];
      this.quicksandZones = [];
      this.curseSandZones = [];
      this.campfires = [];
      this.lavaPools = [];
      this.obsidianWalls = [];
      this.fireSpiritBombs = [];
      this.lavaBalls = [];
      this.spikeTraps = [];
      this.whirlpools = [];
      this.ripples = [];
      this.inkPools = [];
      this.spikeTrapCooldown = 0;
      this.evilOrbs = [];
      this.evilRays = [];
      this.executionerHooks = [];
      this.spikes = [];
      this.cinematic = null;
      this.divineIntroPlayed = false;
      this.divineOrb = null;
      this.divineWhisper = null;
      if (this.divineDialog) {
        this.divineDialog.hidden = true;
        this.divineDialog.style.display = 'none';
      }
      this.blizzardTimer = 0;
      this.blizzardActive = false;
      this.gasExplosions = [];
      this.poisonTickTimer = 0;
      this.lavaTickTimer = 0;
      this.rollTraps = [];
      this.meteors = [];
      this.meteorFlashTimer = 0;
      this.meteorCooldown = 0;
      this.quicksandStay = 0;
      this.quicksandSink = 0;
      this.quicksandCooldown = 0;
      this.quicksandSinkZone = null;
      this.bossTrees = [];
      this.boss = null;
      this.levelExitPortal = null;
      this.bossDamagePopupTimer = 0;
      this.activeChasers.clear();
      this.orbs.reset();
      this.shakeTime = 0;
      this.shakeDuration = 0;
      this.shakeMagnitude = 0;
      this.initialEnemyCount = 0;
      this.forestTrees = [];
      this.forestEnemies = [];

      if (!preservePlayer || !this.player) {
        this.player = new Player(this);
      }
      this.player.rolling = false;
      this.player.rollTimer = 0;
      this.player.rollCooldown = 0;
      this.player.rollRequested = false;
      this.player.rollKeyWasDown = false;
      this.player.cold = 0;
      this.player.coldDamageTimer = 0;
      this.player.isWarming = false;

      this.levelRooms = generateLevel(this);
      this.currentRoomIndex = 0;
      this.buildAmbient();

      if (this.hud.bossHud) this.hud.bossHud.hidden = true;
      if (this.toast) this.toast.hidden = true;
      if (typeof this.clearBossDamageFeedback === 'function') {
        this.clearBossDamageFeedback();
      }
      if (typeof this.hideUpgradeChoice === 'function') {
        this.hideUpgradeChoice();
      }
      this.hideOverlay();
      this.stage.classList.remove('is-dead', 'is-cleared', 'is-boss');

      this.enterRoom(0, 'reset');
      if (options.message) this.showToast(options.message, 2.2);
      this.updateHud(true);
      this.setGameState('PLAYING', `${level.layerName} 就绪`);
    }

    buildAmbient() {
      this.decor = [];
      for (let i = 0; i < 270; i += 1) {
        const x = randomRange(Math.random, CFG.WORLD.WALL + 6, CFG.WORLD.W - CFG.WORLD.WALL - 6);
        const y = randomRange(Math.random, CFG.WORLD.WALL + 6, CFG.WORLD.H - CFG.WORLD.WALL - 6);
        const roll = Math.random();
        let type = 'grass';
        if (roll > 0.82) type = 'flower';
        else if (roll > 0.72) type = 'stone';
        else if (roll > 0.66) type = 'leaf';
        this.decor.push({
          x: Math.round(x),
          y: Math.round(y),
          type,
          variant: Math.floor(Math.random() * 3)
        });
      }

      this.fireflies = [];
      for (let i = 0; i < CFG.FX.AMBIENT_COUNT; i += 1) {
        this.fireflies.push({
          x: randomRange(Math.random, CFG.WORLD.WALL + 30, CFG.WORLD.W - CFG.WORLD.WALL - 30),
          y: randomRange(Math.random, CFG.WORLD.WALL + 30, CFG.WORLD.H - CFG.WORLD.WALL - 30),
          phase: Math.random() * Math.PI * 2,
          speed: randomRange(Math.random, 0.3, 0.9),
          radius: randomRange(Math.random, 8, 20)
        });
      }
    }

    getCurrentRoom() {
      if (!this.levelRooms || !this.levelRooms[this.currentRoomIndex]) return null;
      return this.levelRooms[this.currentRoomIndex];
    }

    /** 进门 1.5 秒内强制巡逻/休眠，禁止追击与远程开火。 */
    prepareEnemiesForRoomEntry() {
      this.activeChasers.clear();
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        enemy.state = 'patrol';
        enemy.hasChaseSlot = false;
        enemy.chaseTimer = 0;
        enemy.lostTimer = 0;
        enemy.chaseCooldown = Math.max(
          enemy.chaseCooldown,
          CFG.ROOM.ENTRY_PROTECTION_TIME
        );
        enemy.patrolWait = Math.max(
          enemy.patrolWait,
          CFG.ROOM.ENTRY_PROTECTION_TIME
        );
        enemy.patrolTimer = 0;
        enemy.knockX = 0;
        enemy.knockY = 0;
        enemy.burrowed = false;
        enemy.burrowPhase = null;
        enemy.burrowTimer = 0;
        enemy.emergeTarget = null;
        if (enemy.archetype.burrow) {
          enemy.burrowCooldown = Math.max(
            enemy.burrowCooldown,
            enemy.archetype.burrow.cooldown
          );
        }
        if (enemy.archetype.ranged) {
          enemy.rangedCooldown = Math.max(enemy.rangedCooldown, 0.8);
        }
      }
    }

    enterRoom(index, direction = 'forward') {
      const room = this.levelRooms[index];
      if (!room) return;

      this.currentRoomIndex = index;
      room.visited = true;

      this.trees = room.trees;
      this.enemies = room.enemies;
      this.pods = room.pods || [];
      this.cacti = room.cacti || [];
      this.quicksandZones = room.quicksandZones || [];
      this.curseSandZones = room.curseSandZones || [];
      this.campfires = room.campfires || [];
      this.lavaPools = room.lavaPools || [];
      this.obsidianWalls = room.obsidianWalls || [];
      this.spikeTraps = room.spikeTraps || [];
      this.whirlpools = room.whirlpools || [];
      this.ripples = [];
      this.inkPools = [];
      this.fireSpiritBombs = [];
      this.lavaBalls = [];
      this.evilOrbs = [];
      this.evilRays = [];
      this.executionerHooks = [];
      this.spikeTrapCooldown = 0;
      this.spikes = [];
      this.quicksandStay = 0;
      this.quicksandSink = 0;
      this.quicksandCooldown = 0;
      this.quicksandSinkZone = null;
      this.player.rootTimer = 0;
      this.poisonTickTimer = 0;
      this.activeChasers.clear();
      this.enemyAggroLockTimer = CFG.ROOM.ENTRY_PROTECTION_TIME;
      this.prepareEnemiesForRoomEntry();
      this.initialEnemyCount = room.initialEnemyCount;
      this.portalCooldown = CFG.PORTAL.COOLDOWN;
      this.portalHintCooldown = 0;
      this.orbs.reset();
      this.particles.length = 0;
      this.shakeTime = 0;

      if (room.kind === 'boss') {
        this.scene = 'boss';
        if (!room.boss) {
          let BossClass = Boss;
          if (this.currentLevelId === 2) BossClass = SwampFrogBoss;
          else if (this.currentLevelId === 3) BossClass = SandwormBoss;
          else if (this.currentLevelId === 4) BossClass = SnowmanChiefBoss;
          else if (this.currentLevelId === 5) BossClass = LavaDragonBoss;
          else if (this.currentLevelId === 6) BossClass = EvilMageBoss;
          else if (this.currentLevelId === 7) BossClass = AbyssWhaleBoss;
          else if (this.currentLevelId === 8) BossClass = DeityBoss;
          room.boss = new BossClass(this);
        }
        this.boss = room.boss;
        this.bossTrees = room.trees;
        this.bossRoomExitUnlocked = false;
        this.bossCheckpoint = {
          levelId: this.currentLevelId,
          roomIndex: index,
          touched: false
        };
        this.hud.bossHud.hidden = false;
        this.stage.classList.add('is-boss');
        this.player.x = room.entry.x;
        this.player.y = room.entry.y;
        this.showToast(
          this.currentLevelId === 8
            ? '神明之巅 · 最后的对话'
            : this.currentLevelId === 7
              ? '深渊巨鲸苏醒 · 潮汐开始翻涌'
              : this.currentLevelId === 6
              ? '邪恶法师苏醒 · 黑暗笼罩了地牢'
              : this.currentLevelId === 5
              ? '熔岩巨龙苏醒 · 身后的门已封锁'
              : this.currentLevelId === 4
              ? '雪人头目苏醒 · 身后的门已封锁'
              : this.currentLevelId === 3
                ? '深渊沙虫苏醒 · 身后的门已封锁'
                : this.currentLevelId === 2
                  ? '沼泽巨蛙苏醒 · 身后的门已封锁'
                  : '树妖苏醒 · 身后的门已封锁',
          2.2
        );
      } else {
        this.scene = 'forest';
        this.boss = null;
        this.bossTrees = [];
        this.bossRoomExitUnlocked = false;
        this.bossDoorUnlocked = room.unlocked;
        this.portalOpenProgress = room.openProgress;
        this.hud.bossHud.hidden = true;
        this.stage.classList.remove('is-boss');

        const spawn = direction === 'backward'
          ? ROOM_LAYOUT.BACK_ENTRY
          : room.entry;
        this.player.x = spawn.x;
        this.player.y = spawn.y;

        if (room.kind === 'spawn') {
          this.showToast(`${this.currentLevel.layerName} · 出生房 · 前往上方出口`, 2.2);
        } else if (room.kind === 'empty') {
          this.showToast(`${this.currentLevel.layerName} · ${this.currentLevel.name} · 空房间`, 2.0);
        } else if (room.kind === 'swamp') {
          this.showToast(
            `第二层 · 沼泽区 ${index} · 清理所有敌人 · 小心毒水与毒囊`,
            2.6
          );
        } else if (room.kind === 'desert') {
          this.showToast(
            `第三层 · 荒漠区 ${index} · 清理所有敌人 · 小心流沙与仙人掌`,
            2.6
          );
        } else if (room.kind === 'ice') {
          this.showToast(
            '第四层 · 霜雪区 · 靠近火堆取暖 · 火堆可被法球打灭',
            2.8
          );
        } else if (room.kind === 'bossPlaceholder') {
          this.showToast(
            this.currentLevelId === 4
              ? '第四层 · 冰封 Boss 房 · 后续开放'
              : this.currentLevelId === 3
                ? '第三层 · 荒漠 Boss 房 · 尚未开放'
                : '第二层 · 沼泽 Boss 房 · 占位中',
            2.4
          );
        } else if (room.enemies.length > 0) {
          const budget = room.enemyBudget;
          const detail = budget
            ? ` · 小怪 ${budget.grunts} / 精英 ${budget.elites} / 树 ${room.treeBudget}`
            : '';
          this.showToast(`房间 ${index + 1} · 清理所有敌人${detail}`, 2.2);
        } else {
          this.showToast(`房间 ${index + 1} · 已清空`, 1.4);
        }
      }

      this.player.knockX = 0;
      this.player.knockY = 0;
      this.player.invuln = Math.max(this.player.invuln, 0.6);
      this.bossDoorUnlocked = room.unlocked;
      this.portalOpenProgress = room.openProgress;
      this.forestTrees = this.trees;
      this.forestEnemies = this.enemies;
      if (this.player) this.player.potionCharges = CFG.POTION.CHARGES;
      if (index === 0 && room.kind === 'spawn' &&
        this.currentLevelId >= 1 && this.currentLevelId <= 7) {
        this.startDivineWhisper(this.currentLevelId);
      }
      this.updateHud(true);
    }

    updateBossDoorState(dt) {
      if (this.scene !== 'forest') return;

      const room = this.getCurrentRoom();
      if (
        !room || room.kind === 'boss' ||
        room.kind === 'empty' || room.kind === 'bossPlaceholder'
      ) return;

      const hasAliveEnemy = this.enemies.some((enemy) => !enemy.dead);

      if (!hasAliveEnemy && !room.unlocked) {
        room.unlocked = true;
        room.cleared = true;
        room.openProgress = 0;
        this.showToast('房间已清空 · 门已解锁', 2.0);

        for (const door of room.doors) {
          const center = doorCenter(door.rect);
          this.spawnBurst(center.x, center.y, 10, [PALETTE.portalPurple, PALETTE.portalPurpleLight], 75, 0.5);
        }
        this.addShake(1.2, 0.1);
      } else if (hasAliveEnemy && room.unlocked) {
        room.unlocked = false;
        room.cleared = false;
        room.openProgress = 0;
      }

      if (room.unlocked) {
        room.openProgress = Math.min(1, room.openProgress + dt / CFG.PORTAL.OPEN_TIME);
      }

      this.bossDoorUnlocked = room.unlocked;
      this.portalOpenProgress = room.openProgress;
    }

    isPointInPoison(x, y) {
      if (this.currentLevelId !== 2) return false;
      const room = this.getCurrentRoom();
      if (!room || !room.poisonPuddles) return false;
      return room.poisonPuddles.some(
        (puddle) => distance(x, y, puddle.x, puddle.y) <= puddle.r
      );
    }

    getQuicksandZoneAt(x, y) {
      if (this.currentLevelId !== 3) return null;
      const room = this.getCurrentRoom();
      if (!room || !room.quicksandZones) return null;
      for (const zone of room.quicksandZones) {
        if (distance(x, y, zone.x, zone.y) <= zone.radius) return zone;
      }
      return null;
    }

    isPointInQuicksand(x, y) {
      return Boolean(this.getQuicksandZoneAt(x, y));
    }

    spawnCurseSand(x, y, cfg) {
      if (this.currentLevelId !== 3) return;
      const room = this.getCurrentRoom();
      if (!room) return;
      if (!room.curseSandZones) room.curseSandZones = [];

      const zone = {
        x,
        y,
        radius: cfg.radius,
        age: 0,
        duration: cfg.duration,
        slowMultiplier: cfg.slowMultiplier,
        phase: Math.random() * Math.PI * 2
      };
      room.curseSandZones.push(zone);
      this.curseSandZones = room.curseSandZones;
      this.spawnBurst(
        x, y + 6, 12,
        ['#9c8a64', '#6f6a45', '#c9b88a', '#7c9a62'],
        75, 0.5
      );
    }

    getCurseSandZoneAt(x, y) {
      if (this.currentLevelId !== 3 || !this.curseSandZones) return null;
      for (const zone of this.curseSandZones) {
        if (distance(x, y, zone.x, zone.y) <= zone.radius) return zone;
      }
      return null;
    }

    isPointInCurseSand(x, y) {
      return Boolean(this.getCurseSandZoneAt(x, y));
    }

    getCurseSandSpeedMultiplier(x, y) {
      const zone = this.getCurseSandZoneAt(x, y);
      return zone ? zone.slowMultiplier : 1;
    }

    updateCurseSand(dt) {
      if (this.currentLevelId !== 3 || !this.curseSandZones) return;
      for (let i = this.curseSandZones.length - 1; i >= 0; i -= 1) {
        const zone = this.curseSandZones[i];
        zone.age += dt;
        if (zone.age >= zone.duration) this.curseSandZones.splice(i, 1);
      }
    }

    /** 深渊沙虫狂暴破土时砸出的新流沙坑。 */
    spawnBossQuicksand(count) {
      if (this.currentLevelId !== 3) return;
      const room = this.getCurrentRoom();
      if (!room || !room.quicksandZones) return;

      const cfg = this.currentLevel.mechanics.quicksand;
      const wormCfg = CFG.SANDWORM_BOSS;
      const zones = room.quicksandZones;
      const safePoints = [{ x: 640, y: 700 }];

      for (let n = 0; n < count; n += 1) {
        if (zones.length >= wormCfg.QUICKSAND_MAX_PITS) break;

        for (let attempt = 0; attempt < 1200; attempt += 1) {
          const radius = randomRange(
            Math.random,
            wormCfg.QUICKSAND_RADIUS_MIN,
            wormCfg.QUICKSAND_RADIUS_MAX
          );
          const margin = CFG.WORLD.WALL + radius + 12;
          const x = randomRange(Math.random, margin, CFG.WORLD.W - margin);
          const y = randomRange(Math.random, margin, CFG.WORLD.H - margin);

          if (insideSafeZones(x, y, safePoints, cfg.safeRadius, radius + 4)) continue;
          if (distance(x, y, this.player.x, this.player.y) < radius + 40) continue;

          let overlaps = false;
          for (const zone of zones) {
            if (distance(x, y, zone.x, zone.y) < radius + zone.radius + 14) {
              overlaps = true;
              break;
            }
          }
          if (overlaps) continue;

          zones.push({
            x,
            y,
            radius,
            phase: Math.random() * Math.PI * 2
          });
          this.spawnBurst(
            x, y + 8, 18,
            ['#6f4523', '#a9773a', '#d5ac63'],
            110, 0.6
          );
          break;
        }
      }

      this.quicksandZones = zones;
      this.addShake(3.2, 0.22);
    }

    getTerrainSpeedMultiplier(x, y) {
      const mechanics = this.currentLevel && this.currentLevel.mechanics;
      if (!mechanics) return 1;

      if (this.currentLevelId === 2 && mechanics.poison) {
        return this.isPointInPoison(x, y) ? mechanics.poison.speedMultiplier : 1;
      }

      if (this.currentLevelId === 3 && mechanics.quicksand) {
        return this.isPointInQuicksand(x, y)
          ? mechanics.quicksand.speedMultiplier
          : 1;
      }

      return 1;
    }

    triggerQuicksandSink(zone) {
      const cfg = this.currentLevel.mechanics.quicksand;
      this.player.rootTimer = cfg.rootDuration;
      this.player.knockX = 0;
      this.player.knockY = 0;
      this.quicksandSink = cfg.rootDuration;
      this.quicksandSinkZone = zone;
      this.quicksandStay = 0;
      this.player.takeQuicksandDamage(cfg.damage);
      if (this.state !== 'playing') return;

      this.addShake(5.5, 0.35);
      this.spawnBurst(
        this.player.x,
        this.player.y + 10,
        18,
        ['#6f4523', '#a9773a', '#d5ac63'],
        100,
        0.7
      );
      this.showToast('陷入流沙！被禁锢并下陷', 1.6);
    }

    ejectPlayerFromQuicksand(zone) {
      const cfg = this.currentLevel.mechanics.quicksand;
      const player = this.player;
      let baseAngle = Math.atan2(player.y - zone.y, player.x - zone.x);
      if (!Number.isFinite(baseAngle) ||
        (Math.abs(player.x - zone.x) < 0.001 && Math.abs(player.y - zone.y) < 0.001)) {
        baseAngle = Math.random() * Math.PI * 2;
      }

      const marginX = CFG.WORLD.WALL + player.halfW + 8;
      const marginY = CFG.WORLD.WALL + player.halfH + 8;
      let target = null;

      for (let k = 0; k < 8; k += 1) {
        const angle = baseAngle + k * Math.PI / 4;
        const tx = clamp(
          zone.x + Math.cos(angle) * (zone.radius + cfg.ejectExtra),
          marginX,
          CFG.WORLD.W - marginX
        );
        const ty = clamp(
          zone.y + Math.sin(angle) * (zone.radius + cfg.ejectExtra),
          marginY,
          CFG.WORLD.H - marginY
        );
        if (!this.isPointInQuicksand(tx, ty)) {
          target = { x: tx, y: ty, angle };
          break;
        }
      }

      if (target) {
        player.x = target.x;
        player.y = target.y;
        player.knockX = Math.cos(target.angle) * 260;
        player.knockY = Math.sin(target.angle) * 260;
      }

      player.rootTimer = 0;
      player.invuln = Math.max(player.invuln, 0.35);
      this.quicksandSink = 0;
      this.quicksandStay = 0;
      this.quicksandCooldown = 1.0;
      this.spawnBurst(player.x, player.y + 8, 16, ['#6f4523', '#bd8b46', '#e0bd75'], 120, 0.6);
      this.addShake(2.6, 0.2);
      this.showToast('被流沙弹射出来', 1.2);
    }

    updateQuicksand(dt) {
      if (this.currentLevelId !== 3 || this.state !== 'playing') {
        this.quicksandStay = 0;
        return;
      }

      const cfg = this.currentLevel.mechanics.quicksand;
      this.quicksandCooldown = Math.max(0, this.quicksandCooldown - dt);

      if (this.quicksandSink > 0) {
        this.quicksandSink = Math.max(0, this.quicksandSink - dt);
        if (this.quicksandSink === 0 && this.quicksandSinkZone) {
          this.ejectPlayerFromQuicksand(this.quicksandSinkZone);
          this.quicksandSinkZone = null;
        }
        return;
      }

      const zone = this.getQuicksandZoneAt(this.player.x, this.player.y);
      if (!zone || this.quicksandCooldown > 0) {
        this.quicksandStay = 0;
        return;
      }

      const dx = zone.x - this.player.x;
      const dy = zone.y - this.player.y;
      const len = Math.hypot(dx, dy);
      if (len > 3) {
        moveBody(
          this,
          this.player,
          (dx / len) * cfg.pullSpeed * dt,
          (dy / len) * cfg.pullSpeed * dt,
          this.player.halfW,
          this.player.halfH
        );
      }

      this.quicksandStay += dt;
      if (this.quicksandStay >= cfg.sinkTime) {
        this.triggerQuicksandSink(zone);
      }
    }

    /** 泥沼潜伏者死亡后留下 5 秒毒水。 */
    spawnDeathPoison(x, y, cfg) {
      if (this.currentLevelId !== 2) return;
      const room = this.getCurrentRoom();
      if (!room || !room.poisonPuddles) return;

      room.poisonPuddles.push({
        x,
        y,
        r: cfg.radius,
        phase: Math.random() * Math.PI * 2,
        temporary: true,
        age: 0,
        duration: cfg.duration
      });
      this.spawnBurst(x, y, 16, ['#6d4a8f', '#7ecb6c', '#b688ff'], 95, 0.6);
      this.addShake(2.2, 0.18);
    }

    updatePoisonTerrain(dt) {
      if (this.currentLevelId !== 2 || this.state !== 'playing') {
        this.poisonTickTimer = 0;
        return;
      }

      const room = this.getCurrentRoom();
      const mechanics = this.currentLevel && this.currentLevel.mechanics;
      if (!room || !room.poisonPuddles || !mechanics || !mechanics.poison) {
        this.poisonTickTimer = 0;
        return;
      }

      for (let i = room.poisonPuddles.length - 1; i >= 0; i -= 1) {
        const puddle = room.poisonPuddles[i];
        if (!puddle.temporary) continue;
        puddle.age += dt;
        if (puddle.age >= puddle.duration) room.poisonPuddles.splice(i, 1);
      }

      if (!this.isPointInPoison(this.player.x, this.player.y)) {
        this.poisonTickTimer = 0;
        return;
      }

      const poison = mechanics.poison;
      this.poisonTickTimer += dt;
      while (this.poisonTickTimer >= poison.tickInterval) {
        this.poisonTickTimer -= poison.tickInterval;
        this.player.takePoisonDamage(poison.damage);
        if (this.state !== 'playing') {
          this.poisonTickTimer = 0;
          return;
        }
      }
    }

    updateLavaTerrain(dt) {
      if (this.currentLevelId !== 5 || this.state !== 'playing') {
        this.lavaTickTimer = 0;
        return;
      }
      const room = this.getCurrentRoom();
      const lava = this.currentLevel &&
        this.currentLevel.mechanics &&
        this.currentLevel.mechanics.lava;
      if (!room || !room.lavaPools || !lava) {
        this.lavaTickTimer = 0;
        return;
      }

      // 巨像熔岩球留下的临时岩浆池。
      for (let i = room.lavaPools.length - 1; i >= 0; i -= 1) {
        const pool = room.lavaPools[i];
        if (!pool.temporary) continue;
        pool.age = (pool.age || 0) + dt;
        if (pool.age >= pool.duration) room.lavaPools.splice(i, 1);
      }

      let inLava = false;
      for (const pool of room.lavaPools) {
        if (distance(this.player.x, this.player.y, pool.x, pool.y) < pool.radius * 0.72) {
          inLava = true;
          break;
        }
      }
      if (!inLava) {
        this.lavaTickTimer = 0;
        return;
      }

      this.lavaTickTimer += dt;
      while (this.lavaTickTimer >= lava.tickInterval) {
        this.lavaTickTimer -= lava.tickInterval;
        this.player.takeLavaDamage(lava.damage);
        this.player.applyTongueSlow(lava.slowDuration, lava.slowMultiplier);
        if (this.state !== 'playing') {
          this.lavaTickTimer = 0;
          return;
        }
      }
    }

    checkPortalTrigger() {
      if (this.portalCooldown > 0 || this.state !== 'playing') return false;

      const playerRect = {
        x: this.player.x - this.player.halfW,
        y: this.player.y - this.player.halfH,
        w: this.player.halfW * 2,
        h: this.player.halfH * 2
      };

      // 只有“当前层 Boss 结算后生成”的向上传送阵才能跨层。
      if (
        this.levelExitPortal &&
        this.levelExitPortal.sourceLevelId === this.currentLevelId
      ) {
        const portal = this.levelExitPortal;
        const target = PF.LEVELS[`Level${portal.targetLevelId}`];
        if (target && distance(this.player.x, this.player.y, portal.x, portal.y) <
          portal.r + this.player.halfW) {
          this.beginLayerTransition(portal.targetLevelId);
          return true;
        }
      }

      if (this.scene === 'boss') {
        const door = CFG.PORTAL.BOSS;
        if (!aabbOverlap(playerRect, door)) return false;

        if (!this.bossRoomExitUnlocked) {
          if (this.portalHintCooldown <= 0) {
            this.showToast('击败 Boss 后才能离开', 1.8);
            this.portalHintCooldown = CFG.PORTAL.HINT_COOLDOWN;
          }
          return false;
        }
        return false;
      }

      const room = this.getCurrentRoom();
      if (!room) return false;

      for (const door of room.doors) {
        if (!aabbOverlap(playerRect, door.rect)) continue;

        if (!room.unlocked) {
          if (this.portalHintCooldown <= 0) {
            this.showToast('先清理所有敌人', 1.8);
            this.portalHintCooldown = CFG.PORTAL.HINT_COOLDOWN;
          }
          return false;
        }

        this.enterRoom(
          door.target,
          door.side === 'top' ? 'forward' : 'backward'
        );
        return true;
      }

      return false;
    }
  }

  // 把第一层专属的模板和预算挂进 Level1 数据对象。
  if (LEVELS && LEVELS.Level1) {
    LEVELS.Level1.roomTemplates = ROOM_TEMPLATES;
    LEVELS.Level1.enemyBudget = ROOM_ENEMY_BUDGET;
    LEVELS.Level1.treeBudget = ROOM_TREE_BUDGET;
  }

  Object.assign(PF, {
    RoomSystems,
    ROOM_TEMPLATES,
    ROOM_LAYOUT,
    ROOM_ENEMY_BUDGET,
    ROOM_TREE_BUDGET,
    generateLevel
  });
})(window);
