/* ============================================================
 * boss.js — Boss 树妖、预警树与 Boss 战斗系统
 * 包含 Boss 激怒移速、倒树硬直、生成树、死亡与相关绘制。
 * ============================================================ */
(function (global) {
  'use strict';
  const PF = global.PF;
  const { CFG, PALETTE } = PF;
  const {
    clamp, randomRange, distance, aabbOverlap, moveBody, pointInRect,
    rayAABB, expandRect, isCircleBlocked
  } = PF;
  const { Tree } = PF;

  // 熔岩巨龙正面贴图：48×48原图，固定放大到200×200，绝不翻转。
  const dragonSprite = {
    image: new Image(),
    flash: null,
    ready: false,
    failed: false
  };
  dragonSprite.image.decoding = 'async';
  dragonSprite.image.addEventListener('load', () => {
    dragonSprite.ready = true;
    const size = CFG.LAVA_DRAGON.RENDER_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(dragonSprite.image, 0, 0, size, size);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
    dragonSprite.flash = canvas;
  });
  dragonSprite.image.addEventListener('error', () => {
    dragonSprite.failed = true;
  });
  dragonSprite.image.src = 'assets/boss_dragon.png';
  PF.DragonSprite = dragonSprite;

  // 前四层 Boss 贴图：统一200×200渲染，透明图直接使用；
  // 若图片是纯白背景，则从边缘做连通白底抠除，保留Boss内部白色高光。
  const BOSS_RENDER_SIZE = 200;
  const BOSS_IMAGE_SOURCES = {
    treeSpirit: 'assets/boss_tree.png',
    swampFrog: 'assets/boss_toad.png',
    sandworm: 'assets/boss_worm.png',
    snowmanChief: 'assets/boss_snowman.png',
    evilMage: 'assets/boss_mage.png',
    abyssWhale: 'assets/boss_whale.png',
    deity: 'assets/boss_god.png'
  };
  const bossArt = {};

  function removeWhiteBackground(image) {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) return image;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0);
    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, width, height);
    } catch {
      // file:// 环境若禁止读取像素，就退回到原始透明图。
      return image;
    }

    const data = imageData.data;
    const visited = new Uint8Array(width * height);
    const stack = [];
    const isWhite = (index) =>
      data[index + 3] > 0 &&
      data[index] >= 242 &&
      data[index + 1] >= 242 &&
      data[index + 2] >= 242;

    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const cell = y * width + x;
      if (visited[cell]) return;
      const index = cell * 4;
      if (!isWhite(index)) return;
      visited[cell] = 1;
      stack.push(cell);
    };

    for (let x = 0; x < width; x += 1) {
      push(x, 0);
      push(x, height - 1);
    }
    for (let y = 0; y < height; y += 1) {
      push(0, y);
      push(width - 1, y);
    }

    let changed = false;
    while (stack.length > 0) {
      const cell = stack.pop();
      const x = cell % width;
      const y = Math.floor(cell / width);
      data[cell * 4 + 3] = 0;
      changed = true;
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }

    if (!changed) return canvas;
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function makeBossFlash(source) {
    const canvas = document.createElement('canvas');
    canvas.width = BOSS_RENDER_SIZE;
    canvas.height = BOSS_RENDER_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, BOSS_RENDER_SIZE, BOSS_RENDER_SIZE);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, BOSS_RENDER_SIZE, BOSS_RENDER_SIZE);
    ctx.globalCompositeOperation = 'source-over';
    return canvas;
  }

  Object.entries(BOSS_IMAGE_SOURCES).forEach(([type, src]) => {
    const art = {
      image: new Image(),
      source: null,
      flash: null,
      ready: false,
      failed: false
    };
    art.image.decoding = 'async';
    art.image.addEventListener('load', () => {
      art.source = removeWhiteBackground(art.image);
      art.flash = makeBossFlash(art.source);
      art.ready = true;
    });
    art.image.addEventListener('error', () => {
      art.failed = true;
    });
    art.image.src = src;
    bossArt[type] = art;
  });
  PF.BossArt = bossArt;
  PF.BOSS_RENDER_SIZE = BOSS_RENDER_SIZE;
  PF.removeWhiteBackground = removeWhiteBackground;

  class BossTree extends Tree {
    constructor(game, x, y) {
      super(game, x, y);
      this.state = 'warning';
      this.warnDuration = CFG.BOSS.TREE_WARN_TIME;
      this.warnTimer = this.warnDuration;
    }

    update(dt) {
      if (this.state === 'warning') {
        this.warnTimer -= dt;
        if (this.warnTimer <= 0) {
          this.state = 'alive';
          this.game.onBossTreeComplete(this);
        }
        return;
      }
      super.update(dt);
    }
  }

  class Boss {
    constructor(game) {
      this.game = game;
      this.type = 'treeSpirit';
      this.label = '树妖';
      this.visualFacing = 1;
      this.x = CFG.BOSS.SPAWN_X;
      this.y = CFG.BOSS.SPAWN_Y;
      this.maxHp = CFG.BOSS.MAX_HP;
      this.hp = CFG.BOSS.MAX_HP;
      this.contactDamage = CFG.BOSS.CONTACT_DAMAGE;
      this.state = 'active';      // active | dying | dead
      this.phase = 1;
      this.phase3OrbTimer = CFG.BOSS.PHASE3_ORB_INTERVAL;
      this.contactHalf = CFG.BOSS.CONTACT_HALF;
      this.contactCooldown = 0;
      this.contactRecoilTimer = 0;
      this.stunTimer = 0;
      this.hitFlash = 0;
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      // 开局第一棵预警树 2 秒后出现，之后恢复 6~8 秒间隔。
      this.spawnTimer = CFG.BOSS.FIRST_TREE_TIME;
      this.walkTime = 0;
      this.moving = false;
      this.stepTimer = 0;
      this.avoidTimer = 0;
      this.avoidSide = Math.random() < 0.5 ? -1 : 1;

      // 被同一棵树反复/持续阻挡时累积时间，超时后直接撞碎该树。
      this.blockedTree = null;
      this.treeBlockTimer = 0;
      this.smashTimer = 0;

      if (typeof this.game.clearBossDamageFeedback === 'function') {
        this.game.clearBossDamageFeedback();
      }
    }

    getContactBody() {
      return {
        x: this.x - this.contactHalf,
        y: this.y - this.contactHalf,
        w: this.contactHalf * 2,
        h: this.contactHalf * 2
      };
    }

    getOrbBody() {
      const half = CFG.BOSS.ORB_HALF;
      return { x: this.x - half, y: this.y - half, w: half * 2, h: half * 2 };
    }

    getTreeHitBody() {
      const half = CFG.BOSS.TREE_HIT_HALF;
      return { x: this.x - half, y: this.y - half, w: half * 2, h: half * 2 };
    }

    /** 100~70 一阶段，70~30 二阶段，30~0 三阶段。 */
    getPhase() {
      if (this.hp <= CFG.BOSS.PHASE_THREE_HP) return 3;
      if (this.hp <= CFG.BOSS.PHASE_TWO_HP) return 2;
      return 1;
    }

    getPhaseName() {
      const phase = this.getPhase();
      if (phase === 3) return '狂暴';
      if (phase === 2) return '二阶段';
      return '一阶段';
    }

    /** 一阶段缓慢爬升，二阶段持续加速，三阶段固定在 80% 上限。 */
    getSpeedRatio() {
      const phase = this.getPhase();
      const maxRatio = CFG.BOSS.MAX_SPEED_RATIO;
      if (phase === 3) return maxRatio;

      if (phase === 2) {
        const span = CFG.BOSS.PHASE_TWO_HP - CFG.BOSS.PHASE_THREE_HP;
        const t = clamp((CFG.BOSS.PHASE_TWO_HP - this.hp) / span, 0, 1);
        const ratio = CFG.BOSS.PHASE_ONE_END_SPEED_RATIO +
          (CFG.BOSS.PHASE_TWO_END_SPEED_RATIO - CFG.BOSS.PHASE_ONE_END_SPEED_RATIO) * t;
        return Math.min(maxRatio, ratio);
      }

      const span = CFG.BOSS.MAX_HP - CFG.BOSS.PHASE_TWO_HP;
      const t = clamp((CFG.BOSS.MAX_HP - this.hp) / span, 0, 1);
      const ratio = CFG.BOSS.BASE_SPEED_RATIO +
        (CFG.BOSS.PHASE_ONE_END_SPEED_RATIO - CFG.BOSS.BASE_SPEED_RATIO) * t;
      return Math.min(maxRatio, ratio);
    }

    getMoveSpeed() {
      return CFG.PLAYER.SPEED * this.getSpeedRatio();
    }

    getSpeedPercent() {
      return Math.round(this.getSpeedRatio() * 100);
    }

    getTreeInterval() {
      if (this.getPhase() === 3) return CFG.BOSS.TREE_INTERVAL_PHASE3;
      if (this.getPhase() === 2) return CFG.BOSS.TREE_INTERVAL_PHASE2;
      return CFG.BOSS.TREE_INTERVAL_PHASE1;
    }

    updatePhase() {
      const nextPhase = this.getPhase();
      if (nextPhase === this.phase) return;

      this.phase = nextPhase;
      this.spawnTimer = Math.min(this.spawnTimer, this.getTreeInterval());
      if (nextPhase === 3) {
        this.phase3OrbTimer = Math.min(
          this.phase3OrbTimer,
          CFG.BOSS.PHASE3_ORB_INITIAL_DELAY
        );
        this.game.showToast('Boss 狂暴化 · 法球来袭', 1.8);
      } else {
        this.game.showToast('Boss 进入二阶段 · 树雨加快', 1.6);
      }

      this.game.addShake(4.2, 0.32);
      this.game.spawnBurst(this.x, this.y - 20, 18, PALETTE.leafColors, 150, 0.65);
    }

    updatePhase3Orbs(dt) {
      if (this.getPhase() !== 3) return;

      this.phase3OrbTimer -= dt;
      if (this.phase3OrbTimer > 0) return;

      this.firePhase3Orb();
      this.phase3OrbTimer = CFG.BOSS.PHASE3_ORB_INTERVAL;
    }

    firePhase3Orb() {
      const player = this.game.player;
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) return;

      const dirX = dx / len;
      const dirY = dy / len;
      const muzzle = this.contactHalf + CFG.BOSS.PHASE3_ORB_MUZZLE;
      const spawnX = this.x + dirX * muzzle;
      const spawnY = this.y + dirY * muzzle;

      this.game.orbs.spawn(
        spawnX,
        spawnY,
        dirX,
        dirY,
        'enemy',
        CFG.BOSS.PHASE3_ORB_DAMAGE,
        CFG.BOSS.PHASE3_ORB_SPEED,
        CFG.BOSS.PHASE3_ORB_TREE_DAMAGE,
        CFG.BOSS.PHASE3_ORB_RADIUS
      );
      this.game.spawnBurst(spawnX, spawnY, 8, PALETTE.enemyOrbSpark, 75, 0.4);
      this.game.addShake(1.2, 0.08);
    }

    update(dt) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.contactCooldown = Math.max(0, this.contactCooldown - dt);
      this.contactRecoilTimer = Math.max(0, this.contactRecoilTimer - dt);

      if (this.state === 'dead') return;

      if (this.state === 'dying') {
        this.deathTimer += dt;
        this.deathPuffTimer -= dt;
        if (this.deathPuffTimer <= 0) {
          this.deathPuffTimer = 0.2;
          this.game.spawnBurst(
            this.x + (Math.random() - 0.5) * 70,
            this.y - 20 + (Math.random() - 0.5) * 40,
            4,
            PALETTE.leafColors,
            90,
            0.55
          );
        }
        if (this.deathTimer >= CFG.BOSS.DEATH_TIME) {
          this.state = 'dead';
          this.game.onBossDefeated();
        }
        return;
      }

      this.updatePhase();

      this.stunTimer = Math.max(0, this.stunTimer - dt);
      if (this.stunTimer > 0) {
        this.moving = false;
        return;
      }

      // 撞碎树后的极短停顿。
      if (this.smashTimer > 0) {
        this.smashTimer = Math.max(0, this.smashTimer - dt);
        this.moving = false;
        return;
      }

      // 碰到玩家并造成伤害后的停顿后摇，避免贴身连续判定。
      if (this.contactRecoilTimer > 0) {
        this.moving = false;
        return;
      }

      // 生成树计时：被硬直或预警树数量达到上限时暂停。
      if (this.game.countWarningTrees() < CFG.BOSS.MAX_WARNING_TREES) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.game.trySpawnBossTree(this);
          this.spawnTimer = this.getTreeInterval();
        }
      }

      this.updatePhase3Orbs(dt);

      const player = this.game.player;
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) {
        this.moving = false;
        return;
      }

      const dirX = dx / len;
      const dirY = dy / len;
      const speed = this.getMoveSpeed();
      const expected = speed * dt;
      const beforeX = this.x;
      const beforeY = this.y;

      // 正常状态时直接冲向玩家。
      if (this.avoidTimer <= 0) {
        moveBody(
          this.game,
          this,
          dirX * speed * dt,
          dirY * speed * dt,
          this.contactHalf,
          this.contactHalf
        );

        const directMoved = Math.hypot(this.x - beforeX, this.y - beforeY);
        if (directMoved < expected * 0.3 && expected > 0.01) {
          // 前方有树/墙：进入一段“只侧移、不直冲”的绕行状态，
          // 避免直冲分量把 Boss 顶回障碍物边缘。
          const blocker = this.findBlockingTree(dirX, dirY);
          if (blocker && blocker !== this.blockedTree) {
            this.blockedTree = blocker;
            this.treeBlockTimer = 0;
          } else if (!blocker) {
            this.blockedTree = null;
            this.treeBlockTimer = 0;
          }
          this.avoidTimer = CFG.BOSS.AVOID_TIME;
        }
      }

      // 绕行期间暂时放弃直线追击，持续向侧面移动；碰到另一侧障碍则反向。
      if (this.avoidTimer > 0) {
        const sideX = -dirY * this.avoidSide;
        const sideY = dirX * this.avoidSide;
        const sideStartX = this.x;
        const sideStartY = this.y;

        moveBody(
          this.game,
          this,
          sideX * speed * CFG.BOSS.AVOID_SPEED_RATIO * dt,
          sideY * speed * CFG.BOSS.AVOID_SPEED_RATIO * dt,
          this.contactHalf,
          this.contactHalf
        );

        const sideMoved = Math.hypot(this.x - sideStartX, this.y - sideStartY);
        if (sideMoved < expected * 0.1) {
          this.avoidSide = -this.avoidSide;
          moveBody(
            this.game,
            this,
            -sideX * speed * CFG.BOSS.AVOID_SPEED_RATIO * dt,
            -sideY * speed * CFG.BOSS.AVOID_SPEED_RATIO * dt,
            this.contactHalf,
            this.contactHalf
          );
        }

        this.avoidTimer = Math.max(0, this.avoidTimer - dt);
      }

      this.moving = Math.hypot(this.x - beforeX, this.y - beforeY) > 0.02;
      this.updateBlockedTreeInteraction(dt);

      if (this.moving) {
        this.walkTime += dt;
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          this.stepTimer = CFG.BOSS.STEP_INTERVAL;
          this.game.addShake(1.4, 0.1);
          this.game.spawnBurst(
            this.x + (Math.random() < 0.5 ? -18 : 18),
            this.y + this.contactHalf + 2,
            3,
            PALETTE.dustColors,
            55,
            0.35
          );
        }
      }
    }

    /** 沿冲向玩家的方向，找到最近的前方阻挡树。 */
    findBlockingTree(dirX, dirY) {
      let best = null;
      let bestT = Infinity;
      const lookahead = CFG.BOSS.TREE_BREAK_LOOKAHEAD;

      for (const tree of this.game.trees) {
        if (!tree.blocksMovement()) continue;
        const expanded = expandRect(tree.getBody(), this.contactHalf);
        const t = rayAABB(
          this.x, this.y,
          dirX * lookahead, dirY * lookahead,
          expanded
        );
        if (t !== null && t < bestT) {
          best = tree;
          bestT = t;
        }
      }
      return best;
    }

    /** 同一棵树持续阻挡 Boss 超过 1.5 秒后，直接将其撞碎。 */
    updateBlockedTreeInteraction(dt) {
      if (!this.blockedTree) return;

      const tree = this.blockedTree;
      const stillThere = this.game.trees.indexOf(tree) !== -1;
      const stillBlocks = stillThere && tree.blocksMovement();
      const nearEnough = distance(this.x, this.y, tree.x, tree.y) <= CFG.BOSS.TREE_BREAK_RANGE;

      if (!stillBlocks || !nearEnough) {
        this.blockedTree = null;
        this.treeBlockTimer = 0;
        return;
      }

      this.treeBlockTimer += dt;
      if (this.treeBlockTimer >= CFG.BOSS.TREE_BREAK_TIME) {
        this.breakBlockingTree(tree);
      }
    }

    /** Boss 撞碎树木：直接移除，不留树桩。 */
    breakBlockingTree(tree) {
      const index = this.game.trees.indexOf(tree);
      if (index !== -1) this.game.trees.splice(index, 1);

      this.game.spawnBurst(tree.x, tree.y - 20, 24, PALETTE.leafColors, 165, 0.75);
      this.game.spawnBurst(tree.x, tree.y, 12, PALETTE.dustColors, 105, 0.5);
      this.game.addShake(5.8, 0.3);

      this.blockedTree = null;
      this.treeBlockTimer = 0;
      this.avoidTimer = 0;
      this.moving = false;
      this.smashTimer = CFG.BOSS.TREE_BREAK_PAUSE;
    }

    /** 玩家法球伤害 1；倒树伤害 20 并触发 0.3 秒硬直。 */
    takeDamage(amount, sourceX, sourceY, sourceKind = 'orb') {
      if (this.state !== 'active') return;

      this.hp = Math.max(0, this.hp - amount);
      this.hitFlash = CFG.BOSS.HIT_FLASH_TIME;
      if (amount > 0) this.game.onBossDamaged(amount, sourceKind);

      if (sourceKind === 'tree') {
        this.stunTimer = CFG.BOSS.STUN_TIME;
        this.game.addShake(7.5, 0.38);
        this.game.spawnBurst(this.x, this.y - 12, 22, PALETTE.leafColors, 150, 0.7);
        this.game.spawnBurst(this.x, this.y + 18, 12, PALETTE.dustColors, 120, 0.55);
      } else {
        this.game.addShake(1.8, 0.08);
        this.game.spawnBurst(sourceX, sourceY, 6, PALETTE.leafColors, 90, 0.32);
      }

      if (this.hp <= 0) this.startDeath();
    }

    startDeath() {
      if (this.state !== 'active') return;
      this.state = 'dying';
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.moving = false;
      this.game.addShake(8, 0.7);
      this.game.spawnBurst(this.x, this.y - 10, 34, PALETTE.leafColors, 180, 0.9);
      this.game.spawnBurst(this.x, this.y + 20, 18, PALETTE.dustColors, 130, 0.7);
    }
  }

  /**
   * 沼泽巨蛙：复用 Boss 的血量、受击、接触伤害与单向门，
   * 但使用独立的长舌/压顶状态机与动画。
   */
  class SwampFrogBoss extends Boss {
    constructor(game) {
      super(game);
      const cfg = CFG.FROG_BOSS;
      this.type = 'swampFrog';
      this.label = '沼泽巨蛙';
      this.maxHp = cfg.MAX_HP;
      this.hp = cfg.MAX_HP;
      this.x = cfg.SPAWN_X;
      this.y = cfg.SPAWN_Y;
      this.contactHalf = cfg.CONTACT_HALF;
      this.contactDamage = cfg.CONTACT_DAMAGE;
      this.contactCooldown = 0;
      this.contactRecoilTimer = 0;
      this.hitFlash = 0;
      this.action = 'idle';
      this.actionTimer = 0;
      this.actionDuration = 0;
      this.attackCooldown = cfg.INITIAL_ATTACK_DELAY;
      this.decisionPending = false;
      this.enraged = false;
      this.aimX = 0;
      this.aimY = 1;
      this.tongueHitApplied = false;
      this.chainTongue = false;
      this.slamTarget = null;
      this.jumpStartX = this.x;
      this.jumpStartY = this.y;
      this.jumpProgress = 0;
      this.jumpOffset = 0;
      this.landShockTimer = 0;
      this.crossShockwaves = [];
      this.moving = false;
      this.faceX = 1;
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.walkTime = 0;
      this.spawnTimer = 0;
    }

    isEnraged() {
      return this.hp < CFG.FROG_BOSS.ENRAGE_HP;
    }

    getActionLabel() {
      if (this.state === 'dying') return '倒下';
      switch (this.action) {
        case 'tongueWindup': return this.chainTongue ? '狂暴连舌' : '长舌预警';
        case 'tongueOut': return this.chainTongue ? '狂暴连舌' : '长舌突刺';
        case 'tongueRecover': return '收舌硬直';
        case 'slamWindup': return '压顶预警';
        case 'slamJump': return '泰山压顶';
        case 'slamRecover': return '落地硬直';
        default: return this.enraged ? '狂暴爬行' : '缓慢爬行';
      }
    }

    getHudSkillText() {
      if (this.action === 'idle') {
        return this.decisionPending
          ? '即将出手'
          : `决策 ${Math.max(0, this.attackCooldown).toFixed(1)}s`;
      }
      return this.getActionLabel();
    }

    getPhaseName() {
      return this.enraged ? '狂暴' : '常态';
    }

    getSpeedPercent() {
      return Math.round((CFG.FROG_BOSS.CRAWL_SPEED / CFG.PLAYER.SPEED) * 100);
    }

    takeDamage(amount, sourceX, sourceY, sourceKind = 'orb') {
      if (this.state !== 'active') return;

      this.hp = Math.max(0, this.hp - amount);
      this.hitFlash = CFG.FROG_BOSS.HIT_FLASH_TIME;
      if (amount > 0) this.game.onBossDamaged(amount, sourceKind);

      if (sourceKind === 'pod') {
        this.game.addShake(4.2, 0.22);
        this.game.spawnBurst(this.x, this.y - 8, 12, ['#6f7e39', '#9b6fbd', '#b6c46a'], 105, 0.5);
      } else {
        this.game.addShake(1.2, 0.06);
        this.game.spawnBurst(sourceX, sourceY, 6, ['#6f7e39', '#b6c46a', '#9b6fbd'], 80, 0.3);
      }

      if (this.hp <= 0) this.startDeath();
    }

    startDeath() {
      if (this.state !== 'active') return;
      this.state = 'dying';
      this.action = 'dying';
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.moving = false;
      this.jumpOffset = 0;
      this.game.addShake(9, 0.8);
      this.game.spawnBurst(this.x, this.y - 6, 34, ['#6f7e39', '#b6c46a', '#9b6fbd'], 175, 0.9);
      this.game.spawnBurst(this.x, this.y + 20, 20, ['#59406f', '#8fb968'], 125, 0.75);
    }

    update(dt) {
      if (this.state === 'dead') return;

      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.contactCooldown = Math.max(0, this.contactCooldown - dt);
      this.contactRecoilTimer = Math.max(0, this.contactRecoilTimer - dt);
      this.landShockTimer = Math.max(0, this.landShockTimer - dt);
      this.walkTime += dt;

      if (this.state === 'dying') {
        this.deathTimer += dt;
        this.deathPuffTimer -= dt;
        if (this.deathPuffTimer <= 0) {
          this.deathPuffTimer = 0.18;
          this.game.spawnBurst(
            this.x + randomRange(Math.random, -30, 30),
            this.y + randomRange(Math.random, -15, 20),
            5,
            ['#6f7e39', '#9b6fbd', '#b6c46a'],
            60,
            0.5
          );
        }
        if (this.deathTimer >= CFG.FROG_BOSS.DEATH_TIME) {
          this.state = 'dead';
          this.game.onBossDefeated();
        }
        return;
      }

      if (this.game.state !== 'playing') return;

      this.updateDecisionTimer(dt);
      this.updateCrossShockwaves(dt);
      if (this.game.state !== 'playing') return;

      if (this.contactRecoilTimer > 0) {
        this.moving = false;
        return;
      }

      this.updateEnrage();

      switch (this.action) {
        case 'tongueWindup': this.updateTongueWindup(dt); break;
        case 'tongueOut': this.updateTongueOut(dt); break;
        case 'tongueRecover': this.updateTongueRecover(dt); break;
        case 'slamWindup': this.updateSlamWindup(dt); break;
        case 'slamJump': this.updateSlamJump(dt); break;
        case 'slamRecover': this.updateSlamRecover(dt); break;
        default: this.updateIdle(dt); break;
      }
    }

    updateEnrage() {
      if (this.enraged) return;
      if (this.hp < CFG.FROG_BOSS.ENRAGE_HP) {
        this.enraged = true;
        this.game.addShake(5.5, 0.45);
        this.game.spawnBurst(this.x, this.y - 18, 26, ['#d34c57', '#ff8a6b', '#9b6fbd'], 150, 0.7);
      }
    }

    updateDecisionTimer(dt) {
      if (this.decisionPending) return;
      this.attackCooldown = Math.max(0, this.attackCooldown - dt);
      if (this.attackCooldown <= 0) this.decisionPending = true;
    }

    getCrossWaveRects(wave) {
      const len = CFG.FROG_BOSS.CROSSWAVE_LENGTH;
      const width = CFG.FROG_BOSS.CROSSWAVE_WIDTH;
      const half = width / 2;
      const x = wave.x;
      const y = wave.y;
      return [
        { x: x - half, y: y - len, w: width, h: len },
        { x: x - half, y, w: width, h: len },
        { x: x - len, y: y - half, w: len, h: width },
        { x, y: y - half, w: len, h: width }
      ];
    }

    updateCrossShockwaves(dt) {
      const cfg = CFG.FROG_BOSS;
      const player = this.game.player;
      const playerRect = {
        x: player.x - player.halfW,
        y: player.y - player.halfH,
        w: player.halfW * 2,
        h: player.halfH * 2
      };

      for (let i = this.crossShockwaves.length - 1; i >= 0; i -= 1) {
        const wave = this.crossShockwaves[i];
        wave.age += dt;

        if (!wave.hitPlayer) {
          for (const rect of this.getCrossWaveRects(wave)) {
            if (aabbOverlap(playerRect, rect)) {
              wave.hitPlayer = true;
              player.takeDamage(cfg.CROSSWAVE_DAMAGE, wave.x, wave.y);
              if (this.game.state !== 'playing') return;
              break;
            }
          }
        }

        if (wave.age >= cfg.CROSSWAVE_DURATION) {
          this.crossShockwaves.splice(i, 1);
        }
      }
    }

    updateIdle(dt) {
      if (this.decisionPending) {
        this.chooseAttack();
        return;
      }
      this.moveSlowly(dt);
    }

    moveSlowly(dt) {
      const player = this.game.player;
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const len = Math.hypot(dx, dy);
      if (len < 90) {
        this.moving = false;
        return;
      }

      const speed = CFG.FROG_BOSS.CRAWL_SPEED *
        (this.enraged ? CFG.FROG_BOSS.ENRAGE_SPEED_MULT : 1);
      this.faceX = dx >= 0 ? 1 : -1;
      moveBody(
        this.game,
        this,
        (dx / len) * speed * dt,
        (dy / len) * speed * dt,
        this.contactHalf,
        this.contactHalf
      );
      this.moving = true;
    }

    chooseAttack() {
      if (this.state !== 'active') return;
      this.decisionPending = false;
      this.attackCooldown = CFG.FROG_BOSS.AI_DECISION_INTERVAL;

      const player = this.game.player;
      const dist = distance(this.x, this.y, player.x, player.y);

      // 远距离绝不吐舌，直接压顶追击。
      if (dist > 250) {
        this.startSlam();
        return;
      }

      // 贴脸优先长舌，避免跳跃砸空。
      if (dist < 100) {
        if (this.startTongue()) return;
        this.startSlam();
        return;
      }

      // 100~250px 随机选择。
      if (Math.random() < 0.5) {
        if (this.startTongue()) return;
        this.startSlam();
      } else {
        this.startSlam();
      }
    }

    startTongue(warningOverride = null) {
      const player = this.game.player;
      const dist = distance(this.x, this.y, player.x, player.y);
      if (dist > 250) {
        if (warningOverride === null) this.startSlam();
        return false;
      }

      let dx = player.x - this.x;
      let dy = player.y - this.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) {
        dx = this.faceX;
        dy = 0;
      } else {
        dx /= len;
        dy /= len;
      }

      this.action = 'tongueWindup';
      this.actionTimer = 0;
      this.actionDuration = warningOverride ?? (
        CFG.FROG_BOSS.TONGUE_WARN *
        (this.enraged ? CFG.FROG_BOSS.ENRAGE_WARNING_MULT : 1)
      );
      this.chainTongue = warningOverride !== null;
      this.aimX = dx;
      this.aimY = dy;
      this.tongueHitApplied = false;
      this.moving = false;
      this.faceX = dx >= 0 ? 1 : -1;
      this.game.addShake(1.4, 0.08);
      return true;
    }

    updateTongueWindup(dt) {
      this.actionTimer += dt;
      if (this.actionTimer < this.actionDuration) return;
      this.action = 'tongueOut';
      this.actionTimer = 0;
      this.actionDuration = CFG.FROG_BOSS.TONGUE_ACTIVE;
      this.applyTongueDamage();
    }

    updateTongueOut(dt) {
      this.applyTongueDamage();
      this.actionTimer += dt;
      if (this.actionTimer < this.actionDuration) return;

      if (this.chainTongue) {
        this.chainTongue = false;
        this.action = 'slamRecover';
        this.actionTimer = 0;
        this.actionDuration = CFG.FROG_BOSS.SLAM_RECOVER;
      } else {
        this.action = 'tongueRecover';
        this.actionTimer = 0;
        this.actionDuration = CFG.FROG_BOSS.TONGUE_RECOVER;
      }
    }

    updateTongueRecover(dt) {
      this.actionTimer += dt;
      if (this.actionTimer >= this.actionDuration) this.finishAction();
    }

    applyTongueDamage() {
      const player = this.game.player;
      if (player.invuln > 0) return;

      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const along = dx * this.aimX + dy * this.aimY;
      const perp = Math.abs(-dx * this.aimY + dy * this.aimX);
      if (
        along < 0 || along > CFG.FROG_BOSS.TONGUE_LENGTH ||
        perp > CFG.FROG_BOSS.TONGUE_WIDTH / 2 + player.halfW
      ) return;

      const hpBefore = player.hp;
      player.takeDamage(CFG.FROG_BOSS.TONGUE_DAMAGE, this.x, this.y);
      if (player.hp < hpBefore && this.game.state === 'playing') {
        player.knockX = this.aimX * CFG.FROG_BOSS.TONGUE_KNOCKBACK;
        player.knockY = this.aimY * CFG.FROG_BOSS.TONGUE_KNOCKBACK;
        player.applyTongueSlow(
          CFG.FROG_BOSS.TONGUE_SLOW_DURATION,
          CFG.FROG_BOSS.TONGUE_SLOW_MULT
        );
      }

      this.game.addShake(5.8, 0.3);
      this.game.spawnBurst(
        this.x + this.aimX * 80,
        this.y + this.aimY * 80,
        12,
        ['#d34c57', '#ff7b68', '#9d7bff', '#72d68a'],
        150,
        0.4
      );
    }

    startSlam() {
      const player = this.game.player;
      const margin = CFG.WORLD.WALL + 58;
      this.slamTarget = {
        x: clamp(player.x, margin, CFG.WORLD.W - margin),
        y: clamp(player.y, margin, CFG.WORLD.H - margin)
      };
      this.action = 'slamWindup';
      this.actionTimer = 0;
      this.actionDuration = CFG.FROG_BOSS.SLAM_WARN *
        (this.enraged ? CFG.FROG_BOSS.ENRAGE_WARNING_MULT : 1);
      this.moving = false;
      this.faceX = player.x >= this.x ? 1 : -1;
      this.game.addShake(2.2, 0.12);
    }

    updateSlamWindup(dt) {
      this.actionTimer += dt;
      if (this.actionTimer < this.actionDuration) return;
      this.action = 'slamJump';
      this.actionTimer = 0;
      this.actionDuration = CFG.FROG_BOSS.SLAM_JUMP_TIME;
      this.jumpStartX = this.x;
      this.jumpStartY = this.y;
      this.jumpProgress = 0;
      this.jumpOffset = 0;
    }

    updateSlamJump(dt) {
      this.actionTimer += dt;
      const progress = clamp(
        this.actionTimer / Math.max(0.001, this.actionDuration),
        0, 1
      );
      this.jumpProgress = progress;
      this.x = this.jumpStartX + (this.slamTarget.x - this.jumpStartX) * progress;
      this.y = this.jumpStartY + (this.slamTarget.y - this.jumpStartY) * progress;
      this.jumpOffset = -Math.sin(progress * Math.PI) * 150;

      if (progress < 1) return;
      this.x = this.slamTarget.x;
      this.y = this.slamTarget.y;
      this.jumpOffset = 0;
      this.landSlam();
    }

    landSlam() {
      this.action = 'slamRecover';
      this.actionTimer = 0;
      this.actionDuration = CFG.FROG_BOSS.SLAM_RECOVER;
      this.landShockTimer = 0.42;
      this.moving = false;
      this.game.addShake(9.5, 0.5);
      this.game.spawnBurst(this.x, this.y + 18, 28, ['#6f7e39', '#b6c46a', '#59406f'], 185, 0.7);

      this.crossShockwaves.push({
        x: this.x,
        y: this.y,
        age: 0,
        hitPlayer: false
      });

      const player = this.game.player;
      if (distance(player.x, player.y, this.x, this.y) <= CFG.FROG_BOSS.SLAM_RADIUS) {
        player.takeDamage(CFG.FROG_BOSS.SLAM_DAMAGE, this.x, this.y);
      }

      const onPoison = this.game.isPointInPoison(this.x, this.y);
      if (onPoison) {
        this.game.spawnDeathPoison(this.x, this.y, { radius: 104, duration: 3.2 });
        this.game.spawnBurst(this.x, this.y + 6, 18, ['#7ecb6c', '#8b5bb8', '#b7ff9b'], 135, 0.65);
      }

      this.spawnSlamOrbs();

      const pods = this.game.pods.slice();
      for (const pod of pods) {
        if (pod.dead) continue;
        if (distance(pod.x, pod.y, this.x, this.y) <= CFG.FROG_BOSS.SLAM_POD_RADIUS) {
          pod.takeDamage(999);
          if (this.state !== 'active') break;
        }
      }

      // 半血狂暴：落地后只给 0.3 秒反应，立刻接宽幅长舌。
      // 距离 >250px 时仍然绝不吐舌，遵守远距离禁舌规则。
      this.updateEnrage();
      const chainDistance = distance(
        player.x, player.y, this.x, this.y
      );
      if (
        this.state === 'active' && this.enraged &&
        this.game.state === 'playing' && chainDistance <= 250
      ) {
        if (this.startTongue(CFG.FROG_BOSS.CHAIN_TONGUE_WARN)) return;
      }

      this.action = 'slamRecover';
      this.actionTimer = 0;
      this.actionDuration = CFG.FROG_BOSS.SLAM_RECOVER;
    }

    spawnSlamOrbs() {
      const cfg = CFG.FROG_BOSS;
      const count = cfg.SLAM_ORB_COUNT;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        this.game.orbs.spawn(
          this.x + dx * cfg.SLAM_ORB_OFFSET,
          this.y + dy * cfg.SLAM_ORB_OFFSET,
          dx,
          dy,
          'enemy',
          cfg.SLAM_ORB_DAMAGE,
          cfg.SLAM_ORB_SPEED,
          cfg.SLAM_ORB_TREE_DAMAGE,
          cfg.SLAM_ORB_RADIUS
        );
        this.game.spawnBurst(
          this.x + dx * cfg.SLAM_ORB_OFFSET,
          this.y + dy * cfg.SLAM_ORB_OFFSET,
          3,
          ['#9b64ff', '#59d06d', '#d8b8ff'],
          55,
          0.3
        );
      }
      this.game.addShake(2.2, 0.12);
    }

    updateSlamRecover(dt) {
      this.actionTimer += dt;
      if (this.actionTimer >= this.actionDuration) this.finishAction();
    }

    finishAction() {
      if (this.state !== 'active') return;
      this.action = 'idle';
      this.actionTimer = 0;
      this.actionDuration = 0;
      this.chainTongue = false;

      // 技能结束后追加 1 秒全局喘息；狂暴仅将后续冷却缩短 10%。
      const extra = CFG.FROG_BOSS.POST_SKILL_COOLDOWN;
      const base = Math.max(0, this.attackCooldown) + extra;
      this.decisionPending = false;
      this.attackCooldown = base *
        (this.enraged ? CFG.FROG_BOSS.ENRAGE_COOLDOWN_MULT : 1);
    }
  }

  class SandwormBoss extends Boss {
    constructor(game) {
      super(game);
      const cfg = CFG.SANDWORM_BOSS;
      this.type = 'sandworm';
      this.label = '深渊沙虫';
      this.maxHp = cfg.MAX_HP;
      this.hp = cfg.MAX_HP;
      this.x = cfg.SPAWN_X;
      this.y = cfg.SPAWN_Y;
      this.contactHalf = cfg.CONTACT_HALF;
      this.contactDamage = cfg.CONTACT_DAMAGE;
      this.contactCooldown = 0;
      this.contactRecoilTimer = 0;
      this.hitFlash = 0;
      this.phase = 'tracking';
      this.phaseTimer = 0;
      this.burrowed = true;
      this.warnTarget = null;
      this.enraged = false;
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.trailTimer = 0;
      this.moving = false;
      this.spawnTimer = 0;
      this.walkTime = 0;
    }

    getActionLabel() {
      if (this.state === 'dying') return '倒下';
      if (this.phase === 'tracking') return '地底潜行';
      if (this.phase === 'warning') return '破土预警';
      if (this.phase === 'exposed') return '地面暴露 · 硬直';
      if (this.phase === 'sandstorm') return '沙石风暴';
      return '地底潜行';
    }

    getPhaseName() {
      return this.enraged ? '狂暴' : '常态';
    }

    getSpeedPercent() {
      return Math.round(
        (CFG.SANDWORM_BOSS.TRACK_SPEED / CFG.PLAYER.SPEED) * 100
      );
    }

    takeDamage(amount, sourceX, sourceY, sourceKind = 'orb') {
      if (this.state !== 'active' || this.burrowed) return;

      this.hp = Math.max(0, this.hp - amount);
      this.hitFlash = CFG.SANDWORM_BOSS.HIT_FLASH_TIME;
      if (amount > 0) this.game.onBossDamaged(amount, sourceKind);
      this.game.addShake(1.5, 0.08);
      this.game.spawnBurst(
        sourceX, sourceY, 6,
        ['#8c6536', '#d0a45d', '#6b442e'], 85, 0.3
      );
      if (this.hp <= 0) this.startDeath();
    }

    startDeath() {
      if (this.state !== 'active') return;
      this.state = 'dying';
      this.phase = 'dying';
      this.burrowed = false;
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.moving = false;
      this.game.addShake(10, 0.8);
      this.game.spawnBurst(
        this.x, this.y - 20, 38,
        ['#8c6536', '#d0a45d', '#6b442e', '#7a4d28'],
        190, 0.95
      );
    }

    update(dt) {
      if (this.state === 'dead') return;

      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.contactCooldown = Math.max(0, this.contactCooldown - dt);
      this.contactRecoilTimer = Math.max(0, this.contactRecoilTimer - dt);
      this.walkTime += dt;

      if (this.state === 'dying') {
        this.deathTimer += dt;
        this.deathPuffTimer -= dt;
        if (this.deathPuffTimer <= 0) {
          this.deathPuffTimer = 0.16;
          this.game.spawnBurst(
            this.x + randomRange(Math.random, -35, 35),
            this.y + randomRange(Math.random, -20, 28),
            6,
            ['#8c6536', '#d0a45d', '#6b442e'],
            75, 0.55
          );
        }
        if (this.deathTimer >= CFG.SANDWORM_BOSS.DEATH_TIME) {
          this.state = 'dead';
          this.game.onBossDefeated();
        }
        return;
      }

      if (this.game.state !== 'playing') return;
      this.updateEnrage();

      if (this.phase === 'tracking') {
        this.burrowed = true;
        this.phaseTimer += dt;
        this.trailTimer -= dt;
        const player = this.game.player;
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          const speed = CFG.SANDWORM_BOSS.TRACK_SPEED *
            (this.enraged ? CFG.SANDWORM_BOSS.ENRAGE_TRACK_MULT : 1);
          moveBody(
            this.game, this,
            (dx / len) * speed * dt,
            (dy / len) * speed * dt,
            this.contactHalf,
            this.contactHalf
          );
        }
        this.moving = true;
        if (this.trailTimer <= 0) {
          this.trailTimer = 0.11;
          this.game.spawnBurst(
            this.x, this.y + 10, 4,
            ['#7a4d28', '#b2813e', '#d8b268'],
            55, 0.4
          );
        }
        if (this.phaseTimer >= CFG.SANDWORM_BOSS.TRACK_TIME) {
          this.startWarning();
        }
        return;
      }

      if (this.phase === 'warning') {
        this.burrowed = true;
        this.moving = false;
        this.phaseTimer += dt;
        if (this.phaseTimer >= CFG.SANDWORM_BOSS.WARN_TIME) this.erupt();
        return;
      }

      if (this.phase === 'exposed') {
        this.burrowed = false;
        this.moving = false;
        this.phaseTimer += dt;
        if (this.phaseTimer >= CFG.SANDWORM_BOSS.EXPOSED_TIME) {
          const d = distance(
            this.game.player.x, this.game.player.y, this.x, this.y
          );
          if (d > 250) this.startSandstorm();
          else this.startBurrow();
        }
        return;
      }

      if (this.phase === 'sandstorm') {
        this.burrowed = false;
        this.moving = false;
        this.phaseTimer += dt;
        if (this.phaseTimer >= CFG.SANDWORM_BOSS.SANDSTORM_TIME) {
          this.startBurrow();
        }
      }
    }

    updateEnrage() {
      if (this.enraged) return;
      if (this.hp < CFG.SANDWORM_BOSS.ENRAGE_HP) {
        this.enraged = true;
        this.game.addShake(6.5, 0.5);
        this.game.spawnBurst(
          this.x, this.y - 15, 28,
          ['#d34c57', '#ff8a6b', '#8c6536', '#6b442e'],
          155, 0.75
        );
      }
    }

    startWarning() {
      const player = this.game.player;
      const margin = CFG.WORLD.WALL + CFG.SANDWORM_BOSS.WARN_RADIUS * 0.72;
      this.phase = 'warning';
      this.phaseTimer = 0;
      this.burrowed = true;
      this.moving = false;
      this.warnTarget = {
        x: clamp(player.x, margin, CFG.WORLD.W - margin),
        y: clamp(player.y, margin, CFG.WORLD.H - margin)
      };
      this.game.spawnBurst(
        this.warnTarget.x, this.warnTarget.y + 8, 16,
        ['#7a4d28', '#b2813e', '#d8b268'],
        95, 0.55
      );
      this.game.addShake(1.5, 0.1);
    }

    erupt() {
      const cfg = CFG.SANDWORM_BOSS;
      this.phase = 'exposed';
      this.phaseTimer = 0;
      this.burrowed = false;
      this.moving = false;
      this.x = this.warnTarget.x;
      this.y = this.warnTarget.y;
      this.contactCooldown = 0;

      this.game.addShake(9.5, 0.55);
      this.game.spawnBurst(
        this.x, this.y + 14, 34,
        ['#7a4d28', '#b2813e', '#d8b268', '#6b442e'],
        190, 0.8
      );

      const player = this.game.player;
      if (distance(player.x, player.y, this.x, this.y) <= cfg.WARN_RADIUS) {
        player.takeDamage(cfg.ERUPT_DAMAGE, this.x, this.y);
        if (this.game.state === 'playing') {
          const dx = player.x - this.x;
          const dy = player.y - this.y;
          const len = Math.hypot(dx, dy);
          if (len > 0.001) {
            player.knockX = (dx / len) * cfg.ERUPT_KNOCKBACK;
            player.knockY = (dy / len) * cfg.ERUPT_KNOCKBACK;
          }
        }
      }

      for (const cactus of this.game.cacti) {
        if (cactus.dead) continue;
        if (distance(cactus.x, cactus.y, this.x, this.y) <= cfg.CACTUS_HIT_RADIUS) {
          cactus.takeDamage(99);
        }
      }

      if (this.enraged) {
        this.game.spawnBossQuicksand(cfg.QUICKSAND_COUNT);
      }
      this.warnTarget = null;
    }

    startSandstorm() {
      const cfg = CFG.SANDWORM_BOSS;
      this.phase = 'sandstorm';
      this.phaseTimer = 0;
      this.burrowed = false;

      const player = this.game.player;
      const baseAngle = Math.atan2(player.y - this.y, player.x - this.x);
      const spawnDistance = this.contactHalf + 16;
      for (let i = 0; i < cfg.SANDSTORM_COUNT; i += 1) {
        const angle = baseAngle +
          (i - (cfg.SANDSTORM_COUNT - 1) / 2) * cfg.SANDSTORM_SPREAD;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        this.game.orbs.spawn(
          this.x + dx * spawnDistance,
          this.y + dy * spawnDistance,
          dx,
          dy,
          'enemy',
          cfg.SANDSTORM_DAMAGE,
          cfg.SANDSTORM_SPEED,
          cfg.SANDSTORM_TREE_DAMAGE,
          cfg.SANDSTORM_RADIUS
        );
      }

      this.game.addShake(3.6, 0.24);
      this.game.spawnBurst(
        this.x, this.y - 30, 18,
        ['#b2813e', '#d8b268', '#6b442e'],
        130, 0.55
      );
    }

    startBurrow() {
      if (this.state !== 'active') return;
      this.phase = 'tracking';
      this.phaseTimer = 0;
      this.burrowed = true;
      this.moving = false;
      this.trailTimer = 0;
      this.game.spawnBurst(
        this.x, this.y + 12, 18,
        ['#7a4d28', '#b2813e', '#d8b268'],
        110, 0.6
      );
      this.game.addShake(2.2, 0.16);
    }
  }

  class SnowmanChiefBoss extends Boss {
    constructor(game) {
      super(game);
      const cfg = CFG.SNOWMAN_BOSS;
      this.type = 'snowmanChief';
      this.label = '雪人头目';
      this.maxHp = cfg.MAX_HP;
      this.hp = cfg.MAX_HP;
      this.x = cfg.SPAWN_X;
      this.y = cfg.SPAWN_Y;
      this.contactHalf = cfg.CONTACT_HALF;
      this.contactDamage = cfg.CONTACT_DAMAGE;
      this.contactCooldown = 0;
      this.contactRecoilTimer = 0;
      this.hitFlash = 0;
      this.action = 'idle';
      this.actionTimer = 0;
      this.actionDuration = 0;
      this.blizzardTimer = cfg.BLIZZARD_INTERVAL;
      this.iceTimer = 3.0;
      this.slamCooldown = cfg.SLAM_COOLDOWN;
      this.slamTargetX = cfg.SPAWN_X;
      this.slamTargetY = cfg.SPAWN_Y;
      this.slamJumpFromX = cfg.SPAWN_X;
      this.slamJumpFromY = cfg.SPAWN_Y;
      this.jumpOffsetY = 0;
      this.slamShockwave = 0;
      this.slamFire = null;
      this.enraged = false;
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.moving = false;
      this.walkTime = 0;
      this.stunTimer = 0;
    }

    getPhaseName() {
      return this.enraged ? '狂暴' : '常态';
    }

    getActionLabel() {
      if (this.state === 'dying') return '倒下';
      if (this.action === 'slamWarn') return '砸地灭火 · 蓄力';
      if (this.action === 'slamJump') return '砸地灭火 · 腾空';
      if (this.action === 'slamStun') return '砸地硬直';
      if (this.game.blizzardActive) return '暴风雪';
      if (this.action === 'iceCast') return '冰锥弹幕';
      return '压迫';
    }

    getSkillLabel() {
      if (
        this.action === 'slamWarn' ||
        this.action === 'slamJump' ||
        this.action === 'slamStun'
      ) return '砸地灭火';
      if (this.game.blizzardActive) return '暴风雪';
      return '冰锥弹幕';
    }

    takeDamage(amount, sourceX, sourceY, sourceKind = 'orb') {
      if (this.state !== 'active') return;
      this.hp = Math.max(0, this.hp - amount);
      this.hitFlash = CFG.SNOWMAN_BOSS.HIT_FLASH_TIME;
      if (amount > 0) this.game.onBossDamaged(amount, sourceKind);
      this.game.addShake(1.7, 0.08);
      this.game.spawnBurst(
        sourceX, sourceY, 6,
        ['#f4fbff', '#b9e4f4', '#7fa9bc'], 90, 0.3
      );
      if (this.hp <= 0) this.startDeath();
    }

    startDeath() {
      if (this.state !== 'active') return;
      this.state = 'dying';
      this.action = 'dying';
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.moving = false;
      this.game.addShake(9, 0.7);
      this.game.spawnBurst(
        this.x, this.y - 28, 42,
        ['#f4fbff', '#b9e4f4', '#7fa9bc', '#ffffff'],
        190, 0.9
      );
    }

    update(dt) {
      if (this.state === 'dead') return;
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.contactCooldown = Math.max(0, this.contactCooldown - dt);
      this.contactRecoilTimer = Math.max(0, this.contactRecoilTimer - dt);
      this.slamShockwave = Math.max(0, this.slamShockwave - dt);
      this.walkTime += dt;

      if (this.state === 'dying') {
        this.deathTimer += dt;
        this.deathPuffTimer -= dt;
        if (this.deathPuffTimer <= 0) {
          this.deathPuffTimer = 0.15;
          this.game.spawnBurst(
            this.x + randomRange(Math.random, -35, 35),
            this.y + randomRange(Math.random, -30, 20),
            6,
            ['#f4fbff', '#b9e4f4', '#7fa9bc'],
            80, 0.55
          );
        }
        if (this.deathTimer >= CFG.SNOWMAN_BOSS.DEATH_TIME) {
          this.state = 'dead';
          this.game.onBossDefeated();
        }
        return;
      }

      if (this.game.state !== 'playing') return;

      if (!this.enraged && this.hp <= CFG.SNOWMAN_BOSS.ENRAGE_HP) {
        this.enraged = true;
        this.blizzardTimer = Math.min(this.blizzardTimer, 3.0);
        this.iceTimer = Math.min(this.iceTimer, 1.5);
        this.game.showToast('雪人头目狂暴 · 暴风雪加快', 2.0);
        this.game.addShake(5.5, 0.4);
        this.game.spawnBurst(
          this.x, this.y - 25, 28,
          ['#d8f4ff', '#8bcbe4', '#6d9eb3'], 150, 0.7
        );
      }

      this.blizzardTimer -= dt;
      if (this.blizzardTimer <= 0) {
        this.blizzardTimer = this.enraged
          ? CFG.SNOWMAN_BOSS.BLIZZARD_ENRAGED_INTERVAL
          : CFG.SNOWMAN_BOSS.BLIZZARD_INTERVAL;
        this.game.startBlizzard(CFG.SNOWMAN_BOSS.BLIZZARD_DURATION);
      }

      if (this.action === 'slamWarn') {
        this.actionTimer += dt;
        this.moving = false;
        this.jumpOffsetY = 0;
        if (this.actionTimer >= this.actionDuration) {
          this.action = 'slamJump';
          this.actionTimer = 0;
          this.actionDuration = CFG.SNOWMAN_BOSS.SLAM_JUMP_TIME;
          this.slamJumpFromX = this.x;
          this.slamJumpFromY = this.y;
        }
        return;
      }

      if (this.action === 'slamJump') {
        this.actionTimer += dt;
        this.moving = false;
        const cfg = CFG.SNOWMAN_BOSS;
        const t = clamp(
          this.actionTimer / Math.max(0.001, cfg.SLAM_JUMP_TIME), 0, 1
        );
        this.x = this.slamJumpFromX +
          (this.slamTargetX - this.slamJumpFromX) * t;
        this.y = this.slamJumpFromY +
          (this.slamTargetY - this.slamJumpFromY) * t;
        this.jumpOffsetY = Math.sin(t * Math.PI) * cfg.SLAM_JUMP_HEIGHT;
        if (this.actionTimer >= this.actionDuration) this.impactSlam();
        return;
      }

      if (this.action === 'slamStun') {
        this.actionTimer += dt;
        this.stunTimer = Math.max(0, this.actionDuration - this.actionTimer);
        this.moving = false;
        if (this.actionTimer >= this.actionDuration) {
          this.action = 'idle';
          this.actionTimer = 0;
          this.actionDuration = 0;
          this.stunTimer = 0;
        }
        return;
      }

      this.iceTimer -= dt;
      this.slamCooldown = Math.max(0, this.slamCooldown - dt);

      if (this.slamCooldown <= 0) {
        const fire = this.findNearestFireToPlayer();
        if (fire) {
          this.startSlam(fire);
          return;
        }
      }

      if (this.iceTimer <= 0) {
        this.fireIceCone();
        this.iceTimer = this.enraged
          ? CFG.SNOWMAN_BOSS.ICE_ENRAGED_INTERVAL
          : CFG.SNOWMAN_BOSS.ICE_INTERVAL;
      }

      const player = this.game.player;
      const dist = distance(this.x, this.y, player.x, player.y);
      if (dist > 95) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.001) {
          moveBody(
            this.game, this,
            (dx / len) * 52 * dt,
            (dy / len) * 52 * dt,
            this.contactHalf,
            this.contactHalf
          );
        }
        this.moving = true;
      } else {
        this.moving = false;
      }
    }

    findNearestFireToPlayer() {
      const player = this.game.player;
      let best = null;
      let bestDist = Infinity;
      for (const fire of this.game.campfires) {
        if (fire.dead) continue;
        const d = distance(player.x, player.y, fire.x, fire.y);
        if (d < bestDist) {
          bestDist = d;
          best = fire;
        }
      }
      return best;
    }

    startSlam(fire) {
      const cfg = CFG.SNOWMAN_BOSS;
      this.action = 'slamWarn';
      this.actionTimer = 0;
      this.actionDuration = cfg.SLAM_WARN_TIME;
      this.slamTargetX = fire.x;
      this.slamTargetY = fire.y;
      this.slamJumpFromX = this.x;
      this.slamJumpFromY = this.y;
      this.jumpOffsetY = 0;
      this.slamShockwave = 0;
      this.slamFire = fire;
      this.moving = false;
      this.game.spawnBurst(
        this.x, this.y + 20, 12,
        ['#dff4ff', '#a9d8ee', '#6f9db5'],
        90, 0.5
      );
    }

    impactSlam() {
      const cfg = CFG.SNOWMAN_BOSS;
      this.x = this.slamTargetX;
      this.y = this.slamTargetY;
      this.jumpOffsetY = 0;
      this.slamShockwave = cfg.SLAM_SHOCKWAVE_TIME;
      this.game.addShake(10.5, 0.65);
      this.game.spawnBurst(
        this.x, this.y + 6, 34,
        ['#f4fbff', '#b9e4f4', '#7fa9bc', '#ffffff'],
        185, 0.8
      );

      const player = this.game.player;
      if (distance(player.x, player.y, this.x, this.y) <= cfg.SLAM_RADIUS) {
        player.takeDamage(cfg.SLAM_DAMAGE, this.x, this.y);
      }

      if (this.slamFire && !this.slamFire.dead) {
        this.slamFire.destroyedByBoss = true;
        this.slamFire.respawnTimer = cfg.FIRE_RESPAWN_TIME;
        this.slamFire.takeDamage(999);
      }
      this.slamFire = null;
      this.action = 'slamStun';
      this.actionTimer = 0;
      this.actionDuration = cfg.SLAM_STUN_TIME;
      this.stunTimer = cfg.SLAM_STUN_TIME;
      this.slamCooldown = cfg.SLAM_COOLDOWN;
      this.moving = false;
    }

    fireIceCone() {
      const cfg = CFG.SNOWMAN_BOSS;
      const player = this.game.player;
      const count = this.enraged ? cfg.ICE_ENRAGED_COUNT : cfg.ICE_COUNT;
      const baseAngle = Math.atan2(player.y - this.y, player.x - this.x);
      const spawnDistance = this.contactHalf + cfg.ICE_RADIUS + 12;

      for (let i = 0; i < count; i += 1) {
        const angle = baseAngle +
          (i - (count - 1) / 2) * cfg.ICE_SPREAD;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        this.game.orbs.spawn(
          this.x + dx * spawnDistance,
          this.y + dy * spawnDistance,
          dx, dy, 'enemy',
          cfg.ICE_DAMAGE,
          cfg.ICE_SPEED,
          1,
          cfg.ICE_RADIUS,
          cfg.ICE_COLD
        );
      }
      this.action = 'idle';
      this.game.addShake(2.6, 0.18);
    }
  }

  class EvilMageBoss extends Boss {
    constructor(game) {
      super(game);
      const cfg = CFG.EVIL_MAGE_BOSS;
      this.type = 'evilMage';
      this.label = '邪恶法师';
      this.maxHp = cfg.MAX_HP;
      this.hp = cfg.MAX_HP;
      this.x = CFG.WORLD.W / 2;
      this.y = 300;
      this.contactHalf = cfg.CONTACT_HALF;
      this.contactDamage = cfg.CONTACT_DAMAGE;
      this.contactCooldown = 0;
      this.contactRecoilTimer = 0;
      this.hitFlash = 0;
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.walkTime = 0;
      this.moving = false;
      this.skillState = 'idle';
      this.skillTimer = 0;
      this.orbTimer = cfg.ORB_INTERVAL;
      this.orbCooldown = 0;
      this.teleportCooldown = 0;
      this.teleportTimer = cfg.TELEPORT_INTERVAL;
      this.teleportInvuln = 0;
      this.scatterTimer = cfg.SCATTER_INTERVAL;
      this.rayAngle = 0;
      this.teleportFromX = this.x;
      this.teleportFromY = this.y;
      this.teleportTargetX = this.x;
      this.teleportTargetY = this.y;
    }

    getPhaseName() {
      return this.hp <= CFG.EVIL_MAGE_BOSS.MAX_HP * 0.5 ? '血月' : '暗影';
    }

    takeDamage(amount, sourceX, sourceY, sourceKind = 'orb') {
      if (
        this.teleportInvuln > 0 ||
        this.skillState === 'teleport' ||
        this.skillState === 'teleportIn'
      ) return;
      super.takeDamage(amount, sourceX, sourceY, sourceKind);
    }

    getActionLabel() {
      if (this.state === 'dying') return '湮灭';
      if (this.skillState === 'castOrb') return '追踪魔弹 · 吟唱';
      if (this.skillState === 'scatterCast') return '暗影散射 · 蓄力';
      if (this.skillState === 'teleport') return '暗影传送';
      if (this.skillState === 'teleportIn') return '暗影凝聚 · 无敌';
      if (this.skillState === 'rayWindup') return '死亡射线 · 预警';
      if (this.skillState === 'rayActive') return '死亡射线';
      return '幽灵游走';
    }

    getSkillLabel() {
      return '暗影散射 / 追踪魔弹 / 传送射线';
    }

    startDeath() {
      if (this.state !== 'active') return;
      this.state = 'dying';
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.moving = false;
      this.skillState = 'idle';
      this.game.addShake(10, 0.8);
      this.game.spawnBurst(
        this.x, this.y - 20, 38,
        ['#b26cff', '#6b3e9b', '#1b1024', '#d8d3c2'],
        180, 0.9
      );
    }

    findTeleportPosition() {
      const cfg = CFG.EVIL_MAGE_BOSS;
      const player = this.game.player;
      for (let attempt = 0; attempt < 240; attempt += 1) {
        const angle = Math.random() * Math.PI * 2;
        const dist = cfg.TELEPORT_DISTANCE;
        const x = player.x + Math.cos(angle) * dist;
        const y = player.y + Math.sin(angle) * dist;
        if (this.game.isSafeMagePosition(x, y, this.contactHalf)) {
          return { x, y };
        }
      }
      return { x: this.x, y: this.y };
    }

    startTeleport() {
      const cfg = CFG.EVIL_MAGE_BOSS;
      this.skillState = 'teleport';
      this.skillTimer = cfg.TELEPORT_CAST_TIME;
      this.teleportInvuln = cfg.TELEPORT_CAST_TIME + cfg.TELEPORT_REAPPEAR_TIME;
      this.teleportFromX = this.x;
      this.teleportFromY = this.y;
      const target = this.findTeleportPosition();
      this.teleportTargetX = target.x;
      this.teleportTargetY = target.y;
      this.game.addShake(3.5, 0.2);
      this.game.spawnBurst(
        this.x, this.y, 22,
        ['#24112e', '#6b3e9b', '#b26cff'], 120, 0.6
      );
    }

    startRay() {
      this.skillState = 'rayWindup';
      this.skillTimer = CFG.EVIL_MAGE_BOSS.RAY_WARN_TIME;
      const player = this.game.player;
      this.rayAngle = Math.atan2(player.y - this.y, player.x - this.x);
      this.game.addShake(2.2, 0.15);
    }

    applyRayDamage() {
      const cfg = CFG.EVIL_MAGE_BOSS;
      const player = this.game.player;
      const dx = Math.cos(this.rayAngle) * cfg.RAY_LENGTH;
      const dy = Math.sin(this.rayAngle) * cfg.RAY_LENGTH;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0
        ? clamp(
          ((player.x - this.x) * dx + (player.y - this.y) * dy) / len2,
          0, 1
        )
        : 0;
      const cx = this.x + dx * t;
      const cy = this.y + dy * t;
      if (
        distance(player.x, player.y, cx, cy) <=
        cfg.RAY_WIDTH / 2 + player.halfW
      ) {
        player.takeDamage(cfg.RAY_DAMAGE, this.x, this.y);
      }
    }

    update(dt) {
      if (this.state === 'dead') return;
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.contactCooldown = Math.max(0, this.contactCooldown - dt);
      this.contactRecoilTimer = Math.max(0, this.contactRecoilTimer - dt);
      this.walkTime += dt;

      if (this.state === 'dying') {
        this.deathTimer += dt;
        this.deathPuffTimer -= dt;
        if (this.deathPuffTimer <= 0) {
          this.deathPuffTimer = 0.14;
          this.game.spawnBurst(
            this.x + randomRange(Math.random, -42, 42),
            this.y + randomRange(Math.random, -40, 30),
            6, ['#b26cff', '#6b3e9b', '#d8d3c2'],
            85, 0.55
          );
        }
        if (this.deathTimer >= CFG.EVIL_MAGE_BOSS.DEATH_TIME) {
          this.state = 'dead';
          this.game.onBossDefeated();
        }
        return;
      }

      if (this.game.state !== 'playing') return;
      this.orbCooldown = Math.max(0, this.orbCooldown - dt);
      this.teleportCooldown = Math.max(0, this.teleportCooldown - dt);
      this.teleportInvuln = Math.max(0, this.teleportInvuln - dt);

      const player = this.game.player;
      const dist = distance(this.x, this.y, player.x, player.y);

      if (this.skillState === 'teleport') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.skillTimer === 0) {
          this.x = this.teleportTargetX;
          this.y = this.teleportTargetY;
          this.skillState = 'teleportIn';
          this.skillTimer = CFG.EVIL_MAGE_BOSS.TELEPORT_REAPPEAR_TIME;
          this.teleportInvuln = CFG.EVIL_MAGE_BOSS.TELEPORT_REAPPEAR_TIME;
          this.game.spawnBurst(
            this.x, this.y, 24,
            ['#b26cff', '#6b3e9b', '#1b1024'], 140, 0.6
          );
        }
        return;
      }

      if (this.skillState === 'teleportIn') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.skillTimer === 0) this.startRay();
        return;
      }

      if (this.skillState === 'rayWindup') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.skillTimer === 0) {
          this.applyRayDamage();
          this.skillState = 'rayActive';
          this.skillTimer = CFG.EVIL_MAGE_BOSS.RAY_ACTIVE_TIME;
          this.game.addShake(7, 0.35);
        }
        return;
      }

      if (this.skillState === 'rayActive') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.skillTimer === 0) this.skillState = 'idle';
        return;
      }

      // 近身优先：打断散射/追踪弹蓄力，立刻传送。
      if (dist < 150 && this.teleportCooldown <= 0 &&
        (this.skillState === 'castOrb' || this.skillState === 'scatterCast' ||
          this.skillState === 'idle')) {
        this.teleportCooldown = CFG.EVIL_MAGE_BOSS.TELEPORT_COOLDOWN;
        this.teleportTimer = CFG.EVIL_MAGE_BOSS.TELEPORT_INTERVAL;
        this.startTeleport();
        return;
      }

      if (this.skillState === 'castOrb') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.skillTimer === 0) {
          this.game.spawnEvilOrb(this.x, this.y, player.x, player.y);
          this.skillState = 'idle';
          this.orbTimer = CFG.EVIL_MAGE_BOSS.ORB_INTERVAL;
        }
        return;
      }

      if (this.skillState === 'scatterCast') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.skillTimer === 0) {
          this.game.spawnShadowScatter(this.x, this.y, player.x, player.y);
          this.skillState = 'idle';
          this.scatterTimer = CFG.EVIL_MAGE_BOSS.SCATTER_INTERVAL;
        }
        return;
      }

      // 平时站桩；每8秒主动传送，玩家近身也可强制触发。
      this.moving = false;
      this.teleportTimer = Math.max(0, this.teleportTimer - dt);
      if (this.teleportCooldown <= 0 &&
        (this.teleportTimer === 0 || dist < 150)) {
        this.teleportCooldown = CFG.EVIL_MAGE_BOSS.TELEPORT_COOLDOWN;
        this.teleportTimer = CFG.EVIL_MAGE_BOSS.TELEPORT_INTERVAL;
        this.startTeleport();
        return;
      }

      this.scatterTimer = Math.max(0, this.scatterTimer - dt);
      if (this.scatterTimer === 0) {
        this.skillState = 'scatterCast';
        this.skillTimer = CFG.EVIL_MAGE_BOSS.SCATTER_CAST_TIME;
        this.game.addShake(1.2, 0.08);
        return;
      }

      this.orbTimer = Math.max(0, this.orbTimer - dt);
      if (this.orbTimer === 0) {
        this.skillState = 'castOrb';
        this.skillTimer = CFG.EVIL_MAGE_BOSS.ORB_CAST_TIME;
        this.game.addShake(1.8, 0.12);
        return;
      }
    }
  }

  class AbyssWhaleBoss extends Boss {
    constructor(game) {
      super(game);
      const cfg = CFG.ABYSS_WHALE;
      this.type = 'abyssWhale';
      this.label = '深渊巨鲸';
      this.maxHp = cfg.MAX_HP;
      this.hp = cfg.MAX_HP;
      this.x = CFG.WORLD.W / 2;
      this.y = 300;
      this.contactHalf = cfg.CONTACT_HALF;
      this.contactDamage = cfg.CONTACT_DAMAGE;
      this.contactCooldown = 0;
      this.contactRecoilTimer = 0;
      this.hitFlash = 0;
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.walkTime = 0;
      this.moving = false;
      this.skillState = 'idle';
      this.columnAngle = 0;
      this.columnCooldown = 2;
      this.waveCooldown = 4;
      this.gravityCooldown = 6;
      this.skillTimer = 0;
      this.waves = [];
      this.waveWarnTimer = 0;
      this.slamCooldown = 8;
      this.slamTargetX = this.x;
      this.slamTargetY = this.y;
      this.slamOrbs = [];
    }

    getPhaseName() {
      return this.hp <= CFG.ABYSS_WHALE.MAX_HP * 0.5 ? '深潮' : '潮汐';
    }

    getActionLabel() {
      if (this.state === 'dying') return '沉没';
      if (this.skillState === 'columnWindup') return '顺时针水柱 · 蓄力';
      if (this.skillState === 'column') return '顺时针水柱';
      if (this.skillState === 'waves') return '深海巨浪';
      if (this.skillState === 'gravity') return '潮汐引力';
      if (this.skillState === 'slamDive') return '深渊跃击 · 下潜';
      if (this.skillState === 'slamStun') return '深渊跃击 · 硬直';
      return '中央游弋';
    }

    getSkillLabel() {
      return '顺时针水柱 / 深海巨浪 / 潮汐引力';
    }

    startDeath() {
      if (this.state !== 'active') return;
      this.state = 'dying';
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.moving = false;
      this.game.addShake(12, 0.9);
      this.game.spawnBurst(
        this.x, this.y, 48,
        ['#8fd8ef', '#3f8fb8', '#12314a'], 200, 1
      );
    }

    startColumn() {
      this.skillState = 'columnWindup';
      this.skillTimer = CFG.ABYSS_WHALE.COLUMN_WARN_TIME;
      this.columnAngle = Math.atan2(
        this.game.player.y - this.y, this.game.player.x - this.x
      );
      this.moving = false;
      this.game.addShake(2, 0.15);
    }

    startWaves() {
      const cfg = CFG.ABYSS_WHALE;
      this.skillState = 'waves';
      this.waveWarnTimer = cfg.WAVE_WARN_TIME;
      this.waves = [];
      const directions = ['right', 'left', 'down', 'up', 'right'];
      for (let i = 0; i < cfg.WAVE_COUNT; i += 1) {
        const dir = directions[i % directions.length];
        const horizontal = dir === 'right' || dir === 'left';
        const width = horizontal ? cfg.WAVE_WIDTH : cfg.WAVE_HEIGHT;
        const height = horizontal ? cfg.WAVE_HEIGHT : cfg.WAVE_WIDTH;
        const y = randomRange(Math.random, 150, CFG.WORLD.H - 150);
        const x = randomRange(Math.random, 150, CFG.WORLD.W - 150);
        this.waves.push({
          dir,
          x: horizontal
            ? (dir === 'right' ? -width / 2 : CFG.WORLD.W + width / 2)
            : x,
          y: horizontal
            ? y
            : (dir === 'down' ? -height / 2 : CFG.WORLD.H + height / 2),
          width,
          height,
          active: false
        });
      }
      this.moving = false;
      this.game.addShake(2.5, 0.2);
    }

    startGravity() {
      this.skillState = 'gravity';
      this.skillTimer = CFG.ABYSS_WHALE.GRAVITY_DURATION;
      this.moving = false;
      this.game.addShake(5, 0.5);
    }

    startSlam() {
      const cfg = CFG.ABYSS_WHALE;
      this.skillState = 'slamDive';
      this.skillTimer = cfg.SLAM_WARN_TIME;
      this.slamTargetX = this.game.player.x;
      this.slamTargetY = this.game.player.y;
      this.slamCooldown = cfg.SLAM_COOLDOWN;
      this.slamOrbs = [];
      this.moving = false;
      this.game.addShake(4.5, 0.4);
    }

    spawnSlamOrbs() {
      const cfg = CFG.ABYSS_WHALE;
      this.slamOrbs = [];
      for (let i = 0; i < cfg.SLAM_ORB_COUNT; i += 1) {
        const angle = (i / cfg.SLAM_ORB_COUNT) * Math.PI * 2;
        this.slamOrbs.push({
          x: this.x,
          y: this.y,
          vx: Math.cos(angle) * cfg.SLAM_ORB_SPEED,
          vy: Math.sin(angle) * cfg.SLAM_ORB_SPEED,
          radius: 10,
          life: cfg.SLAM_ORB_LIFE,
          damage: cfg.SLAM_ORB_DAMAGE
        });
      }
    }

    updateSlamOrbs(dt) {
      const cfg = CFG.ABYSS_WHALE;
      for (let i = this.slamOrbs.length - 1; i >= 0; i -= 1) {
        const orb = this.slamOrbs[i];
        orb.life -= dt;
        orb.x += orb.vx * dt;
        orb.y += orb.vy * dt;
        if (
          orb.life <= 0 ||
          isCircleBlocked(this.game, orb.x, orb.y, orb.radius)
        ) {
          this.slamOrbs.splice(i, 1);
          continue;
        }
        if (distance(orb.x, orb.y, this.game.player.x, this.game.player.y) <=
          orb.radius + this.game.player.halfW) {
          this.game.player.takeDamage(orb.damage, orb.x, orb.y);
          this.slamOrbs.splice(i, 1);
        }
      }
    }

    update(dt) {
      if (this.state === 'dead') return;
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.contactCooldown = Math.max(0, this.contactCooldown - dt);
      this.contactRecoilTimer = Math.max(0, this.contactRecoilTimer - dt);
      this.walkTime += dt;

      if (this.state === 'dying') {
        this.deathTimer += dt;
        this.deathPuffTimer -= dt;
        if (this.deathPuffTimer <= 0) {
          this.deathPuffTimer = 0.14;
          this.game.spawnBurst(
            this.x + randomRange(Math.random, -100, 100),
            this.y + randomRange(Math.random, -70, 60),
            7, ['#8fd8ef', '#3f8fb8', '#d9f7ff'], 100, 0.6
          );
        }
        if (this.deathTimer >= CFG.ABYSS_WHALE.DEATH_TIME) {
          this.state = 'dead';
          this.game.onBossDefeated();
        }
        return;
      }

      if (this.game.state !== 'playing') return;
      const cfg = CFG.ABYSS_WHALE;
      const player = this.game.player;

      this.updateSlamOrbs(dt);

      if (this.skillState === 'columnWindup') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.skillTimer === 0) {
          this.skillState = 'column';
          this.skillTimer = cfg.COLUMN_DURATION;
          this.game.addShake(5, 0.3);
          this.game.spawnBurst(
            this.x, this.y, 22,
            ['#d9f7ff', '#46b9e1', '#1d607f'], 150, 0.5
          );
        }
        return;
      }

      if (this.skillState === 'column') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.columnAngle += (Math.PI * 2 / cfg.COLUMN_DURATION) * dt;
        const dx = Math.cos(this.columnAngle) * cfg.COLUMN_LENGTH;
        const dy = Math.sin(this.columnAngle) * cfg.COLUMN_LENGTH;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0
          ? clamp(((player.x - this.x) * dx + (player.y - this.y) * dy) / len2, 0, 1)
          : 0;
        const cx = this.x + dx * t;
        const cy = this.y + dy * t;
        if (distance(player.x, player.y, cx, cy) <=
          cfg.COLUMN_WIDTH / 2 + player.halfW &&
          player.invuln <= 0) {
          player.takeDamage(cfg.COLUMN_DAMAGE, this.x, this.y);
          const kx = player.x - this.x;
          const ky = player.y - this.y;
          const kl = Math.max(1, Math.hypot(kx, ky));
          player.knockX += (kx / kl) * 320;
          player.knockY += (ky / kl) * 320;
        }
        if (this.skillTimer === 0) {
          this.skillState = 'idle';
          this.columnCooldown = cfg.COLUMN_COOLDOWN;
        }
        return;
      }

      if (this.skillState === 'waves') {
        if (this.waveWarnTimer > 0) {
          this.waveWarnTimer = Math.max(0, this.waveWarnTimer - dt);
          if (this.waveWarnTimer === 0) {
            for (const wave of this.waves) wave.active = true;
          }
          return;
        }
        let alive = 0;
        for (const wave of this.waves) {
          if (!wave.active) continue;
          const horizontal = wave.dir === 'right' || wave.dir === 'left';
          if (wave.dir === 'right') wave.x += cfg.WAVE_SPEED * dt;
          else if (wave.dir === 'left') wave.x -= cfg.WAVE_SPEED * dt;
          else if (wave.dir === 'down') wave.y += cfg.WAVE_SPEED * dt;
          else wave.y -= cfg.WAVE_SPEED * dt;
          const out = horizontal
            ? (wave.x < -wave.width || wave.x > CFG.WORLD.W + wave.width)
            : (wave.y < -wave.height || wave.y > CFG.WORLD.H + wave.height);
          if (out) {
            wave.active = false;
            continue;
          }
          alive += 1;
          if (
            player.x + player.halfW > wave.x - wave.width / 2 &&
            player.x - player.halfW < wave.x + wave.width / 2 &&
            player.y + player.halfH > wave.y - wave.height / 2 &&
            player.y - player.halfH < wave.y + wave.height / 2
          ) {
            if (player.takeDamage(cfg.WAVE_DAMAGE, this.x, this.y)) {
              player.applyTongueSlow(
                cfg.WAVE_SLOW_DURATION, cfg.WAVE_SLOW_MULT
              );
            }
          }
        }
        if (alive === 0) {
          this.skillState = 'idle';
          this.waveCooldown = cfg.WAVE_COOLDOWN;
        }
        return;
      }

      if (this.skillState === 'gravity') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (!player.rolling) {
          const dx = this.x - player.x;
          const dy = this.y - player.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          if (dist > 60) {
            player.x += (dx / dist) * cfg.GRAVITY_PULL * dt;
            player.y += (dy / dist) * cfg.GRAVITY_PULL * dt;
          }
        }
        if (this.skillTimer === 0) {
          this.skillState = 'idle';
          this.gravityCooldown = cfg.GRAVITY_COOLDOWN;
        }
        return;
      }

      if (this.skillState === 'slamDive') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.skillTimer === 0) {
          this.x = clamp(this.slamTargetX, 90, CFG.WORLD.W - 90);
          this.y = clamp(this.slamTargetY, 90, CFG.WORLD.H - 90);
          this.skillState = 'slamStun';
          this.skillTimer = cfg.SLAM_STUN;
          this.spawnSlamOrbs();
          this.game.addShake(11, 0.7);
          this.game.spawnBurst(
            this.x, this.y, 42,
            ['#8fd8ef', '#3f8fb8', '#d9f7ff', '#12314a'], 220, 0.9
          );
          if (distance(player.x, player.y, this.x, this.y) <= cfg.SLAM_RADIUS) {
            player.takeDamage(cfg.SLAM_DAMAGE, this.x, this.y);
          }
        }
        return;
      }

      if (this.skillState === 'slamStun') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.skillTimer === 0) this.skillState = 'idle';
        return;
      }

      this.columnCooldown = Math.max(0, this.columnCooldown - dt);
      this.waveCooldown = Math.max(0, this.waveCooldown - dt);
      this.gravityCooldown = Math.max(0, this.gravityCooldown - dt);
      this.slamCooldown = Math.max(0, this.slamCooldown - dt);
      if (this.columnCooldown === 0) {
        this.startColumn();
        return;
      }
      if (this.waveCooldown === 0) {
        this.startWaves();
        return;
      }
      if (this.gravityCooldown === 0) {
        this.startGravity();
        return;
      }
      if (this.slamCooldown === 0) {
        this.startSlam();
        return;
      }

      const targetX = CFG.WORLD.W / 2 + Math.sin(this.walkTime * 0.22) * 85;
      const targetY = 300 + Math.cos(this.walkTime * 0.18) * 45;
      const dx = targetX - this.x;
      const dy = targetY - this.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      if (len > 4) {
        moveBody(
          this.game, this,
          (dx / len) * cfg.MOVE_SPEED * dt,
          (dy / len) * cfg.MOVE_SPEED * dt,
          this.contactHalf, this.contactHalf
        );
        this.moving = true;
      } else {
        this.moving = false;
      }
    }
  }

  class DeityBoss extends Boss {
    constructor(game) {
      super(game);
      this.type = 'deity';
      this.label = '神明';
      this.maxHp = 500;
      this.hp = 500;
      this.x = CFG.WORLD.W / 2;
      this.y = 300;
      this.contactHalf = 80;
      this.contactDamage = 6;
      this.contactCooldown = 0;
      this.contactRecoilTimer = 0;
      this.hitFlash = 0;
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.walkTime = 0;
      this.moving = false;
      this.introVisible = true;
      this.skillState = 'idle';
      this.skillTimer = 0;
      this.skillCooldown = 3.5;
      this.lastSkill = null;
      this.holyOrbs = [];
      this.chainTarget = { x: 0, y: 0 };
      this.wrathTarget = { x: 0, y: 0 };
      this.wrathStruck = false;
      this.phantomWaves = [];
      this.thrustFromX = this.x;
      this.thrustFromY = this.y;
      this.wailType = 'frog';
      this.wailPhantom = { x: 0, y: 0 };
      this.wailCircles = [];
      this.stripOrigin = { x: 0, y: 0 };
      this.stripMaxDist = 0;
      this.voidCenter = { x: CFG.WORLD.W / 2, y: CFG.WORLD.H / 2 };
      this.voidMeteors = [];
      this.phaseTransitionTriggered = false;
      this.invulnerableTimer = 0;
      this.rageMode = false;
      this.timeStopActive = false;
      this.timeStopSub = 'barrage';
      this.timeStopCast = false;
      this.timeStopChainTimer = 0;
      this.timeStopChainHit = false;
      this.swordCircles = [];
      this.ultimateTriggered = false;
      this.ultimateTimer = 0;
      this.ultimateFailed = false;
    }

    getPhaseName() {
      if (this.hp > this.maxHp * 0.7) return '圣辉';
      if (this.hp > this.maxHp * 0.3) return '神怒';
      return '终焉';
    }

    getSkillCooldown() {
      if (this.hp > this.maxHp * 0.7) return 3.5;
      if (this.hp > this.maxHp * 0.3) return 3.0;
      return 2.5;
    }

    takeDamage(amount, sourceX, sourceY, sourceKind = 'orb') {
      if (this.invulnerableTimer > 0) return;
      super.takeDamage(amount, sourceX, sourceY, sourceKind);
    }

    getActionLabel() {
      if (this.state === 'dying') return '崩解';
      if (this.skillState === 'barrageWindup') return '圣光弹幕 · 蓄力';
      if (this.skillState === 'barrageRecover') return '圣光弹幕';
      if (this.skillState === 'chainWarn') return '光之锁链 · 预警';
      if (this.skillState === 'chainStrike') return '光之锁链';
      if (this.skillState === 'wrathWarn') return '神明之怒 · 升空';
      if (this.skillState === 'wrathStrike') return '神明之怒';
      if (this.skillState === 'thrustOut') return '幻影突刺 · 光化';
      if (this.skillState === 'thrustStrike') return '幻影突刺';
      if (this.skillState === 'wailSummon') return '亡者哀嚎 · 召唤';
      if (this.skillState === 'wailWarn') return '亡者哀嚎 · 预警';
      if (this.skillState === 'wailStrike') return '亡者哀嚎';
      if (this.skillState === 'stripWarn') return '禁忌剥离';
      if (this.skillState === 'stripHit') return '禁忌剥离 · 沉默';
      if (this.skillState === 'voidCast') return '万象天引 · 展开';
      if (this.skillState === 'voidActive') return '万象天引';
      if (this.skillState === 'transition') return '神格崩塌 · 冲击';
      if (this.skillState === 'timeStop') return '时间停滞';
      if (this.skillState === 'swordWarn') return '神罚之剑 · 降临';
      if (this.skillState === 'swordStrike') return '神罚之剑';
      if (this.skillState === 'ultimate') return '终极毁灭 · 读条';
      return this.moving ? '神临' : '俯视';
    }

    getSkillLabel() {
      if (this.hp > this.maxHp * 0.7) {
        return '圣光弹幕 / 光之锁链 / 神明之怒';
      }
      if (this.hp > this.maxHp * 0.3) {
        return '幻影突刺 / 亡者哀嚎 / 禁忌剥离 / 万象天引';
      }
      return '时间停滞 / 神罚之剑 / 终极毁灭';
    }

    startDeath() {
      if (this.state !== 'active') return;
      this.state = 'dying';
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.moving = false;
      this.game.addShake(13, 1);
      this.game.spawnBurst(
        this.x, this.y, 54,
        ['#fff4c2', '#e7bf58', '#b48830', '#ffffff'], 220, 1
      );
      // 最终Boss死亡立即进入结局，不再走普通奖励结算。
      this.game.startEnding();
    }

    startPhase1Skill() {
      if (this.hp <= this.maxHp * 0.7) return false;
      const pick = Math.floor(Math.random() * 3);
      const player = this.game.player;
      this.moving = false;
      this.skillTimer = 0;
      if (pick === 0) {
        this.lastSkill = 'barrage';
        this.skillState = 'barrageWindup';
        this.skillTimer = 0.5;
        this.game.addShake(1.4, 0.1);
      } else if (pick === 1) {
        this.lastSkill = 'chain';
        this.skillState = 'chainWarn';
        this.skillTimer = 0.8;
        this.chainTarget.x = player.x;
        this.chainTarget.y = player.y;
        this.game.addShake(1.6, 0.12);
      } else {
        this.lastSkill = 'wrath';
        this.skillState = 'wrathWarn';
        this.skillTimer = 1.0;
        this.wrathTarget.x = player.x;
        this.wrathTarget.y = player.y;
        this.wrathStruck = false;
        this.game.addShake(2.2, 0.16);
      }
      return true;
    }

    spawnHolyBarrage() {
      const player = this.game.player;
      const base = Math.atan2(player.y - this.y, player.x - this.x);
      for (let i = 0; i < 5; i += 1) {
        const angle = base + (i - 2) * 0.16;
        this.holyOrbs.push({
          x: this.x + Math.cos(angle) * 90,
          y: this.y + Math.sin(angle) * 90,
          vx: Math.cos(angle) * 220,
          vy: Math.sin(angle) * 220,
          radius: 9,
          life: 4.5,
          damage: 3
        });
      }
    }

    updateHolyOrbs(dt) {
      for (let i = this.holyOrbs.length - 1; i >= 0; i -= 1) {
        const orb = this.holyOrbs[i];
        orb.life -= dt;
        orb.x += orb.vx * dt;
        orb.y += orb.vy * dt;
        if (orb.life <= 0 ||
          isCircleBlocked(this.game, orb.x, orb.y, orb.radius)) {
          this.holyOrbs.splice(i, 1);
          continue;
        }
        if (distance(orb.x, orb.y, this.game.player.x, this.game.player.y) <=
          orb.radius + this.game.player.halfW) {
          this.game.player.takeDamage(orb.damage, orb.x, orb.y);
          this.holyOrbs.splice(i, 1);
        }
      }
    }

    applyChainDamage() {
      const dx = Math.abs(this.game.player.x - this.chainTarget.x);
      const dy = Math.abs(this.game.player.y - this.chainTarget.y);
      const long = 280;
      const thick = 48;
      if ((dx <= long / 2 && dy <= thick / 2) ||
        (dx <= thick / 2 && dy <= long / 2)) {
        this.game.player.takeDamage(5, this.x, this.y);
      }
    }

    applyWrathDamage() {
      if (distance(
        this.game.player.x, this.game.player.y,
        this.wrathTarget.x, this.wrathTarget.y
      ) <= 108) {
        this.game.player.takeDamage(6, this.x, this.y);
      }
    }

    startPhase2Skill() {
      if (this.hp > this.maxHp * 0.7 || this.hp <= this.maxHp * 0.3) {
        return false;
      }
      const pick = Math.floor(Math.random() * 4);
      this.moving = false;
      this.skillTimer = 0;
      if (pick === 0) {
        this.lastSkill = 'thrust';
        this.skillState = 'thrustOut';
        this.skillTimer = 0.5;
      } else if (pick === 1) {
        this.lastSkill = 'wail';
        this.skillState = 'wailSummon';
        this.skillTimer = 0.5;
        this.wailType = Math.random() < 0.5 ? 'frog' : 'worm';
        this.wailCircles = [];
        const edge = Math.floor(Math.random() * 4);
        this.wailPhantom.x = edge === 2 ? 80 : (edge === 3 ? CFG.WORLD.W - 80 : randomRange(Math.random, 180, CFG.WORLD.W - 180));
        this.wailPhantom.y = edge === 0 ? 90 : (edge === 1 ? CFG.WORLD.H - 90 : randomRange(Math.random, 160, CFG.WORLD.H - 160));
      } else if (pick === 2) {
        this.lastSkill = 'strip';
        this.skillState = 'stripWarn';
        this.skillTimer = 2.0;
        this.stripOrigin.x = this.game.player.x;
        this.stripOrigin.y = this.game.player.y;
        this.stripMaxDist = 0;
      } else {
        this.lastSkill = 'void';
        this.skillState = 'voidCast';
        this.skillTimer = 0.4;
        this.voidCenter.x = CFG.WORLD.W / 2;
        this.voidCenter.y = CFG.WORLD.H / 2;
        this.voidMeteors = [];
      }
      this.game.addShake(2.5, 0.18);
      return true;
    }

    beginPhaseTransition() {
      this.phaseTransitionTriggered = true;
      this.rageMode = true;
      this.skillState = 'transition';
      this.skillTimer = 1.0;
      this.invulnerableTimer = 1.0;
      this.moving = false;
      this.x = CFG.WORLD.W / 2;
      this.y = 300;
      const player = this.game.player;
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      player.knockX += (dx / len) * 560;
      player.knockY += (dy / len) * 560;
      this.game.addShake(9, 0.6);
      this.game.spawnBurst(
        this.x, this.y, 42,
        ['#fff4c2', '#ffd76b', '#ffffff', '#d8b04e'], 230, 0.9
      );
      this.game.showToast('神格崩塌 · 终焉降临', 2.0);
    }

    startPhase3Skill() {
      if (this.hp > this.maxHp * 0.3 || this.hp <= 0) return false;
      const pick = Math.random() < 0.5 ? 0 : 1;
      this.moving = false;
      this.skillTimer = 0;
      if (pick === 0) {
        this.skillState = 'timeStop';
        this.skillTimer = 3.0;
        this.timeStopActive = true;
        this.timeStopSub = Math.random() < 0.5 ? 'barrage' : 'chain';
        this.timeStopCast = false;
        this.timeStopChainTimer = 0;
        this.timeStopChainHit = false;
        this.game.player.applyTongueSlow(3.0, 0.5);
        this.game.addShake(3.5, 0.35);
        this.game.showToast('时间停滞', 1.4);
      } else {
        this.skillState = 'swordWarn';
        this.skillTimer = 1.2;
        const safe = Math.floor(Math.random() * 4);
        this.safeCorner = {
          x: safe === 1 || safe === 3 ? CFG.WORLD.W - 82 : 82,
          y: safe >= 2 ? CFG.WORLD.H - 82 : 82
        };
        this.swordCircles = [];
        for (let row = 0; row < 4; row += 1) {
          for (let col = 0; col < 6; col += 1) {
            const x = 150 + col * 196 + randomRange(Math.random, -18, 18);
            const y = 140 + row * 145 + randomRange(Math.random, -14, 14);
            if (distance(x, y, this.safeCorner.x, this.safeCorner.y) < 155) {
              continue;
            }
            this.swordCircles.push({ x, y, radius: 78 });
          }
        }
        this.game.addShake(5, 0.4);
        this.game.showToast('神罚之剑 · 寻找安全区', 1.6);
      }
      return true;
    }

    applySwordDamage() {
      for (const circle of this.swordCircles) {
        if (distance(
          this.game.player.x, this.game.player.y,
          circle.x, circle.y
        ) <= circle.radius) {
          this.game.player.takeDamage(8, circle.x, circle.y);
          break;
        }
      }
    }

    startUltimate() {
      this.ultimateTriggered = true;
      this.skillState = 'ultimate';
      this.ultimateTimer = 5.0;
      this.timeStopActive = false;
      this.rageMode = true;
      this.x = CFG.WORLD.W / 2;
      this.y = CFG.WORLD.H / 2;
      this.moving = false;
      this.holyOrbs = [];
      this.phantomWaves = [];
      this.wailCircles = [];
      this.voidMeteors = [];
      this.game.addShake(14, 1.0);
      this.game.spawnBurst(
        this.x, this.y, 60,
        ['#ffffff', '#fff4c2', '#ffd76b', '#d8b04e'], 260, 1.0
      );
      this.game.showToast('终极毁灭 · 5秒内击碎神明！', 3.0);
    }

    spawnPhantomWaves() {
      const player = this.game.player;
      const base = Math.atan2(player.y - this.y, player.x - this.x);
      for (let i = 0; i < 3; i += 1) {
        const angle = base + (i - 1) * 0.12;
        this.phantomWaves.push({
          x: this.x,
          y: this.y,
          dirX: Math.cos(angle),
          dirY: Math.sin(angle),
          angle,
          speed: 900,
          width: 88,
          height: 18,
          damage: 4,
          life: 1.6
        });
      }
    }

    updatePhantomWaves(dt) {
      for (let i = this.phantomWaves.length - 1; i >= 0; i -= 1) {
        const wave = this.phantomWaves[i];
        wave.life -= dt;
        wave.x += wave.dirX * wave.speed * dt;
        wave.y += wave.dirY * wave.speed * dt;
        if (wave.life <= 0 ||
          isCircleBlocked(this.game, wave.x, wave.y, 8)) {
          this.phantomWaves.splice(i, 1);
          continue;
        }
        const dx = this.game.player.x - wave.x;
        const dy = this.game.player.y - wave.y;
        const along = dx * wave.dirX + dy * wave.dirY;
        const lateral = Math.abs(dx * -wave.dirY + dy * wave.dirX);
        if (
          Math.abs(along) <= wave.width / 2 &&
          lateral <= wave.height / 2 + this.game.player.halfW
        ) {
          this.game.player.takeDamage(wave.damage, wave.x, wave.y);
          this.phantomWaves.splice(i, 1);
        }
      }
    }

    beginWailWarnings() {
      if (this.wailType === 'worm') {
        this.wailCircles = [];
        for (let i = 0; i < 5; i += 1) {
          this.wailCircles.push({
            x: randomRange(Math.random, 160, CFG.WORLD.W - 160),
            y: randomRange(Math.random, 150, CFG.WORLD.H - 150),
            radius: randomRange(Math.random, 70, 95)
          });
        }
      }
      this.skillState = 'wailWarn';
      this.skillTimer = 0.8;
    }

    applyWailDamage() {
      if (this.wailType === 'frog') {
        const dx = Math.abs(this.game.player.x - CFG.WORLD.W / 2);
        const dy = Math.abs(this.game.player.y - CFG.WORLD.H / 2);
        if (dx <= 82 || dy <= 82) {
          this.game.player.takeDamage(4, CFG.WORLD.W / 2, CFG.WORLD.H / 2);
        }
      } else {
        for (const circle of this.wailCircles) {
          if (distance(
            this.game.player.x, this.game.player.y,
            circle.x, circle.y
          ) <= circle.radius) {
            this.game.player.takeDamage(4, circle.x, circle.y);
            break;
          }
        }
      }
    }

    updateVoidMeteors(dt) {
      for (const meteor of this.voidMeteors) {
        if (meteor.impact > 0) {
          meteor.impact = Math.max(0, meteor.impact - dt);
          continue;
        }
        meteor.timer -= dt;
        if (meteor.timer <= 0 && !meteor.struck) {
          meteor.struck = true;
          meteor.impact = 0.35;
          if (distance(
            this.game.player.x, this.game.player.y,
            meteor.x, meteor.y
          ) <= meteor.radius) {
            this.game.player.takeDamage(5, meteor.x, meteor.y);
          }
          this.game.addShake(3.2, 0.18);
        }
      }
    }

    update(dt) {
      if (this.state === 'dead') return;
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.contactCooldown = Math.max(0, this.contactCooldown - dt);
      this.contactRecoilTimer = Math.max(0, this.contactRecoilTimer - dt);
      this.walkTime += dt;
      this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);
      this.updateHolyOrbs(dt);
      this.updatePhantomWaves(dt);

      if (this.state === 'dying') {
        this.deathTimer += dt;
        this.deathPuffTimer -= dt;
        if (this.deathPuffTimer <= 0) {
          this.deathPuffTimer = 0.14;
          this.game.spawnBurst(
            this.x + randomRange(Math.random, -90, 90),
            this.y + randomRange(Math.random, -90, 90),
            7, ['#fff4c2', '#e7bf58', '#ffffff'], 100, 0.6
          );
        }
        if (this.deathTimer >= 2.0) {
          this.state = 'dead';
          this.game.onBossDefeated();
        }
        return;
      }

      if (this.game.state !== 'playing') return;
      if (this.game.cinematic) {
        this.moving = false;
        return;
      }

      if (this.state === 'active' && this.hp <= this.maxHp * 0.1 &&
        !this.ultimateTriggered) {
        this.startUltimate();
        return;
      }

      if (this.state === 'active' && this.hp <= this.maxHp * 0.3 &&
        !this.phaseTransitionTriggered) {
        this.beginPhaseTransition();
        return;
      }

      if (this.skillState === 'transition') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          this.skillState = 'idle';
          this.skillCooldown = 2.5;
        }
        return;
      }

      if (this.skillState === 'ultimate') {
        this.ultimateTimer = Math.max(0, this.ultimateTimer - dt);
        this.moving = false;
        if (this.ultimateTimer === 0 && this.hp > 0) {
          this.ultimateFailed = true;
          this.game.player.hp = 0;
          this.game.onPlayerDeath();
        }
        return;
      }

      if (this.skillState === 'timeStop') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        this.timeStopActive = true;
        if (!this.timeStopCast && 3 - this.skillTimer >= 0.6) {
          this.timeStopCast = true;
          if (this.timeStopSub === 'barrage') {
            this.spawnHolyBarrage();
          } else {
            this.chainTarget.x = this.game.player.x;
            this.chainTarget.y = this.game.player.y;
            this.timeStopChainTimer = 0.8;
            this.timeStopChainHit = false;
          }
        }
        if (this.timeStopChainTimer > 0) {
          this.timeStopChainTimer = Math.max(0, this.timeStopChainTimer - dt);
          if (this.timeStopChainTimer === 0 && !this.timeStopChainHit) {
            this.timeStopChainHit = true;
            this.applyChainDamage();
            this.game.addShake(4, 0.25);
          }
        }
        if (this.skillTimer === 0) {
          this.timeStopActive = false;
          this.skillState = 'idle';
          this.skillCooldown = 2.5;
        }
        return;
      }

      if (this.skillState === 'swordWarn') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          this.applySwordDamage();
          this.skillState = 'swordStrike';
          this.skillTimer = 0.45;
          this.game.addShake(10, 0.6);
        }
        return;
      }

      if (this.skillState === 'swordStrike') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          this.skillState = 'idle';
          this.skillCooldown = 2.5;
        }
        return;
      }

      if (this.skillState === 'barrageWindup') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          this.spawnHolyBarrage();
          this.skillState = 'idle';
          this.skillCooldown = 3.5;
        }
        return;
      }

      if (this.skillState === 'chainWarn') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          this.applyChainDamage();
          this.skillState = 'chainStrike';
          this.skillTimer = 0.25;
          this.game.addShake(5.5, 0.3);
        }
        return;
      }

      if (this.skillState === 'chainStrike') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          this.skillState = 'idle';
          this.skillCooldown = 3.5;
        }
        return;
      }

      if (this.skillState === 'wrathWarn') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        // 持续追踪玩家，直到雷霆落下的前一刻锁定最后位置。
        this.wrathTarget.x = this.game.player.x;
        this.wrathTarget.y = this.game.player.y;
        if (this.skillTimer === 0) {
          this.applyWrathDamage();
          this.skillState = 'wrathStrike';
          this.skillTimer = 0.3;
          this.game.addShake(8, 0.4);
        }
        return;
      }

      if (this.skillState === 'wrathStrike') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          this.skillState = 'idle';
          this.skillCooldown = 3.5;
        }
        return;
      }

      if (this.skillState === 'thrustOut') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          const angle = Math.random() * Math.PI * 2;
          this.x = clamp(
            this.game.player.x + Math.cos(angle) * 100,
            120, CFG.WORLD.W - 120
          );
          this.y = clamp(
            this.game.player.y + Math.sin(angle) * 100,
            120, CFG.WORLD.H - 120
          );
          this.spawnPhantomWaves();
          this.skillState = 'thrustStrike';
          this.skillTimer = 0.35;
          this.game.addShake(4.5, 0.22);
          this.game.spawnBurst(
            this.x, this.y, 20,
            ['#ffffff', '#fff4c2', '#d8b04e'], 160, 0.5
          );
        }
        return;
      }

      if (this.skillState === 'thrustStrike') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          this.x = CFG.WORLD.W / 2;
          this.y = 300;
          this.skillState = 'idle';
          this.skillCooldown = this.getSkillCooldown();
        }
        return;
      }

      if (this.skillState === 'wailSummon') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) this.beginWailWarnings();
        return;
      }

      if (this.skillState === 'wailWarn') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          this.applyWailDamage();
          this.skillState = 'wailStrike';
          this.skillTimer = 0.5;
          this.game.addShake(6, 0.35);
        }
        return;
      }

      if (this.skillState === 'wailStrike') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          this.skillState = 'idle';
          this.skillCooldown = this.getSkillCooldown();
        }
        return;
      }

      if (this.skillState === 'stripWarn') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        this.stripMaxDist = Math.max(
          this.stripMaxDist,
          distance(
            this.game.player.x, this.game.player.y,
            this.stripOrigin.x, this.stripOrigin.y
          )
        );
        if (this.skillTimer === 0) {
          if (this.stripMaxDist <= 50) {
            this.game.player.silenceTimer = 5;
            this.game.showToast('禁忌剥离 · 沉默5秒', 1.8);
          }
          this.skillState = 'stripHit';
          this.skillTimer = 0.4;
          this.game.addShake(3.5, 0.2);
        }
        return;
      }

      if (this.skillState === 'stripHit') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          this.skillState = 'idle';
          this.skillCooldown = this.getSkillCooldown();
        }
        return;
      }

      if (this.skillState === 'voidCast') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        if (this.skillTimer === 0) {
          this.skillState = 'voidActive';
          this.skillTimer = 2.5;
          this.voidMeteors = [];
          for (let i = 0; i < 4; i += 1) {
            this.voidMeteors.push({
              x: randomRange(Math.random, 220, CFG.WORLD.W - 220),
              y: randomRange(Math.random, 180, CFG.WORLD.H - 180),
              radius: 82,
              timer: 1.1,
              impact: 0,
              struck: false
            });
          }
          this.game.addShake(4, 0.4);
        }
        return;
      }

      if (this.skillState === 'voidActive') {
        this.skillTimer = Math.max(0, this.skillTimer - dt);
        this.moving = false;
        this.updateVoidMeteors(dt);
        if (!this.game.player.rolling) {
          const dx = this.voidCenter.x - this.game.player.x;
          const dy = this.voidCenter.y - this.game.player.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          this.game.player.x += (dx / dist) * 72 * dt;
          this.game.player.y += (dy / dist) * 72 * dt;
          this.game.player.applyTongueSlow(0.25, 0.65);
        }
        if (this.skillTimer === 0) {
          this.skillState = 'idle';
          this.skillCooldown = this.getSkillCooldown();
        }
        return;
      }

      this.skillCooldown = Math.max(0, this.skillCooldown - dt);
      if (this.hp <= this.maxHp * 0.7 && this.skillCooldown > 3) {
        this.skillCooldown = 3;
      }
      if (this.hp <= this.maxHp * 0.3 && this.skillCooldown > 2.5) {
        this.skillCooldown = 2.5;
      }
      if (this.skillCooldown === 0) {
        if (this.hp > this.maxHp * 0.7) {
          if (this.startPhase1Skill()) return;
        } else if (this.hp > this.maxHp * 0.3) {
          if (this.startPhase2Skill()) return;
        } else if (this.hp > this.maxHp * 0.1) {
          if (this.startPhase3Skill()) return;
        }
      }

      const player = this.game.player;
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 150) {
        const moveSpeed = 25 * (this.rageMode ? 1.3 : 1);
        moveBody(
          this.game, this,
          (dx / dist) * moveSpeed * dt,
          (dy / dist) * moveSpeed * dt,
          this.contactHalf, this.contactHalf
        );
        this.moving = true;
      } else {
        this.moving = false;
      }
    }
  }
  class LavaDragonBoss extends Boss {
    constructor(game) {
      super(game);
      const cfg = CFG.LAVA_DRAGON;
      this.type = 'lavaDragon';
      this.label = '熔岩巨龙';
      this.maxHp = cfg.MAX_HP;
      this.hp = cfg.MAX_HP;
      this.x = cfg.SPAWN_X;
      this.y = cfg.SPAWN_Y;
      this.contactHalf = cfg.CONTACT_HALF;
      this.contactDamage = cfg.CONTACT_DAMAGE;
      this.contactCooldown = 0;
      this.contactRecoilTimer = 0;
      this.hitFlash = 0;
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.walkTime = 0;
      this.moving = false;
      this.skillState = 'idle';
      this.skillTimer = 0;
      this.breathAngle = 0;
      this.breathHit = false;
      this.breathCooldown = 2.4;
      this.tailCooldown = 2.0;
      this.infernoCooldown = 12;
      this.stunTimer = 0;
      this.rainWarnings = [];
      this.rainBlastTimer = 0;
      this.tailSpinTimer = 0;
      this.infernoSlamTimer = 0;
    }

    getPhaseName() {
      return this.hp <= CFG.LAVA_DRAGON.MAX_HP * CFG.LAVA_DRAGON.INFERNO_THRESHOLD
        ? '炼狱'
        : '熔岩';
    }

    getActionLabel() {
      if (this.state === 'dying') return '崩塌';
      if (this.stunTimer > 0) return '硬直';
      if (this.skillState === 'breathWindup') return '烈焰吐息 · 预警';
      if (this.skillState === 'breathActive') return '烈焰吐息';
      if (this.skillState === 'tailWindup') return '甩尾预警';
      if (this.skillState === 'infernoWarning') return '炼狱天降 · 预警';
      if (this.skillState === 'infernoBlast') return '炼狱火雨';
      return '缓慢逼近';
    }

    getSkillLabel() {
      return '烈焰吐息 / 甩尾 / 炼狱天降';
    }

    startDeath() {
      if (this.state !== 'active') return;
      this.state = 'dying';
      this.deathTimer = 0;
      this.deathPuffTimer = 0;
      this.moving = false;
      this.stunTimer = 0;
      this.skillState = 'idle';
      this.rainWarnings = [];
      this.tailSpinTimer = 0;
      this.infernoSlamTimer = 0;
      this.game.addShake(12, 1.0);
      this.game.spawnBurst(
        this.x, this.y - 20, 54,
        ['#ff6a28', '#ffb347', '#4b2323', '#2a1111'],
        220, 1.0
      );
    }

    getBreathOrigin() {
      return {
        x: this.x,
        y: this.y + CFG.LAVA_DRAGON.MOUTH_OFFSET_Y
      };
    }

    angleToPlayer() {
      const p = this.game.player;
      const origin = this.getBreathOrigin();
      return Math.atan2(p.y - origin.y, p.x - origin.x);
    }

    angleDifference(a, b) {
      return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    }

    startBreath() {
      const cfg = CFG.LAVA_DRAGON;
      this.skillState = 'breathWindup';
      this.skillTimer = cfg.BREATH_WINDUP;
      this.breathAngle = this.angleToPlayer();
      this.breathHit = false;
      this.moving = false;
    }

    updateBreath(dt) {
      const cfg = CFG.LAVA_DRAGON;
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      if (this.skillState === 'breathWindup' && this.skillTimer === 0) {
        this.skillState = 'breathActive';
        this.skillTimer = cfg.BREATH_ACTIVE;
        this.applyBreathDamage();
        this.breathCooldown = cfg.BREATH_COOLDOWN;
        this.game.addShake(5, 0.3);
      } else if (this.skillState === 'breathActive' && this.skillTimer === 0) {
        this.skillState = 'idle';
      }
    }

    applyBreathDamage() {
      const cfg = CFG.LAVA_DRAGON;
      const player = this.game.player;
      const origin = this.getBreathOrigin();
      const dist = distance(origin.x, origin.y, player.x, player.y);
      const diff = this.angleDifference(
        this.breathAngle,
        Math.atan2(player.y - origin.y, player.x - origin.x)
      );
      if (dist <= cfg.BREATH_RANGE && diff <= cfg.BREATH_HALF_ANGLE &&
        !this.game.isLineBlockedByObsidian(origin.x, origin.y, player.x, player.y)) {
        if (player.takeDamage(cfg.BREATH_DAMAGE, this.x, this.y)) {
          player.applyBurn(cfg.BURN_DURATION, cfg.BURN_DPS);
        }
      }
    }

    startTail() {
      const cfg = CFG.LAVA_DRAGON;
      this.skillState = 'tailWindup';
      this.skillTimer = cfg.TAIL_WINDUP;
      this.moving = false;
      this.game.addShake(2.2, 0.15);
    }

    updateTail(dt) {
      const cfg = CFG.LAVA_DRAGON;
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      if (this.skillTimer > 0) return;

      const player = this.game.player;
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= cfg.TAIL_RANGE) {
        if (player.takeDamage(cfg.TAIL_DAMAGE, this.x, this.y)) {
          const inv = 1 / Math.max(1, dist);
          player.knockX += dx * inv * 430;
          player.knockY += dy * inv * 430;
        }
      }
      this.tailCooldown = cfg.TAIL_COOLDOWN;
      this.stunTimer = cfg.TAIL_STUN;
      this.tailSpinTimer = cfg.TAIL_SPIN_TIME;
      this.skillState = 'idle';
      this.game.addShake(8, 0.45);
      this.game.spawnBurst(
        this.x, this.y, 26,
        ['#ff6a28', '#ffcf63', '#3a1717'], 190, 0.6
      );
    }

    startInferno() {
      const cfg = CFG.LAVA_DRAGON;
      this.skillState = 'infernoWarning';
      this.skillTimer = cfg.INFERNO_WARNING;
      this.rainWarnings = this.makeInfernoWarnings();
      this.infernoCooldown = cfg.INFERNO_COOLDOWN;
      this.moving = false;
      this.game.addShake(7.5, 0.8);
      this.game.showToast('熔岩巨龙怒吼 · 炼狱天降！', 2.0);
      this.game.spawnBurst(
        this.x, this.y - 45, 34,
        ['#ff6a28', '#ffcf63', '#4b1208'], 180, 0.9
      );
    }

    makeInfernoWarnings() {
      const cfg = CFG.LAVA_DRAGON;
      const target = Math.floor(
        randomRange(Math.random, cfg.INFERNO_MIN_CIRCLES, cfg.INFERNO_MAX_CIRCLES + 1)
      );
      // 随机留出一条纵向安全缝，玩家可以沿缝隙躲避整轮火雨。
      const laneX = randomRange(Math.random, 220, 940);
      const laneWidth = 112;
      const warnings = [];
      const inLane = (warning) =>
        warning.x + warning.radius > laneX &&
        warning.x - warning.radius < laneX + laneWidth;

      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 5; col += 1) {
          const x = 92 + col * 224 + 112 + randomRange(Math.random, -30, 30);
          const y = 145 + row * 185 + 92 + randomRange(Math.random, -20, 20);
          const radius = randomRange(
            Math.random, cfg.INFERNO_RADIUS_MIN, cfg.INFERNO_RADIUS_MAX
          );
          const warning = { x, y, radius, phase: Math.random() * Math.PI * 2 };
          if (!inLane(warning)) warnings.push(warning);
        }
      }

      // 安全缝过滤后补齐到至少10个红圈，仍然绝对不侵入安全缝。
      let guard = 0;
      while (warnings.length < cfg.INFERNO_MIN_CIRCLES && guard < 1200) {
        guard += 1;
        const warning = {
          x: randomRange(Math.random, 120, 1160),
          y: randomRange(Math.random, 150, 650),
          radius: randomRange(
            Math.random, cfg.INFERNO_RADIUS_MIN, cfg.INFERNO_RADIUS_MAX
          ),
          phase: Math.random() * Math.PI * 2
        };
        if (!inLane(warning)) warnings.push(warning);
      }

      for (let i = warnings.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [warnings[i], warnings[j]] = [warnings[j], warnings[i]];
      }
      return warnings.slice(0, Math.min(target, warnings.length));
    }

    updateInferno(dt) {
      const cfg = CFG.LAVA_DRAGON;
      this.skillTimer = Math.max(0, this.skillTimer - dt);
      if (this.skillState === 'infernoWarning' && this.skillTimer === 0) {
        const player = this.game.player;
        let hit = false;
        for (const warning of this.rainWarnings) {
          if (distance(player.x, player.y, warning.x, warning.y) <=
            warning.radius + player.halfW * 0.6) {
            hit = true;
            break;
          }
        }
        if (hit) player.takeDamage(cfg.INFERNO_DAMAGE, this.x, this.y);
        for (const warning of this.rainWarnings) {
          this.game.spawnBurst(
            warning.x, warning.y, 14,
            ['#ff6a28', '#ffcf63', '#b72a10', '#2a0806'],
            130, 0.7
          );
        }
        this.rainBlastTimer = 0.5;
        this.skillState = 'infernoBlast';
        this.skillTimer = 0.5;
        this.game.addShake(12, 0.6);
      } else if (this.skillState === 'infernoBlast' && this.skillTimer === 0) {
        this.skillState = 'idle';
        this.stunTimer = cfg.INFERNO_STUN;
        this.infernoSlamTimer = cfg.INFERNO_SLAM_TIME;
        this.rainWarnings = [];
        this.game.addShake(13, 0.55);
        this.game.spawnBurst(
          this.x, this.y + 35, 34,
          ['#ff6a28', '#ffcf63', '#6b442e', '#2a1111'],
          210, 0.8
        );
      }
    }

    update(dt) {
      if (this.state === 'dead') return;
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.contactCooldown = Math.max(0, this.contactCooldown - dt);
      this.contactRecoilTimer = Math.max(0, this.contactRecoilTimer - dt);
      this.walkTime += dt;
      this.breathCooldown = Math.max(0, this.breathCooldown - dt);
      this.tailCooldown = Math.max(0, this.tailCooldown - dt);
      this.infernoCooldown = Math.max(0, this.infernoCooldown - dt);
      this.tailSpinTimer = Math.max(0, this.tailSpinTimer - dt);
      this.infernoSlamTimer = Math.max(0, this.infernoSlamTimer - dt);

      if (this.state === 'dying') {
        this.deathTimer += dt;
        this.deathPuffTimer -= dt;
        if (this.deathPuffTimer <= 0) {
          this.deathPuffTimer = 0.14;
          this.game.spawnBurst(
            this.x + randomRange(Math.random, -70, 70),
            this.y + randomRange(Math.random, -60, 50),
            6, ['#ff6a28', '#ffb347', '#3a1717'],
            90, 0.55
          );
        }
        if (this.deathTimer >= CFG.LAVA_DRAGON.DEATH_TIME) {
          this.state = 'dead';
          this.game.onBossDefeated();
        }
        return;
      }

      if (this.game.state !== 'playing') return;
      if (this.stunTimer > 0) {
        this.stunTimer = Math.max(0, this.stunTimer - dt);
        this.moving = false;
        return;
      }

      if (this.skillState === 'breathWindup' || this.skillState === 'breathActive') {
        this.updateBreath(dt);
        return;
      }
      if (this.skillState === 'tailWindup') {
        this.updateTail(dt);
        return;
      }
      if (this.skillState === 'infernoWarning' || this.skillState === 'infernoBlast') {
        this.updateInferno(dt);
        return;
      }

      const cfg = CFG.LAVA_DRAGON;
      const player = this.game.player;
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const len = Math.hypot(dx, dy);
      if (this.hp <= cfg.MAX_HP * cfg.INFERNO_THRESHOLD &&
        this.infernoCooldown <= 0) {
        this.startInferno();
        return;
      }
      if (len <= cfg.TAIL_TRIGGER_RANGE && this.tailCooldown <= 0) {
        this.startTail();
        return;
      }
      if (this.breathCooldown <= 0) {
        this.startBreath();
        return;
      }

      if (len > 120) {
        moveBody(
          this.game, this,
          (dx / len) * cfg.MOVE_SPEED * dt,
          (dy / len) * cfg.MOVE_SPEED * dt,
          this.contactHalf, this.contactHalf
        );
        this.moving = true;
      } else {
        this.moving = false;
      }
    }
  }

  /** Boss 战斗相关的 Game 方法，供 Game 继承。 */
  class BossSystems {
    clearBossDamageFeedback() {
      this.bossDamagePopupTimer = 0;
      if (this.hud && this.hud.bossDamageText) {
        this.hud.bossDamageText.textContent = '';
        this.hud.bossDamageText.classList.remove('is-visible', 'is-tree');
      }
    }

    onBossDamaged(amount, sourceKind = 'orb') {
      this.bossDamagePopupTimer = sourceKind === 'tree' ? 1.3 : 0.65;
      if (!this.hud || !this.hud.bossDamageText) return;

      const el = this.hud.bossDamageText;
      el.textContent = `-${amount}`;
      el.classList.toggle('is-tree', sourceKind === 'tree');
      el.classList.remove('is-visible');
      void el.offsetWidth;
      el.classList.add('is-visible');
    }

    countBossTrees() {
      return this.trees.reduce(
        (count, tree) => count + (tree instanceof BossTree && tree.state !== 'stump' ? 1 : 0),
        0
      );
    }

    countWarningTrees() {
      return this.trees.reduce(
        (count, tree) => count + (tree instanceof BossTree && tree.state === 'warning' ? 1 : 0),
        0
      );
    }

    trySpawnBossTree(boss) {
      if (this.scene !== 'boss' || !boss || boss.state !== 'active') return false;
      if (this.countWarningTrees() >= CFG.BOSS.MAX_WARNING_TREES) return false;
      if (this.countBossTrees() >= CFG.BOSS.MAX_TREES) return false;

      const position = this.findBossTreeSpawnPosition(boss);
      if (!position) return false;

      this.trees.push(new BossTree(this, position.x, position.y));
      this.spawnBurst(position.x, position.y - 4, 8, ['#ff5348', '#ff8d6d', '#7a2a1e'], 55, 0.42);
      this.addShake(1.2, 0.1);
      return true;
    }

    findBossTreeSpawnPosition(boss) {
      const margin = CFG.BOSS.TREE_SPAWN_MARGIN;
      const exit = CFG.PORTAL.BOSS;
      const exitX = exit.x + exit.w / 2;
      const exitY = exit.y + exit.h / 2;
      const player = this.player;

      for (let i = 0; i < CFG.BOSS.TREE_SPAWN_ATTEMPTS; i += 1) {
        const x = randomRange(
          Math.random,
          CFG.WORLD.WALL + margin,
          CFG.WORLD.W - CFG.WORLD.WALL - margin
        );
        const y = randomRange(
          Math.random,
          CFG.WORLD.WALL + margin,
          CFG.WORLD.H - CFG.WORLD.WALL - margin
        );

        if (distance(x, y, player.x, player.y) < CFG.BOSS.TREE_SPAWN_PLAYER_CLEAR) continue;
        if (distance(x, y, boss.x, boss.y) < CFG.BOSS.TREE_SPAWN_BOSS_CLEAR) continue;
        if (distance(x, y, exitX, exitY) < CFG.BOSS.TREE_SPAWN_EXIT_CLEAR) continue;

        let blocked = false;
        for (const tree of this.trees) {
          if (distance(x, y, tree.x, tree.y) < CFG.BOSS.TREE_SPAWN_TREE_CLEAR) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        return { x, y };
      }
      return null;
    }

    onBossTreeComplete(tree) {
      this.addShake(2.0, 0.12);
      this.spawnBurst(tree.x, tree.y - 30, 12, PALETTE.leafColors, 105, 0.5);

      // 如果玩家在无敌帧里刚好站在树的位置，生成完成时把玩家推出树干。
      const player = this.player;
      const body = tree.getBody();
      const playerRect = {
        x: player.x - player.halfW,
        y: player.y - player.halfH,
        w: player.halfW * 2,
        h: player.halfH * 2
      };
      if (aabbOverlap(playerRect, body)) {
        const dirX = player.x < tree.x ? -1 : 1;
        const dirY = player.y < tree.y ? -1 : 1;
        moveBody(
          this,
          player,
          dirX * 34,
          dirY * 18,
          player.halfW,
          player.halfH
        );
      }

      // 预警期间 Boss 可能走进生成点，完成时把它推出树干，避免卡住。
      if (this.boss && this.boss.state === 'active') {
        if (aabbOverlap(this.boss.getContactBody(), body)) {
          const dirX = this.boss.x < tree.x ? -1 : 1;
          const dirY = this.boss.y < tree.y ? -1 : 1;
          moveBody(
            this,
            this.boss,
            dirX * 46,
            dirY * 24,
            this.boss.contactHalf,
            this.boss.contactHalf
          );
        }
      }
    }

    onBossDefeated() {
      if (this.state !== 'playing') return;

      // 第八层为总层数最终层；第七层结算后继续前往神明之巅。
      this.pendingFinalClear = this.currentLevelId >= 8;

      // 停止战斗并清空预警树/怪物，保留 Boss 房初始掩体树。
      this.state = 'levelClear';
      this.blizzardActive = false;
      this.blizzardTimer = 0;
      PF.Input.mouse.down = false;
      this.orbs.reset();
      this.activeChasers.clear();
      this.enemies.length = 0;
      for (let i = this.trees.length - 1; i >= 0; i -= 1) {
        if (this.trees[i] instanceof BossTree) this.trees.splice(i, 1);
      }
      this.bossTrees = [];
      this.boss = null;
      this.bossRoomExitUnlocked = true;
      this.levelExitPortal = null;
      this.hud.bossHud.hidden = true;
      this.clearBossDamageFeedback();
      this.toast.hidden = true;
      this.toastTimer = 0;
      this.showLevelClearChoice();
      this.setGameState('REWARD', 'Boss 结算强化');
      this.updateHud(true);
    }

    updateBossCheckpoint() {
      if (this.scene !== 'boss' || !this.bossCheckpoint) return;
      const point = CFG.BOSS_CHECKPOINT;
      if (
        distance(this.player.x, this.player.y, point.X, point.Y) <=
        point.TOUCH_RADIUS
      ) {
        this.bossCheckpoint.levelId = this.currentLevelId;
        if (!this.bossCheckpoint.touched) {
          this.bossCheckpoint.touched = true;
          this.showToast('存档点已激活 · Boss 房内死亡将从入口复活', 2.2);
          this.spawnBurst(
            point.X, point.Y - 26, 12,
            ['#a8d8d0', '#d8efe8', '#6f8f8a'],
            70, 0.55
          );
        }
      }
    }

    updateBossRoom(dt) {
      this.updateBossCheckpoint();

      if (this.bossDamagePopupTimer > 0) {
        this.bossDamagePopupTimer = Math.max(0, this.bossDamagePopupTimer - dt);
        if (this.bossDamagePopupTimer === 0 && this.hud.bossDamageText) {
          this.hud.bossDamageText.classList.remove('is-visible');
        }
      }

      if (!this.boss) return;

      const boss = this.boss;
      const bossXBefore = boss.x;
      boss.update(dt);
      // Boss 在 update 内死亡时 onBossDefeated 会立即把 this.boss 置空。
      // 必须先检查空引用，绝不能再用 this.boss.x，否则主循环会抛错停摆。
      if (!this.boss || this.state !== 'playing') return;
      const bossDx = boss.x - bossXBefore;
      if (Math.abs(bossDx) > 0.01) {
        boss.visualFacing = bossDx < 0 ? -1 : 1;
      }

      this.handleBossContact();
      if (this.state !== 'playing') return;

      this.handleBossWarningContact();
    }

    handleBossContact() {
      if (!this.boss || this.boss.state !== 'active' || this.boss.burrowed) return;
      if (this.boss.skillState === 'slamDive' ||
        this.boss.skillState === 'thrustOut') return;
      if (
        this.boss.type === 'snowmanChief' &&
        (this.boss.action === 'slamWarn' ||
          this.boss.action === 'slamJump' ||
          this.boss.action === 'slamStun')
      ) {
        return;
      }

      const player = this.player;
      if (player.rolling) return;
      const contact = this.boss.getContactBody();
      const playerRect = {
        x: player.x - player.halfW,
        y: player.y - player.halfH,
        w: player.halfW * 2,
        h: player.halfH * 2
      };
      if (!aabbOverlap(playerRect, contact)) return;

      if (this.boss.contactCooldown <= 0 && player.invuln <= 0) {
        const contactDamage = this.boss.contactDamage ?? CFG.BOSS.CONTACT_DAMAGE;
        player.takeDamage(contactDamage, this.boss.x, this.boss.y);
        this.boss.contactCooldown = CFG.BOSS.CONTACT_COOLDOWN;
        this.boss.contactRecoilTimer = CFG.BOSS.CONTACT_RECOIL_TIME;
        this.boss.moving = false;

        // 命中后轻微后退，给玩家留出脱离接触的空间。
        const dx = this.boss.x - player.x;
        const dy = this.boss.y - player.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.001) {
          moveBody(
            this,
            this.boss,
            (dx / len) * CFG.BOSS.CONTACT_RECOIL_DISTANCE,
            (dy / len) * CFG.BOSS.CONTACT_RECOIL_DISTANCE,
            this.boss.contactHalf,
            this.boss.contactHalf
          );
        }

        this.addShake(7, 0.28);
        if (this.state !== 'playing') return;
      }

      // 无敌期间把玩家轻轻推开，避免一直卡在 Boss 体内。
      if (player.invuln > 0) {
        const dx = player.x - this.boss.x;
        const dy = player.y - this.boss.y;
        const len = Math.hypot(dx, dy) || 1;
        moveBody(
          this,
          player,
          (dx / len) * 42,
          (dy / len) * 42,
          player.halfW,
          player.halfH
        );
      }
    }

    handleBossWarningContact() {
      if (!this.boss || this.boss.state !== 'active') return;
      const player = this.player;
      for (const tree of this.trees) {
        if (!(tree instanceof BossTree) || tree.state !== 'warning') continue;
        const reach = CFG.BOSS.TREE_WARN_RADIUS + player.halfW;
        if (distance(player.x, player.y, tree.x, tree.y) >= reach) continue;

        player.takeDamage(10, tree.x, tree.y);
        if (this.state !== 'playing') return;
      }
    }

    drawBossTreeWarning(ctx, tree) {
      const x = Math.round(tree.x);
      const y = Math.round(tree.y);
      const progress = clamp(1 - tree.warnTimer / tree.warnDuration, 0, 1);
      const pulse = 0.72 + Math.sin(this.time * 14) * 0.22;
      const count = 32;
      const radius = CFG.BOSS.TREE_WARN_RADIUS;

      // 像素化的红色危险地面填充
      for (let row = -radius; row <= radius; row += 6) {
        const rowWidth = Math.sqrt(Math.max(0, radius * radius - row * row));
        ctx.globalAlpha = 0.10 + (1 - Math.abs(row) / radius) * 0.10;
        ctx.fillStyle = PALETTE.bossWarning;
        ctx.fillRect(Math.round(x - rowWidth), y + row, Math.round(rowWidth * 2), 5);
      }
      ctx.globalAlpha = 1;

      // 地面红色危险圈 + 进度刻度
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        const px = Math.round(x + Math.cos(angle) * radius);
        const py = Math.round(y + Math.sin(angle) * radius);
        const lit = (i / count) <= progress;
        ctx.globalAlpha = lit ? pulse : 0.35;
        ctx.fillStyle = lit ? PALETTE.bossWarning : PALETTE.bossWarningDark;
        const size = lit ? 4 : 2;
        ctx.fillRect(px - Math.floor(size / 2), py - Math.floor(size / 2), size, size);
      }
      ctx.globalAlpha = 1;

      // 四个角的像素警示括号
      const bracket = 40;
      ctx.fillStyle = PALETTE.bossWarning;
      ctx.fillRect(x - bracket, y - bracket, 10, 2);
      ctx.fillRect(x - bracket, y - bracket, 2, 10);
      ctx.fillRect(x + bracket - 10, y - bracket, 10, 2);
      ctx.fillRect(x + bracket - 2, y - bracket, 2, 10);
      ctx.fillRect(x - bracket, y + bracket - 2, 10, 2);
      ctx.fillRect(x - bracket, y + bracket - 10, 2, 10);
      ctx.fillRect(x + bracket - 10, y + bracket - 2, 10, 2);
      ctx.fillRect(x + bracket - 2, y + bracket - 10, 2, 10);

      // 中心逐渐成形的暗红树影
      const grow = 0.25 + progress * 0.75;
      ctx.globalAlpha = 0.5 + progress * 0.35;
      ctx.fillStyle = PALETTE.bossWarningDark;
      ctx.fillRect(x - 3, y - 38 * grow, 6, 38 * grow);
      ctx.fillRect(x - 11, y - 39 * grow, 22, 9);
      ctx.fillRect(x - 7, y - 47 * grow, 14, 8);
      ctx.globalAlpha = 1;

      // 红色警示标记
      ctx.fillStyle = PALETTE.bossWarning;
      ctx.fillRect(x - 2, y - 62, 5, 10);
      ctx.fillRect(x - 2, y - 49, 5, 4);

      // 警告倒计时格
      const barW = 40;
      const barX = x - barW / 2;
      const barY = y + 30;
      ctx.fillStyle = '#1b0907';
      ctx.fillRect(barX - 2, barY - 2, barW + 4, 7);
      ctx.fillStyle = PALETTE.bossWarning;
      ctx.fillRect(barX, barY, Math.round(barW * (1 - progress)), 3);
    }

    drawBossTelegraphs(ctx) {
      if (this.scene !== 'boss' || !this.boss) return;
      const boss = this.boss;

      if (boss.type === 'sandworm') {
        if (boss.phase === 'warning' && boss.warnTarget) {
          const cfg = CFG.SANDWORM_BOSS;
          const t = clamp(boss.phaseTimer / Math.max(0.001, cfg.WARN_TIME), 0, 1);
          ctx.save();
          ctx.translate(boss.warnTarget.x, boss.warnTarget.y);
          ctx.fillStyle = `rgba(218, 44, 40, ${0.10 + t * 0.20})`;
          ctx.beginPath();
          ctx.arc(0, 0, cfg.WARN_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 83, 70, .95)';
          ctx.lineWidth = 4;
          ctx.setLineDash([16, 10]);
          ctx.lineDashOffset = -this.time * 38;
          ctx.beginPath();
          ctx.arc(0, 0, cfg.WARN_RADIUS, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = 'rgba(255, 139, 108, .45)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, cfg.WARN_RADIUS * 0.64, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 103, 80, .78)';
          ctx.fillRect(-2, -cfg.WARN_RADIUS, 4, cfg.WARN_RADIUS * 2);
          ctx.fillRect(-cfg.WARN_RADIUS, -2, cfg.WARN_RADIUS * 2, 4);
          ctx.restore();
        }
        return;
      }

      if (boss.type === 'snowmanChief') {
        const charging = boss.action === 'slamWarn';
        const jumping = boss.action === 'slamJump';
        if (charging || jumping) {
          const cfg = CFG.SNOWMAN_BOSS;
          const progress = charging
            ? clamp(boss.actionTimer / Math.max(0.001, cfg.SLAM_WARN_TIME), 0, 1)
            : 1;
          ctx.save();
          ctx.translate(Math.round(boss.slamTargetX), Math.round(boss.slamTargetY));
          ctx.fillStyle = `rgba(216, 48, 46, ${0.10 + progress * 0.18})`;
          ctx.beginPath();
          ctx.arc(0, 0, cfg.SLAM_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 87, 72, .95)';
          ctx.lineWidth = 3;
          ctx.setLineDash([13, 8]);
          ctx.lineDashOffset = -this.time * 30;
          ctx.beginPath();
          ctx.arc(0, 0, cfg.SLAM_RADIUS, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(255, 107, 82, .8)';
          ctx.fillRect(-2, -cfg.SLAM_RADIUS, 4, cfg.SLAM_RADIUS * 2);
          ctx.fillRect(-cfg.SLAM_RADIUS, -2, cfg.SLAM_RADIUS * 2, 4);
          ctx.restore();
        }

        if (boss.slamShockwave > 0) {
          const cfg = CFG.SNOWMAN_BOSS;
          const t = 1 - boss.slamShockwave / cfg.SLAM_SHOCKWAVE_TIME;
          const r = cfg.SLAM_RADIUS * (0.6 + t * 0.9);
          ctx.save();
          ctx.translate(Math.round(boss.slamTargetX), Math.round(boss.slamTargetY));
          ctx.globalAlpha = (1 - t) * 0.95;
          ctx.strokeStyle = '#eafaff';
          ctx.lineWidth = 5 - t * 2.5;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = (1 - t) * 0.55;
          ctx.strokeStyle = '#8fd0e8';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        return;
      }

      if (boss.type !== 'swampFrog') return;

      if (boss.action === 'tongueWindup') {
        const t = clamp(boss.actionTimer / Math.max(0.001, boss.actionDuration), 0, 1);
        ctx.save();
        ctx.translate(boss.x, boss.y);
        ctx.rotate(Math.atan2(boss.aimY, boss.aimX));
        ctx.fillStyle = `rgba(220, 40, 46, ${0.12 + t * 0.20})`;
        ctx.fillRect(0, -CFG.FROG_BOSS.TONGUE_WIDTH / 2,
          CFG.FROG_BOSS.TONGUE_LENGTH, CFG.FROG_BOSS.TONGUE_WIDTH);
        ctx.strokeStyle = 'rgba(255, 78, 70, .9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(0, -CFG.FROG_BOSS.TONGUE_WIDTH / 2,
          CFG.FROG_BOSS.TONGUE_LENGTH, CFG.FROG_BOSS.TONGUE_WIDTH);
        ctx.fillStyle = 'rgba(255, 220, 200, .65)';
        for (let d = 40; d < CFG.FROG_BOSS.TONGUE_LENGTH; d += 42) {
          ctx.fillRect(d, -2, 18, 4);
        }
        ctx.restore();
      }

      if (boss.action === 'slamWindup' && boss.slamTarget) {
        const t = clamp(boss.actionTimer / Math.max(0.001, boss.actionDuration), 0, 1);
        const r = CFG.FROG_BOSS.SLAM_RADIUS;
        ctx.save();
        ctx.translate(boss.slamTarget.x, boss.slamTarget.y);
        ctx.fillStyle = `rgba(221, 42, 48, ${0.10 + t * 0.16})`;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 83, 73, .95)';
        ctx.lineWidth = 3;
        ctx.setLineDash([14, 9]);
        ctx.lineDashOffset = -this.time * 35;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255, 96, 74, .75)';
        ctx.fillRect(-2, -r, 4, r * 2);
        ctx.fillRect(-r, -2, r * 2, 4);
        ctx.restore();
      }

      // 腾空时目标落点的阴影逐渐扩大。
      if (boss.action === 'slamJump' && boss.slamTarget) {
        const p = clamp(boss.jumpProgress, 0, 1);
        ctx.save();
        ctx.fillStyle = `rgba(5, 10, 5, ${0.16 + p * 0.24})`;
        ctx.beginPath();
        ctx.ellipse(boss.slamTarget.x, boss.slamTarget.y + 28,
          50 + p * 62, 18 + p * 22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(151, 226, 126, ${0.20 + p * 0.25})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(boss.slamTarget.x, boss.slamTarget.y + 28,
          44 + p * 58, 15 + p * 20, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 十字冲击波：只有上下左右四条矩形危险区，斜角完全留空。
      for (const wave of boss.crossShockwaves) {
        const fade = clamp(
          (CFG.FROG_BOSS.CROSSWAVE_DURATION - wave.age) / 0.12,
          0, 1
        );
        const rects = boss.getCrossWaveRects(wave);
        ctx.save();
        ctx.globalAlpha = fade;

        for (const rect of rects) {
          ctx.fillStyle = 'rgba(151, 103, 196, .58)';
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
          ctx.fillStyle = 'rgba(232, 220, 255, .86)';
          ctx.fillRect(rect.x + 4, rect.y + 4, rect.w - 8, rect.h - 8);
          ctx.fillStyle = 'rgba(255, 255, 255, .94)';
          ctx.fillRect(rect.x + 11, rect.y + 11, rect.w - 22, rect.h - 22);

          // 像素块节奏，保证一眼能看出四条安全斜缝。
          if (rect.w > rect.h) {
            for (let px = rect.x + 14; px < rect.x + rect.w - 12; px += 30) {
              ctx.fillStyle = 'rgba(210, 185, 246, .75)';
              ctx.fillRect(px, rect.y + 14, 10, rect.h - 28);
            }
          } else {
            for (let py = rect.y + 14; py < rect.y + rect.h - 12; py += 30) {
              ctx.fillStyle = 'rgba(210, 185, 246, .75)';
              ctx.fillRect(rect.x + 14, py, rect.w - 28, 10);
            }
          }
        }

        ctx.strokeStyle = 'rgba(249, 244, 255, .95)';
        ctx.lineWidth = 2;
        for (const rect of rects) {
          ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
        }
        ctx.restore();
      }
    }

    drawSwampFrog(ctx, boss) {
      const x = Math.round(boss.x);
      const y = Math.round(boss.y);
      const groundY = y;
      const drawY = y + boss.jumpOffset;
      const dying = boss.state === 'dying';
      const deathProgress = dying
        ? clamp(boss.deathTimer / CFG.FROG_BOSS.DEATH_TIME, 0, 1)
        : 0;
      const flash = boss.hitFlash > 0;
      const enraged = boss.enraged;
      const crouch = boss.action === 'slamWindup' ? 0.78 : 1;
      const squash = boss.action === 'slamRecover' ? 0.82 : 1;
      const bob = boss.moving && boss.action === 'idle'
        ? Math.round(Math.sin(boss.walkTime * 7) * 2)
        : 0;
      const bodyY = drawY + bob;

      // 地面投影
      ctx.save();
      const shadowScale = boss.jumpOffset < 0
        ? Math.max(0.35, 1 + boss.jumpOffset / 210)
        : 1;
      ctx.fillStyle = 'rgba(0,0,0,.38)';
      ctx.beginPath();
      ctx.ellipse(x, groundY + 36, 46 * shadowScale, 13 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(x, bodyY);
      if (dying) {
        ctx.globalAlpha = 1 - deathProgress * 0.75;
        ctx.scale(1 + deathProgress * 0.08, 1 - deathProgress * 0.38);
        ctx.translate(0, deathProgress * 18);
      }
      ctx.scale(1, crouch * squash);
      if (boss.action === 'slamJump') {
        const airScale = 1 + Math.sin(clamp(boss.jumpProgress, 0, 1) * Math.PI) * 0.24;
        ctx.scale(airScale, airScale);
      }

      const outline = '#1c2a19';
      const dark = flash ? '#f2f2f2' : (enraged ? '#4b5c28' : '#3f612f');
      const body = flash ? '#ffffff' : (enraged ? '#77913b' : '#5f8643');
      const light = flash ? '#ffffff' : (enraged ? '#c3d96c' : '#9fbf66');
      const belly = flash ? '#f4e8b0' : '#e8d58a';
      const poison = '#7b4a9c';
      const eye = flash ? '#f8ffe0' : (enraged ? '#ff6b5f' : '#f0ff9c');

      // 后腿
      ctx.fillStyle = outline;
      ctx.fillRect(-45, 20, 28, 20);
      ctx.fillRect(17, 20, 28, 20);
      ctx.fillRect(-53, 33, 18, 8);
      ctx.fillRect(35, 33, 18, 8);
      ctx.fillStyle = dark;
      ctx.fillRect(-40, 23, 20, 14);
      ctx.fillRect(20, 23, 20, 14);
      ctx.fillStyle = body;
      ctx.fillRect(-36, 24, 12, 10);
      ctx.fillRect(24, 24, 12, 10);

      // 阶梯状像素椭身体，纯方块堆叠。
      const bodyBands = [
        [-20, -31, 40, 6],
        [-30, -26, 60, 8],
        [-36, -18, 72, 12],
        [-39, -7, 78, 16],
        [-36, 9, 72, 11],
        [-30, 19, 60, 7]
      ];
      for (const band of bodyBands) {
        ctx.fillStyle = outline;
        ctx.fillRect(band[0], band[1], band[2], band[3]);
        ctx.fillStyle = dark;
        ctx.fillRect(band[0] + 2, band[1] + 1, band[2] - 4, band[3] - 1);
        ctx.fillStyle = body;
        ctx.fillRect(band[0] + 4, band[1] + 1, band[2] - 8, band[3] - 2);
      }
      ctx.fillStyle = light;
      ctx.fillRect(-27, -20, 16, 5);
      ctx.fillRect(-19, -24, 9, 3);
      ctx.fillStyle = '#c9b66d';
      const bellyBands = [
        [-11, 6, 22, 4],
        [-16, 10, 32, 6],
        [-11, 16, 22, 4]
      ];
      for (const band of bellyBands) {
        ctx.fillStyle = belly;
        ctx.fillRect(band[0], band[1], band[2], band[3]);
      }

      // 背部毒囊斑点：深紫像素块。
      ctx.fillStyle = poison;
      ctx.fillRect(-30, -13, 8, 5);
      ctx.fillRect(-24, -9, 5, 5);
      ctx.fillRect(22, -7, 7, 5);
      ctx.fillRect(27, -2, 5, 6);
      ctx.fillRect(-9, 3, 6, 4);
      ctx.fillRect(17, -21, 5, 4);

      // 眼睛
      if (enraged && !flash) {
        ctx.fillStyle = 'rgba(255, 62, 56, .18)';
        ctx.fillRect(-35, -39, 32, 29);
        ctx.fillRect(3, -39, 32, 29);
      }
      ctx.fillStyle = outline;
      ctx.fillRect(-30, -34, 22, 20);
      ctx.fillRect(8, -34, 22, 20);
      ctx.fillStyle = light;
      ctx.fillRect(-27, -31, 16, 14);
      ctx.fillRect(11, -31, 16, 14);
      ctx.fillStyle = eye;
      ctx.fillRect(-24, -28, 8, 8);
      ctx.fillRect(16, -28, 8, 8);
      ctx.fillStyle = '#14170e';
      ctx.fillRect(-21, -26, 4, 6);
      ctx.fillRect(19, -26, 4, 6);

      // 大嘴
      ctx.fillStyle = outline;
      ctx.fillRect(-23, -7, 46, 9);
      ctx.fillStyle = '#2b1718';
      ctx.fillRect(-19, -4, 38, 6);
      ctx.fillStyle = '#d18a83';
      ctx.fillRect(-14, -1, 28, 2);

      // 宽幅长舌与紫绿色毒液拖尾
      if (boss.action === 'tongueOut') {
        const halfW = CFG.FROG_BOSS.TONGUE_WIDTH / 2;
        const len = CFG.FROG_BOSS.TONGUE_LENGTH;
        ctx.save();
        ctx.rotate(Math.atan2(boss.aimY, boss.aimX));

        ctx.fillStyle = 'rgba(125, 73, 166, .30)';
        ctx.fillRect(8, -halfW, len, halfW * 2);
        ctx.fillStyle = 'rgba(86, 196, 109, .20)';
        ctx.fillRect(8, -halfW + 8, len, halfW * 2 - 16);

        // 毒液拖尾：沿舌头两侧的流动液滴
        for (let d = 24; d < len; d += 34) {
          const wobble = Math.sin(this.time * 13 + d * 0.12);
          ctx.fillStyle = d % 68 === 0
            ? 'rgba(155, 100, 195, .62)'
            : 'rgba(113, 221, 123, .50)';
          ctx.fillRect(d, -halfW + 4 + wobble * 5, 21, 6);
          ctx.fillRect(d + 9, halfW - 10 - wobble * 4, 16, 5);
        }

        ctx.fillStyle = '#7d1d24';
        ctx.fillRect(8, -24, len, 48);
        ctx.fillStyle = '#e0464c';
        ctx.fillRect(8, -17, len, 34);
        ctx.fillStyle = '#ff9b8f';
        ctx.fillRect(8, -7, len - 12, 12);
        ctx.fillStyle = '#8f2830';
        ctx.fillRect(len - 8, -halfW + 4, 18, halfW * 2 - 8);
        ctx.restore();
      }

      // 狂暴 / 蓄力 / 收招状态光
      if (enraged) {
        ctx.strokeStyle = `rgba(226, 76, 72, ${0.3 + Math.sin(this.time * 7) * 0.12})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(-40, -38, 80, 72);
      }
      if (boss.action === 'slamWindup') {
        ctx.fillStyle = 'rgba(227, 65, 66, .32)';
        ctx.fillRect(-34, -28, 68, 8);
      }

      ctx.restore();
    }

    drawEvilMage(ctx, boss) {
      const x = Math.round(boss.x);
      const y = Math.round(boss.y);
      const flash = boss.hitFlash > 0;
      const dying = boss.state === 'dying';
      const progress = dying
        ? clamp(boss.deathTimer / CFG.EVIL_MAGE_BOSS.DEATH_TIME, 0, 1)
        : 0;
      const bob = Math.sin(boss.walkTime * 2.8) * 3;

      // 传送时只留下两团黑雾，不绘制本体。
      if (boss.skillState === 'teleport') {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#120b18';
        ctx.beginPath();
        ctx.arc(boss.teleportFromX, boss.teleportFromY, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6b3e9b';
        ctx.beginPath();
        ctx.arc(boss.teleportFromX, boss.teleportFromY, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = '#b26cff';
        ctx.beginPath();
        ctx.arc(boss.teleportTargetX, boss.teleportTargetY, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      if (boss.skillState === 'teleportIn') {
        ctx.save();
        ctx.globalAlpha = 0.58;
        ctx.fillStyle = '#120b18';
        ctx.beginPath();
        ctx.arc(boss.x, boss.y, 40, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.42;
        ctx.fillStyle = '#6b3e9b';
        ctx.beginPath();
        ctx.arc(boss.x, boss.y, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.65;
        ctx.fillStyle = '#b26cff';
        ctx.beginPath();
        ctx.arc(boss.x, boss.y, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      // 死亡射线预警/光束先画在地面，再画本体。
      if (boss.skillState === 'rayWindup' || boss.skillState === 'rayActive') {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(boss.rayAngle);
        if (boss.skillState === 'rayWindup') {
          ctx.fillStyle = 'rgba(225, 30, 45, .18)';
          ctx.fillRect(0, -20, 400, 40);
          ctx.strokeStyle = 'rgba(255, 70, 70, .95)';
          ctx.lineWidth = 3;
          ctx.setLineDash([14, 8]);
          ctx.strokeRect(0, -20, 400, 40);
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = 'rgba(178, 108, 255, .52)';
          ctx.fillRect(0, -20, 400, 40);
          ctx.fillStyle = 'rgba(255, 255, 255, .65)';
          ctx.fillRect(0, -4, 400, 8);
        }
        ctx.restore();
      }

      ctx.fillStyle = 'rgba(0, 0, 0, .42)';
      ctx.beginPath();
      ctx.ellipse(x, y + 82, 54, 15, 0, 0, Math.PI * 2);
      ctx.fill();

      const art = bossArt.evilMage;
      const size = 200;
      const half = size / 2;
      ctx.save();
      if (dying) {
        ctx.globalAlpha = 1 - progress * 0.8;
        ctx.translate(0, progress * 26);
      }
      ctx.translate(x, y + bob);
      ctx.imageSmoothingEnabled = false;
      if (art && art.ready) {
        const sprite = flash && art.flash ? art.flash : art.source;
        ctx.drawImage(sprite, -half, -half, size, size);
      } else {
        // 加载极短空窗期的紫色占位。
        ctx.fillStyle = flash ? '#ffffff' : '#1d1028';
        ctx.fillRect(-36, -52, 72, 98);
        ctx.fillStyle = flash ? '#ffffff' : '#6b3e9b';
        ctx.fillRect(-24, -42, 48, 70);
        ctx.fillStyle = '#b26cff';
        ctx.fillRect(-12, -30, 24, 8);
      }

      if (boss.skillState === 'scatterCast') {
        const pulse = 0.20 + Math.abs(Math.sin(boss.walkTime * 28)) * 0.30;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#b26cff';
        ctx.beginPath();
        ctx.arc(0, -8, 92, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (boss.skillState === 'castOrb') {
        ctx.globalAlpha = 0.35 + Math.sin(boss.walkTime * 16) * 0.15;
        ctx.fillStyle = '#b26cff';
        ctx.beginPath();
        ctx.arc(58, -34, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (boss.hp <= CFG.EVIL_MAGE_BOSS.MAX_HP * 0.5 && !dying) {
        ctx.strokeStyle = 'rgba(178, 108, 255, .38)';
        ctx.lineWidth = 3;
        ctx.strokeRect(-half - 8, -half - 8, size + 16, size + 16);
      }
      ctx.restore();    }

    drawDeity(ctx, boss) {
      const x = Math.round(boss.x);
      const y = Math.round(boss.y);
      const flash = boss.hitFlash > 0;
      const dying = boss.state === 'dying';
      const progress = dying ? clamp(boss.deathTimer / 2, 0, 1) : 0;
      const pulse = 0.55 + Math.sin(boss.walkTime * 2.2) * 0.12;

      if (boss.skillState === 'transition') {
        ctx.save();
        const t = 1 - boss.skillTimer / 1.0;
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = '#ffe08a';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(x, y, 120 + t * 460, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.35 * (1 - t);
        ctx.fillStyle = '#ffd76b';
        ctx.beginPath();
        ctx.arc(x, y, 120 + t * 360, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (boss.timeStopActive && boss.timeStopChainTimer > 0) {
        ctx.save();
        ctx.fillStyle = `rgba(225, 35, 45, ${0.20 + Math.abs(Math.sin(boss.walkTime * 9)) * 0.12})`;
        ctx.strokeStyle = 'rgba(255, 80, 70, .95)';
        ctx.lineWidth = 4;
        ctx.fillRect(boss.chainTarget.x - 140, boss.chainTarget.y - 24, 280, 48);
        ctx.fillRect(boss.chainTarget.x - 24, boss.chainTarget.y - 140, 48, 280);
        ctx.strokeRect(boss.chainTarget.x - 140, boss.chainTarget.y - 24, 280, 48);
        ctx.strokeRect(boss.chainTarget.x - 24, boss.chainTarget.y - 140, 48, 280);
        ctx.restore();
      }

      if (boss.skillState === 'swordWarn' || boss.skillState === 'swordStrike') {
        ctx.save();
        if (boss.safeCorner) {
          ctx.fillStyle = 'rgba(225, 255, 238, .26)';
          ctx.strokeStyle = 'rgba(235, 255, 245, .9)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(boss.safeCorner.x, boss.safeCorner.y, 58, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        for (const circle of boss.swordCircles) {
          if (boss.skillState === 'swordWarn') {
            ctx.fillStyle = `rgba(225, 35, 45, ${0.18 + Math.abs(Math.sin(boss.walkTime * 8)) * 0.10})`;
            ctx.strokeStyle = 'rgba(255, 80, 70, .88)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          } else {
            ctx.fillStyle = 'rgba(255, 246, 190, .34)';
            ctx.fillRect(circle.x - 18, 0, 36, circle.y);
            ctx.fillStyle = 'rgba(255, 255, 255, .8)';
            ctx.fillRect(circle.x - 5, 0, 10, circle.y);
            ctx.fillStyle = 'rgba(255, 239, 160, .55)';
            ctx.beginPath();
            ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      if (boss.ultimateTriggered && boss.skillState === 'ultimate') {
        ctx.save();
        ctx.globalAlpha = 0.22 + Math.abs(Math.sin(boss.walkTime * 8)) * 0.12;
        ctx.strokeStyle = '#ffe08a';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(x, y, 142, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (boss.skillState === 'thrustOut') {
        ctx.save();
        ctx.globalAlpha = 0.55 + Math.abs(Math.sin(boss.walkTime * 18)) * 0.3;
        ctx.fillStyle = '#fffbea';
        ctx.beginPath();
        ctx.arc(x, y, 105, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(x, y, 68, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (boss.skillState === 'wailSummon' ||
        boss.skillState === 'wailWarn' ||
        boss.skillState === 'wailStrike') {
        ctx.save();
        ctx.globalAlpha = boss.skillState === 'wailStrike' ? 0.55 : 0.72;
        const phantomColor = boss.wailType === 'frog' ? '#79d6a1' : '#d8b078';
        ctx.fillStyle = phantomColor;
        ctx.beginPath();
        ctx.ellipse(boss.wailPhantom.x, boss.wailPhantom.y, 58, 68, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(20, 16, 8, .55)';
        ctx.beginPath();
        ctx.arc(boss.wailPhantom.x - 18, boss.wailPhantom.y - 18, 6, 0, Math.PI * 2);
        ctx.arc(boss.wailPhantom.x + 18, boss.wailPhantom.y - 18, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (boss.wailType === 'frog') {
          ctx.save();
          ctx.fillStyle = boss.skillState === 'wailStrike'
            ? 'rgba(255, 248, 190, .48)'
            : `rgba(225, 35, 45, ${0.18 + Math.abs(Math.sin(boss.walkTime * 8)) * 0.12})`;
          ctx.fillRect(CFG.WORLD.W / 2 - 82, 0, 164, CFG.WORLD.H);
          ctx.fillRect(0, CFG.WORLD.H / 2 - 82, CFG.WORLD.W, 164);
          ctx.restore();
        } else {
          for (const circle of boss.wailCircles) {
            ctx.save();
            ctx.fillStyle = boss.skillState === 'wailStrike'
              ? 'rgba(255, 248, 190, .45)'
              : 'rgba(225, 35, 45, .22)';
            ctx.strokeStyle = 'rgba(255, 75, 65, .9)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      if (boss.skillState === 'stripWarn' || boss.skillState === 'stripHit') {
        const px = boss.game.player.x;
        const py = boss.game.player.y;
        ctx.save();
        ctx.fillStyle = 'rgba(225, 35, 45, .9)';
        ctx.beginPath();
        ctx.moveTo(px, py - 74);
        ctx.lineTo(px + 9, py - 56);
        ctx.lineTo(px, py - 40);
        ctx.lineTo(px - 9, py - 56);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(225, 35, 45, .8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py - 38);
        ctx.lineTo(px, py - 12);
        ctx.stroke();
        ctx.restore();
      }

      if (boss.skillState === 'voidCast' || boss.skillState === 'voidActive') {
        ctx.save();
        const cx = boss.voidCenter.x;
        const cy = boss.voidCenter.y;
        const t = boss.walkTime;
        ctx.fillStyle = 'rgba(12, 5, 22, .52)';
        ctx.beginPath();
        ctx.arc(cx, cy, 150, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 4; i += 1) {
          ctx.strokeStyle = `rgba(128, 63, 190, ${0.42 - i * 0.08})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(cx, cy, 46 + i * 28, t * (1.4 + i * 0.2), t * (1.4 + i * 0.2) + Math.PI * 1.5);
          ctx.stroke();
        }
        ctx.fillStyle = '#07030d';
        ctx.beginPath();
        ctx.arc(cx, cy, 28 + Math.sin(t * 5) * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        for (const meteor of boss.voidMeteors) {
          ctx.save();
          const impact = meteor.impact > 0;
          ctx.fillStyle = impact ? 'rgba(255, 248, 190, .48)' : 'rgba(225, 35, 45, .22)';
          ctx.strokeStyle = impact ? 'rgba(255, 250, 210, .95)' : 'rgba(255, 80, 70, .92)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(meteor.x, meteor.y, meteor.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (!impact) {
            ctx.fillStyle = 'rgba(255, 80, 70, .9)';
            ctx.fillRect(meteor.x - 2, meteor.y - meteor.radius, 4, meteor.radius * 2);
            ctx.fillRect(meteor.x - meteor.radius, meteor.y - 2, meteor.radius * 2, 4);
            const fall = clamp(1 - meteor.timer / 1.1, 0, 1);
            const fy = -30 + (meteor.y + 30) * fall;
            ctx.fillStyle = 'rgba(255, 190, 90, .38)';
            ctx.fillRect(meteor.x - 5, Math.max(0, fy - 90), 10, 90);
            ctx.fillStyle = '#fff0b0';
            ctx.beginPath();
            ctx.arc(meteor.x, fy, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffb04a';
            ctx.beginPath();
            ctx.arc(meteor.x, fy, 5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }

      if (boss.skillState === 'chainWarn' || boss.skillState === 'chainStrike') {
        const strike = boss.skillState === 'chainStrike';
        ctx.save();
        ctx.fillStyle = strike
          ? 'rgba(255, 226, 130, .42)'
          : `rgba(225, 35, 45, ${0.24 + Math.abs(Math.sin(boss.walkTime * 10)) * 0.12})`;
        ctx.fillRect(boss.chainTarget.x - 140, boss.chainTarget.y - 24, 280, 48);
        ctx.fillRect(boss.chainTarget.x - 24, boss.chainTarget.y - 140, 48, 280);
        ctx.strokeStyle = strike
          ? 'rgba(255, 250, 210, .95)'
          : 'rgba(255, 75, 65, .95)';
        ctx.lineWidth = 4;
        ctx.strokeRect(boss.chainTarget.x - 140, boss.chainTarget.y - 24, 280, 48);
        ctx.strokeRect(boss.chainTarget.x - 24, boss.chainTarget.y - 140, 48, 280);
        ctx.restore();
      }

      if (boss.skillState === 'wrathWarn' || boss.skillState === 'wrathStrike') {
        const strike = boss.skillState === 'wrathStrike';
        ctx.save();
        if (!strike) {
          ctx.fillStyle = `rgba(225, 35, 45, ${0.18 + Math.abs(Math.sin(boss.walkTime * 9)) * 0.14})`;
          ctx.strokeStyle = 'rgba(255, 80, 70, .95)';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(boss.wrathTarget.x, boss.wrathTarget.y, 108, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([14, 10]);
          ctx.beginPath();
          ctx.arc(boss.wrathTarget.x, boss.wrathTarget.y, 70, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = 'rgba(255, 238, 165, .72)';
          ctx.fillRect(boss.wrathTarget.x - 28, 0, 56, boss.wrathTarget.y);
          ctx.strokeStyle = '#fff8dc';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(boss.wrathTarget.x + 4, 0);
          ctx.lineTo(boss.wrathTarget.x - 16, boss.wrathTarget.y * 0.35);
          ctx.lineTo(boss.wrathTarget.x + 12, boss.wrathTarget.y * 0.65);
          ctx.lineTo(boss.wrathTarget.x - 6, boss.wrathTarget.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(boss.wrathTarget.x, boss.wrathTarget.y, 108, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (boss.skillState === 'barrageWindup') {
        ctx.save();
        ctx.globalAlpha = 0.22 + Math.abs(Math.sin(boss.walkTime * 16)) * 0.2;
        ctx.fillStyle = '#ffe08a';
        ctx.beginPath();
        ctx.arc(x, y, 130, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      const lift = boss.skillState === 'wrathWarn'
        ? -52
        : (boss.skillState === 'swordWarn'
          ? -92
          : (boss.skillState === 'swordStrike' ? -46 : 0));
      const bob = Math.sin(boss.walkTime * 1.7) * 5;
      ctx.translate(x, y + lift + bob);
      if (dying) {
        ctx.globalAlpha = 1 - progress * 0.85;
        ctx.translate(0, progress * 30);
      }

      // 狂暴/终焉阶段的金红神光。
      if (boss.rageMode || boss.skillState === 'ultimate') {
        const glow = boss.skillState === 'ultimate' ? 0.32 : 0.18;
        ctx.save();
        ctx.globalAlpha = glow + Math.abs(Math.sin(boss.walkTime * 5)) * 0.08;
        ctx.fillStyle = boss.skillState === 'ultimate' ? '#ffe08a' : '#c53a26';
        ctx.beginPath();
        ctx.arc(0, 0, boss.skillState === 'ultimate' ? 165 : 148, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = boss.skillState === 'ultimate' ? '#fff6cf' : '#e7bf58';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, boss.skillState === 'ultimate' ? 142 : 128, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.imageSmoothingEnabled = false;
      const art = bossArt.deity;
      const size = 240;
      if (art && art.ready) {
        const sprite = flash && art.flash ? art.flash : art.source;
        // 正面图，不水平翻转；视觉240×240，Hitbox仍为160×160。
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      } else {
        ctx.fillStyle = flash ? '#ffffff' : '#d8b04e';
        ctx.fillRect(-110, -110, 220, 220);
      }
      ctx.restore();

      ctx.save();
      ctx.fillStyle = 'rgba(30, 20, 8, .22)';
      ctx.beginPath();
      ctx.ellipse(x, y + 112, 78, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      for (const orb of boss.holyOrbs || []) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, orb.life);
        ctx.fillStyle = 'rgba(255, 221, 118, .24)';
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius + 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b78d2c';
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff4c2';
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      for (const wave of boss.phantomWaves || []) {
        ctx.save();
        ctx.translate(wave.x, wave.y);
        ctx.rotate(wave.angle);
        ctx.fillStyle = 'rgba(255, 255, 255, .92)';
        ctx.fillRect(-wave.width / 2, -wave.height / 2, wave.width, wave.height);
        ctx.fillStyle = 'rgba(255, 238, 170, .75)';
        ctx.fillRect(-wave.width / 2, -3, wave.width, 6);
        ctx.restore();
      }
    }

    drawAbyssWave(ctx, wave, time) {
      const horizontal = wave.dir === 'right' || wave.dir === 'left';
      const sign = wave.dir === 'right' || wave.dir === 'down' ? 1 : -1;
      const amp = 5;
      const phase = time * 3.2 + (wave.x + wave.y) * 0.015;
      ctx.save();

      if (horizontal) {
        const front = wave.dir === 'right'
          ? wave.x + wave.width / 2
          : wave.x - wave.width / 2;
        const back = wave.dir === 'right'
          ? wave.x - wave.width / 2
          : wave.x + wave.width / 2;
        const top = wave.y - wave.height / 2;
        const bottom = wave.y + wave.height / 2;

        ctx.beginPath();
        let first = true;
        for (let y = top; y <= bottom; y += 4) {
          const px = front + Math.sin(y * 0.23 + phase) * amp;
          if (first) { ctx.moveTo(px, y); first = false; }
          else ctx.lineTo(px, y);
        }
        for (let y = bottom; y >= top; y -= 4) {
          const px = back + Math.sin(y * 0.15 + phase + 1.7) * amp * 0.55;
          ctx.lineTo(px, y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(22, 92, 145, .58)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(235, 252, 255, .92)';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.beginPath();
        first = true;
        for (let y = top + 3; y <= bottom - 3; y += 4) {
          const px = front + Math.sin(y * 0.23 + phase) * amp;
          if (first) { ctx.moveTo(px, y); first = false; }
          else ctx.lineTo(px, y);
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, .65)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        for (let i = 0; i < 14; i += 1) {
          const behind = Math.random() * wave.width * 0.85;
          const px = front - sign * behind + (Math.random() - 0.5) * 8;
          const py = top + Math.random() * wave.height;
          const size = 1 + Math.random() * 3;
          ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + Math.random() * 0.5})`;
          ctx.fillRect(Math.round(px), Math.round(py), size, size);
        }
      } else {
        const front = wave.dir === 'down'
          ? wave.y + wave.height / 2
          : wave.y - wave.height / 2;
        const back = wave.dir === 'down'
          ? wave.y - wave.height / 2
          : wave.y + wave.height / 2;
        const left = wave.x - wave.width / 2;
        const right = wave.x + wave.width / 2;

        ctx.beginPath();
        let first = true;
        for (let x = left; x <= right; x += 4) {
          const py = front + Math.sin(x * 0.23 + phase) * amp;
          if (first) { ctx.moveTo(x, py); first = false; }
          else ctx.lineTo(x, py);
        }
        for (let x = right; x >= left; x -= 4) {
          const py = back + Math.sin(x * 0.15 + phase + 1.7) * amp * 0.55;
          ctx.lineTo(x, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(22, 92, 145, .58)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(235, 252, 255, .92)';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.beginPath();
        first = true;
        for (let x = left + 3; x <= right - 3; x += 4) {
          const py = front + Math.sin(x * 0.23 + phase) * amp;
          if (first) { ctx.moveTo(x, py); first = false; }
          else ctx.lineTo(x, py);
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, .65)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        for (let i = 0; i < 14; i += 1) {
          const behind = Math.random() * wave.height * 0.85;
          const px = left + Math.random() * wave.width;
          const py = front - sign * behind + (Math.random() - 0.5) * 8;
          const size = 1 + Math.random() * 3;
          ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + Math.random() * 0.5})`;
          ctx.fillRect(Math.round(px), Math.round(py), size, size);
        }
      }
      ctx.restore();
    }

    drawAbyssWhale(ctx, boss) {
      const x = Math.round(boss.x);
      const y = Math.round(boss.y);
      const flash = boss.hitFlash > 0;
      const dying = boss.state === 'dying';
      const progress = dying
        ? clamp(boss.deathTimer / CFG.ABYSS_WHALE.DEATH_TIME, 0, 1)
        : 0;
      const cfg = CFG.ABYSS_WHALE;

      if (boss.skillState === 'slamDive') {
        const pulse = 0.18 + Math.abs(Math.sin(boss.walkTime * 10)) * 0.16;
        ctx.save();
        ctx.fillStyle = `rgba(220, 35, 40, ${pulse})`;
        ctx.strokeStyle = 'rgba(255, 80, 70, .95)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(boss.slamTargetX, boss.slamTargetY, cfg.SLAM_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([14, 10]);
        ctx.beginPath();
        ctx.arc(boss.slamTargetX, boss.slamTargetY,
          cfg.SLAM_RADIUS * 0.62, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        return;
      }

      if (boss.skillState === 'columnWindup') {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(boss.columnAngle);
        const pulse = 0.12 + Math.abs(Math.sin(boss.walkTime * 9)) * 0.12;
        ctx.fillStyle = `rgba(230, 30, 35, ${pulse})`;
        ctx.fillRect(0, -cfg.COLUMN_WIDTH / 2, cfg.COLUMN_LENGTH, cfg.COLUMN_WIDTH);
        ctx.strokeStyle = 'rgba(255, 80, 70, .95)';
        ctx.lineWidth = 3;
        ctx.setLineDash([16, 10]);
        ctx.strokeRect(0, -cfg.COLUMN_WIDTH / 2, cfg.COLUMN_LENGTH, cfg.COLUMN_WIDTH);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255, 245, 220, .55)';
        ctx.fillRect(0, -2, cfg.COLUMN_LENGTH, 4);
        ctx.restore();
      }

      if (boss.skillState === 'column') {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(boss.columnAngle);
        ctx.fillStyle = 'rgba(70, 185, 225, .30)';
        ctx.fillRect(0, -cfg.COLUMN_WIDTH / 2, cfg.COLUMN_LENGTH, cfg.COLUMN_WIDTH);
        ctx.fillStyle = 'rgba(150, 235, 255, .38)';
        ctx.fillRect(0, -cfg.COLUMN_WIDTH / 2 + 10, cfg.COLUMN_LENGTH, 8);
        ctx.fillRect(0, cfg.COLUMN_WIDTH / 2 - 18, cfg.COLUMN_LENGTH, 8);
        ctx.fillStyle = 'rgba(235, 253, 255, .70)';
        ctx.fillRect(0, -3, cfg.COLUMN_LENGTH, 6);
        ctx.restore();
      }

      if (boss.skillState === 'waves') {
        for (const wave of boss.waves) {
          const horizontal = wave.dir === 'right' || wave.dir === 'left';
          if (!wave.active) {
            ctx.fillStyle = 'rgba(225, 35, 45, .22)';
            ctx.strokeStyle = 'rgba(255, 75, 75, .9)';
            ctx.lineWidth = 3;
            if (horizontal) {
              ctx.fillRect(0, wave.y - wave.height / 2, CFG.WORLD.W, wave.height);
              ctx.strokeRect(0, wave.y - wave.height / 2, CFG.WORLD.W, wave.height);
            } else {
              ctx.fillRect(wave.x - wave.width / 2, 0, wave.width, CFG.WORLD.H);
              ctx.strokeRect(wave.x - wave.width / 2, 0, wave.width, CFG.WORLD.H);
            }
            continue;
          }
          this.drawAbyssWave(ctx, wave, boss.walkTime);
        }
      }

      if (boss.skillState === 'gravity') {
        ctx.save();
        ctx.translate(x, y);
        for (let i = 0; i < 4; i += 1) {
          ctx.strokeStyle = `rgba(130, 225, 245, ${0.28 - i * 0.05})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, 190 + i * 65 + Math.sin(boss.walkTime * 3 + i) * 8,
            0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, .42)';
      ctx.beginPath();
      ctx.ellipse(x, y + 108, 92, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y + Math.sin(boss.walkTime * 1.6) * 3);
      if (dying) {
        ctx.globalAlpha = 1 - progress * 0.86;
        ctx.translate(0, progress * 42);
      }
      ctx.imageSmoothingEnabled = false;
      const art = bossArt.abyssWhale;
      const size = 250;
      if (art && art.ready) {
        const sprite = flash && art.flash ? art.flash : art.source;
        // 正面图，永远不水平翻转；视觉250×250，Hitbox仍为中心140×140。
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      } else {
        ctx.fillStyle = flash ? '#ffffff' : '#1d607f';
        ctx.beginPath();
        ctx.ellipse(0, 0, 118, 66, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (boss.skillState === 'slamStun') {
        ctx.save();
        ctx.strokeStyle = 'rgba(190, 245, 255, .55)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, y, cfg.SLAM_RADIUS *
          (0.7 + Math.sin(boss.walkTime * 10) * 0.06), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      for (const orb of boss.slamOrbs || []) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, orb.life);
        ctx.fillStyle = 'rgba(80, 190, 230, .28)';
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius + 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1d607f';
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9fe8f8';
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    drawLavaDragon(ctx, boss) {
      const cfg = CFG.LAVA_DRAGON;
      const x = Math.round(boss.x);
      const y = Math.round(boss.y);
      const flash = boss.hitFlash > 0;
      const dying = boss.state === 'dying';
      const progress = dying
        ? clamp(boss.deathTimer / cfg.DEATH_TIME, 0, 1)
        : 0;
      const breathe = boss.skillState === 'breathActive';
      const windup = boss.skillState === 'breathWindup';
      const tailWarn = boss.skillState === 'tailWindup';
      const infernoWarn = boss.skillState === 'infernoWarning';
      const infernoBlast = boss.skillState === 'infernoBlast';
      const tailSpin = boss.tailSpinTimer > 0
        ? 1 - boss.tailSpinTimer / cfg.TAIL_SPIN_TIME
        : 0;
      const slam = boss.infernoSlamTimer > 0
        ? 1 - boss.infernoSlamTimer / cfg.INFERNO_SLAM_TIME
        : 0;

      let bob = 0;
      let offsetY = 0;
      let scale = 1;
      let rotation = 0;
      let shakeX = 0;
      let shadowScale = 1;
      let shadowAlpha = 0.46;

      const idle = !windup && !breathe && !tailWarn &&
        !infernoWarn && !infernoBlast &&
        boss.tailSpinTimer <= 0 && boss.infernoSlamTimer <= 0;
      if (idle) bob = Math.sin(boss.walkTime * 2.2) * cfg.BREATH_AMPLITUDE;

      if (windup) {
        // 吐息预警：身体后仰并轻微放大。
        const t = 1 - clamp(boss.skillTimer / cfg.BREATH_WINDUP, 0, 1);
        offsetY = -15 * t;
        scale = 1 + 0.06 * t;
      } else if (breathe) {
        // 正式喷火：猛烈前倾。
        offsetY = 10;
        scale = 1.02;
      } else if (tailWarn) {
        // 甩尾预警：蓄力下压 + 快速左右抖动。
        shakeX = Math.round(Math.sin(boss.walkTime * 62) * 7);
        offsetY = 6;
        scale = 1.01;
      } else if (tailSpin > 0) {
        // 甩尾释放：整张图快速旋转一圈。
        rotation = Math.PI * 2 * tailSpin;
        scale = 1 + Math.sin(tailSpin * Math.PI) * 0.05;
      } else if (infernoWarn) {
        // 炼狱天降预警：飞向高空并缩小。
        const t = 1 - clamp(boss.skillTimer / cfg.INFERNO_WARNING, 0, 1);
        const eased = t * t * (3 - 2 * t);
        offsetY = -100 * eased;
        scale = 1 - 0.28 * eased;
        shadowScale = 1.8;
        shadowAlpha = 0.55;
      } else if (infernoBlast) {
        // 火雨落完前保持高空。
        offsetY = -100;
        scale = 0.72;
        shadowScale = 1.8;
        shadowAlpha = 0.55;
      }

      if (slam > 0) {
        // 火雨结束：从高空猛砸回地面，带轻微回弹放大。
        const eased = 1 - Math.pow(1 - slam, 3);
        offsetY = -100 * (1 - eased);
        scale = 0.72 + 0.28 * eased;
        shadowScale = 1.8 - 0.8 * eased;
        shadowAlpha = 0.55 - 0.09 * eased;
      }

      const bodyY = y + bob + offsetY;
      const bodyX = x + shakeX;
      const mouthX = bodyX;
      const mouthY = bodyY + cfg.MOUTH_OFFSET_Y * scale;

      // 地面预警：扇形吐息、甩尾圆、天降红圈。
      if (windup || breathe) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(mouthX, mouthY);
        ctx.arc(
          mouthX, mouthY, cfg.BREATH_RANGE,
          boss.breathAngle - cfg.BREATH_HALF_ANGLE,
          boss.breathAngle + cfg.BREATH_HALF_ANGLE
        );
        ctx.closePath();
        ctx.fillStyle = breathe
          ? 'rgba(255, 78, 24, .24)'
          : 'rgba(255, 34, 24, .17)';
        ctx.fill();
        ctx.strokeStyle = breathe
          ? 'rgba(255, 200, 80, .75)'
          : 'rgba(255, 60, 36, .85)';
        ctx.lineWidth = breathe ? 3 : 3;
        ctx.stroke();
        ctx.restore();
      }

      if (tailWarn) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, cfg.TAIL_RANGE, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 42, 22, .14)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 76, 38, .9)';
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 7]);
        ctx.stroke();
        ctx.restore();
      }

      if (infernoWarn) {
        for (const warning of boss.rainWarnings) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(warning.x, warning.y, warning.radius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(220, 32, 16, .18)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 82, 40, .9)';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(
            warning.x, warning.y, warning.radius * 0.58,
            0, Math.PI * 2
          );
          ctx.strokeStyle = 'rgba(255, 194, 90, .55)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      }

      // 接地阴影：升空时放大变淡，砸回时恢复。
      ctx.save();
      ctx.globalAlpha = shadowAlpha;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.ellipse(
        x, y + 82,
        82 * shadowScale, 18 * shadowScale,
        0, 0, Math.PI * 2
      );
      ctx.fill();
      ctx.restore();

      ctx.save();
      if (dying) {
        ctx.globalAlpha = 1 - progress * 0.75;
        ctx.translate(0, progress * 34);
      }
      ctx.translate(bodyX, bodyY);
      ctx.scale(scale, scale);
      if (rotation !== 0) ctx.rotate(rotation);

      const size = cfg.RENDER_SIZE;
      const half = size / 2;
      ctx.imageSmoothingEnabled = false;
      if (dragonSprite.ready) {
        const sprite = flash && dragonSprite.flash
          ? dragonSprite.flash
          : dragonSprite.image;
        ctx.drawImage(sprite, -half, -half, size, size);
      } else {
        // 图片加载极短的空窗期使用熔岩色块占位。
        ctx.fillStyle = '#1b0a0a';
        ctx.fillRect(-61, -61, 122, 122);
        ctx.fillStyle = '#421b17';
        ctx.fillRect(-52, -52, 104, 104);
        ctx.fillStyle = '#ff5a22';
        ctx.fillRect(-26, -20, 52, 9);
      }

      if (boss.hp <= cfg.MAX_HP * cfg.INFERNO_THRESHOLD && !dying) {
        ctx.strokeStyle = 'rgba(255, 94, 38, .38)';
        ctx.lineWidth = 4;
        ctx.strokeRect(-half - 8, -half - 8, size + 16, size + 16);
      }
      ctx.restore();

      // 喷火粒子必须在图片之后绘制，覆盖整个吐息灼烧判定窗口。
      if (breathe) this.drawDragonFlames(ctx, boss, mouthX, mouthY);
    }

    drawDragonFlames(ctx, boss, originX, originY) {
      const cfg = CFG.LAVA_DRAGON;
      const base = boss.breathAngle;
      const halfAngle = cfg.BREATH_HALF_ANGLE;
      const colors = ['#ff4f1f', '#ff6a28', '#ff9a3c', '#ffcf63', '#fff0b0'];

      ctx.save();
      // 火焰整体辉光，仍由Canvas代码绘制。
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.arc(
        originX, originY, cfg.BREATH_RANGE,
        base - halfAngle, base + halfAngle
      );
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 74, 20, .12)';
      ctx.fill();

      for (let i = 0; i < 110; i += 1) {
        const angle = base + (Math.random() * 2 - 1) * halfAngle * 0.96;
        const dist = 20 + Math.random() * (cfg.BREATH_RANGE - 20);
        const spread = (Math.random() * 2 - 1) * (12 + dist * 0.055);
        const px = originX + Math.cos(angle) * dist +
          Math.cos(base + Math.PI / 2) * spread;
        const py = originY + Math.sin(angle) * dist +
          Math.sin(base + Math.PI / 2) * spread;
        const block = 4 + Math.floor(Math.random() * 8) +
          (dist > 240 ? 2 : 0);
        ctx.globalAlpha = 0.28 + Math.random() * 0.58;
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.fillRect(
          Math.round(px - block / 2),
          Math.round(py - block / 2),
          block, block
        );
      }

      // 龙嘴附近的高亮火舌。
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < 12; i += 1) {
        const angle = base + (Math.random() * 2 - 1) * 0.28;
        const dist = 6 + Math.random() * 58;
        const px = originX + Math.cos(angle) * dist;
        const py = originY + Math.sin(angle) * dist;
        ctx.fillStyle = i % 3 === 0 ? '#fff0b0' : '#ffb347';
        ctx.fillRect(Math.round(px) - 2, Math.round(py) - 2, 5, 5);
      }
      ctx.restore();
    }

    drawSnowmanChief(ctx, boss) {
      const x = Math.round(boss.x);
      const y = Math.round(boss.y);
      const flash = boss.hitFlash > 0;
      const round = flame => (flash ? '#ffffff' : flame);
      const cfg = CFG.SNOWMAN_BOSS;
      const bob = boss.action === 'slamStun'
        ? Math.sin(this.time * 20) * 2
        : Math.sin(this.time * 3) * 1;
      const charging = boss.action === 'slamWarn';
      const jumping = boss.action === 'slamJump';
      const jumpScale = jumping ? cfg.SLAM_JUMP_SCALE : 1;
      const jumpOffset = boss.jumpOffsetY || 0;
      const crouch = charging ? 8 : 0;
      const shadowScale = 1 - Math.min(0.35, jumpOffset / 260);
      const dying = boss.state === 'dying';
      const progress = dying
        ? clamp(boss.deathTimer / CFG.SNOWMAN_BOSS.DEATH_TIME, 0, 1)
        : 0;

      ctx.save();
      ctx.translate(x, y + bob);
      if (dying) {
        ctx.globalAlpha = 1 - progress * 0.75;
        ctx.translate(0, progress * 20);
      }

      ctx.fillStyle = 'rgba(24, 48, 63, .34)';
      ctx.beginPath();
      ctx.ellipse(
        0, 42,
        48 * shadowScale, 14 * shadowScale,
        0, 0, Math.PI * 2
      );
      ctx.fill();

      ctx.save();
      ctx.translate(0, crouch - jumpOffset);
      ctx.scale(jumpScale, jumpScale);

      // 树枝手
      ctx.fillStyle = flash ? '#ffffff' : '#6d523b';
      ctx.fillRect(-62, -12, 26, 5);
      ctx.fillRect(-52, -30, 5, 22);
      ctx.fillRect(-58, 4, 5, 15);
      ctx.fillRect(36, -12, 26, 5);
      ctx.fillRect(47, -30, 5, 22);
      ctx.fillRect(53, 4, 5, 15);

      // 三层阶梯像素雪球 + 深色粗描边。
      for (const part of [
        { y: 25, rx: 45, ry: 29 },
        { y: -5, rx: 37, ry: 29 },
        { y: -47, rx: 28, ry: 27 }
      ]) {
        this.drawPixelEllipse(
          ctx, 0, part.y, part.rx, part.ry,
          round('#c4dce8'), '#24343d', 3
        );
        ctx.fillStyle = round('#effaff');
        ctx.fillRect(
          -Math.round(part.rx * 0.62),
          part.y - Math.round(part.ry * 0.55),
          Math.round(part.rx * 0.55),
          Math.max(4, Math.round(part.ry * 0.25))
        );
        ctx.fillRect(
          -Math.round(part.rx * 0.45),
          part.y - Math.round(part.ry * 0.25),
          Math.round(part.rx * 0.30),
          3
        );
      }
      ctx.fillStyle = round('#a7c2d1');
      ctx.fillRect(-32, 40, 64, 4);
      ctx.fillRect(-24, 44, 48, 3);

      // 蓝色发光眼、胡萝卜鼻（全部像素方块）。
      ctx.fillStyle = 'rgba(90, 200, 255, .22)';
      ctx.fillRect(-20, -53, 16, 14);
      ctx.fillRect(4, -53, 16, 14);
      ctx.fillStyle = flash ? '#ffffff' : '#8fe6ff';
      ctx.fillRect(-12, -48, 6, 7);
      ctx.fillRect(8, -48, 6, 7);
      ctx.fillStyle = '#e0fbff';
      ctx.fillRect(-10, -46, 2, 2);
      ctx.fillRect(10, -46, 2, 2);
      ctx.fillStyle = flash ? '#ffffff' : '#e69a40';
      ctx.fillRect(15, -41, 24, 6);
      ctx.fillStyle = '#fff0c4';
      ctx.fillRect(32, -41, 7, 2);

      // 破旧王冠
      ctx.fillStyle = flash ? '#ffffff' : '#54452c';
      ctx.fillRect(-22, -68, 44, 10);
      ctx.fillStyle = flash ? '#ffffff' : '#9b7d43';
      ctx.fillRect(-18, -66, 36, 5);
      ctx.fillRect(-20, -76, 8, 9);
      ctx.fillRect(-4, -80, 8, 13);
      ctx.fillRect(12, -76, 8, 9);
      ctx.fillStyle = flash ? '#ffffff' : '#c7a85c';
      ctx.fillRect(-17, -74, 4, 5);
      ctx.fillRect(-1, -77, 4, 7);
      ctx.fillRect(14, -74, 4, 5);
      ctx.fillStyle = '#6e5b33';
      ctx.fillRect(-22, -60, 44, 3);

      if (boss.enraged) {
        ctx.strokeStyle = `rgba(137, 215, 242, ${0.3 + Math.sin(this.time * 7) * 0.12})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(-58, -82, 116, 132);
      }

      if (charging) {
        ctx.globalAlpha = 0.45 + Math.sin(this.time * 24) * 0.22;
        ctx.strokeStyle = '#ff5a4b';
        ctx.lineWidth = 4;
        ctx.strokeRect(-60, -86, 120, 138);
        ctx.fillStyle = 'rgba(255, 76, 62, .16)';
        ctx.fillRect(-56, -82, 112, 130);
        ctx.globalAlpha = 1;
      }

      if (boss.action === 'slamStun') {
        ctx.fillStyle = '#e9f7ff';
        for (let i = 0; i < 4; i += 1) {
          const angle = this.time * 4 + (i / 4) * Math.PI * 2;
          ctx.fillRect(
            Math.round(Math.cos(angle) * 36),
            Math.round(-66 + Math.sin(angle) * 13),
            3, 3
          );
        }
      }

      ctx.restore();
      ctx.restore();
    }

    drawSandworm(ctx, boss) {
      const x = Math.round(boss.x);
      const y = Math.round(boss.y);
      const flash = boss.hitFlash > 0;
      const dying = boss.state === 'dying';
      const progress = dying
        ? clamp(boss.deathTimer / CFG.SANDWORM_BOSS.DEATH_TIME, 0, 1)
        : 0;

      if (boss.burrowed) {
        const pulse = 1 + Math.sin(this.time * 5) * 0.12;
        ctx.save();
        this.drawPixelEllipse(
          ctx, x, y + 18, 43 * pulse, 16 * pulse,
          'rgba(39, 24, 12, .32)', '#3e2715', 2
        );
        this.drawPixelEllipse(
          ctx, x, y + 12, 28, 11,
          '#7a4d28', '#4b2f1a', 2
        );
        ctx.fillStyle = '#b2813e';
        ctx.fillRect(x - 18, y + 9, 36, 5);
        ctx.fillStyle = '#4b2f1a';
        ctx.fillRect(x - 4, y + 4, 8, 6);
        ctx.fillRect(x - 2, y - 4, 5, 8);
        ctx.fillRect(x, y - 13, 3, 9);
        ctx.fillStyle = '#8c6536';
        ctx.fillRect(x + 1, y - 7, 3, 12);
        ctx.fillStyle = '#d8b268';
        ctx.fillRect(x - 13, y + 4, 3, 2);
        ctx.fillRect(x + 12, y + 7, 3, 2);
        ctx.restore();
        return;
      }

      ctx.save();
      const groundShake = boss.phase === 'exposed'
        ? Math.sin(this.time * 16) * 0.7
        : 0;
      ctx.translate(x + groundShake, y);

      if (dying) {
        ctx.globalAlpha = 1 - progress * 0.82;
        ctx.translate(0, progress * 25);
        ctx.scale(1 + progress * 0.10, 1 - progress * 0.35);
      }

      const outline = '#2d1b10';
      const dark = flash ? '#f0f0f0' : '#5c3b23';
      const body = flash ? '#ffffff' : '#a97a40';
      const light = flash ? '#ffffff' : '#d2a765';
      const maw = flash ? '#ffffff' : '#3a1414';
      const tooth = flash ? '#ffffff' : '#f0d89c';

      // 地面破口与影子
      ctx.fillStyle = 'rgba(37, 22, 11, .45)';
      ctx.beginPath();
      ctx.ellipse(0, 30, 58, 19, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3e2715';
      ctx.beginPath();
      ctx.ellipse(0, 25, 43, 13, 0, 0, Math.PI * 2);
      ctx.fill();

      // 土黄色分节圆环身体。
      const segments = [
        { y: 18, rx: 43, ry: 18 },
        { y: -10, rx: 40, ry: 20 },
        { y: -42, rx: 36, ry: 21 },
        { y: -73, rx: 32, ry: 21 }
      ];
      for (const seg of segments) {
        this.drawPixelEllipse(
          ctx, 0, seg.y + 2, seg.rx, seg.ry,
          dark, outline, 3
        );
        this.drawPixelEllipse(
          ctx, 0, seg.y - 2, seg.rx - 7, seg.ry - 5,
          body, body, 2
        );
        ctx.fillStyle = light;
        ctx.fillRect(
          -Math.round(seg.rx * 0.62), seg.y - 7,
          Math.round(seg.rx * 0.42), 4
        );
        ctx.fillStyle = '#6b4728';
        ctx.fillRect(-seg.rx + 8, seg.y + 5, seg.rx * 2 - 16, 3);
      }

      // 头部圆环。
      this.drawPixelEllipse(ctx, 0, -105, 30, 26, dark, outline, 3);
      this.drawPixelEllipse(ctx, 0, -107, 23, 18, body, body, 2);
      ctx.fillStyle = light;
      ctx.fillRect(-16, -115, 14, 5);
      ctx.fillRect(-10, -118, 8, 3);

      // 阶梯状背刺。
      ctx.fillStyle = flash ? '#ffffff' : '#d8b268';
      for (let i = 0; i < 4; i += 1) {
        const bx = -28 + i * 15;
        const by = -55 - i * 14;
        ctx.fillRect(bx, by, 6, 4);
        ctx.fillRect(bx + 2, by - 4, 4, 4);
        ctx.fillRect(bx + 4, by - 8, 2, 4);
      }

      // 巨口与锯齿牙，全部为矩形块。
      const mouthOpen = boss.phase === 'sandstorm' ? 1 : 0.55;
      ctx.fillStyle = outline;
      ctx.fillRect(-20, -108, 40, 18);
      ctx.fillStyle = maw;
      ctx.fillRect(-16, -104, 32, Math.round(12 * mouthOpen));
      ctx.fillStyle = tooth;
      for (let i = 0; i < 5; i += 1) {
        const tx = -16 + i * 8;
        ctx.fillRect(tx, -108, 4, 6);
        ctx.fillRect(tx + 4, -105, 4, 3);
        ctx.fillRect(tx, -95, 4, 5);
        ctx.fillRect(tx + 4, -92, 4, 3);
      }
      ctx.fillStyle = '#ff8b70';
      ctx.fillRect(-7, -99, 14, 3);

      // 眼
      ctx.fillStyle = boss.enraged ? '#ff625b' : '#ffe07a';
      ctx.fillRect(-14, -116, 8, 6);
      ctx.fillRect(6, -116, 8, 6);
      ctx.fillStyle = '#22120a';
      ctx.fillRect(-11, -115, 3, 4);
      ctx.fillRect(9, -115, 3, 4);

      if (boss.enraged) {
        ctx.strokeStyle = `rgba(255, 77, 65, ${0.3 + Math.sin(this.time * 8) * 0.12})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(-44, -123, 88, 158);
      }

      ctx.restore();
    }

    drawBossImage(ctx, boss, art) {
      const x = Math.round(boss.x);
      const y = Math.round(boss.y);
      const size = BOSS_RENDER_SIZE;
      const half = size / 2;
      const flash = boss.hitFlash > 0;
      const dying = boss.state === 'dying';
      const deathTime = CFG.BOSS.DEATH_TIME || 1;
      const progress = dying
        ? clamp((boss.deathTimer || 0) / deathTime, 0, 1)
        : 0;
      const jump = boss.type === 'snowmanChief'
        ? Math.max(0, boss.jumpOffsetY || 0)
        : 0;
      const sprite = flash && art.flash ? art.flash : art.source;

      // 贴图阴影与中心锚点分离，物理碰撞仍使用 Boss 原 contactHalf。
      ctx.fillStyle = 'rgba(0, 0, 0, .34)';
      ctx.beginPath();
      ctx.ellipse(x, y + half * 0.72, half * 0.55, half * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      if (dying) {
        ctx.globalAlpha = 1 - progress * 0.72;
        ctx.translate(0, progress * 24);
      }
      ctx.translate(x, y - jump);
      if (boss.visualFacing < 0) ctx.scale(-1, 1);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, -half, -half, size, size);

      // 保留雪人砸地腾空的视觉反馈。
      if (boss.type === 'snowmanChief' && jump > 0) {
        ctx.strokeStyle = 'rgba(214, 244, 255, .45)';
        ctx.lineWidth = 3;
        ctx.strokeRect(-half + 8, -half + 8, size - 16, size - 16);
      }
      ctx.restore();

      if (boss.type === 'swampFrog' && boss.action === 'tongueOut') {
        this.drawFrogTongueOverlay(ctx, boss);
      }
    }

    drawFrogTongueOverlay(ctx, boss) {
      const halfW = CFG.FROG_BOSS.TONGUE_WIDTH / 2;
      const len = CFG.FROG_BOSS.TONGUE_LENGTH;
      ctx.save();
      ctx.translate(Math.round(boss.x), Math.round(boss.y));
      ctx.rotate(Math.atan2(boss.aimY, boss.aimX));

      ctx.fillStyle = 'rgba(125, 73, 166, .30)';
      ctx.fillRect(8, -halfW, len, halfW * 2);
      ctx.fillStyle = 'rgba(86, 196, 109, .20)';
      ctx.fillRect(8, -halfW + 8, len, halfW * 2 - 16);

      for (let d = 24; d < len; d += 34) {
        const wobble = Math.sin(this.time * 13 + d * 0.12);
        ctx.fillStyle = d % 68 === 0
          ? 'rgba(155, 100, 195, .62)'
          : 'rgba(113, 221, 123, .50)';
        ctx.fillRect(d, -halfW + 4 + wobble * 5, 21, 6);
        ctx.fillRect(d + 9, halfW - 10 - wobble * 4, 16, 5);
      }

      ctx.fillStyle = '#7d1d24';
      ctx.fillRect(8, -24, len, 48);
      ctx.fillStyle = '#e0464c';
      ctx.fillRect(8, -17, len, 34);
      ctx.fillStyle = '#ff9b8f';
      ctx.fillRect(8, -7, len - 12, 12);
      ctx.fillStyle = '#8f2830';
      ctx.fillRect(len - 8, -halfW + 4, 18, halfW * 2 - 8);
      ctx.restore();
    }

    drawBoss(ctx, boss) {
      if (boss.type === 'evilMage') {
        this.drawEvilMage(ctx, boss);
        return;
      }
      if (boss.type === 'abyssWhale') {
        this.drawAbyssWhale(ctx, boss);
        return;
      }
      if (boss.type === 'deity') {
        this.drawDeity(ctx, boss);
        return;
      }
      if (boss.type === 'sandworm' && boss.burrowed) {
        this.drawSandworm(ctx, boss);
        return;
      }
      const art = bossArt[boss.type];
      if (art && art.ready) {
        this.drawBossImage(ctx, boss, art);
        return;
      }
      if (boss.type === 'lavaDragon') {
        this.drawLavaDragon(ctx, boss);
        return;
      }
      if (boss.type === 'snowmanChief') {
        this.drawSnowmanChief(ctx, boss);
        return;
      }
      if (boss.type === 'sandworm') {
        this.drawSandworm(ctx, boss);
        return;
      }
      if (boss.type === 'swampFrog') {
        this.drawSwampFrog(ctx, boss);
        return;
      }
      const x = Math.round(boss.x);
      const y = Math.round(boss.y);
      const dying = boss.state === 'dying';
      const deathProgress = dying ? clamp(boss.deathTimer / CFG.BOSS.DEATH_TIME, 0, 1) : 0;
      const stunned = boss.stunTimer > 0;
      const flash = boss.hitFlash > 0 ||
        (stunned && Math.floor(boss.stunTimer * 20) % 2 === 0);
      const bob = boss.moving && !dying ? (Math.sin(boss.walkTime * 6) > 0 ? 2 : 0) : 0;
      const sway = boss.moving && !dying ? Math.round(Math.sin(boss.walkTime * 6) * 2) : 0;
      const legSwing = boss.moving && !dying ? (Math.sin(boss.walkTime * 8) > 0 ? 3 : -3) : 0;

      // 即死碰撞的危险光圈（贴地，使用略小于视觉的判定尺寸）
      if (!dying && !stunned) {
        const dangerPulse = 0.10 + (Math.sin(this.time * 5) + 1) * 0.035;
        ctx.fillStyle = `rgba(218, 70, 51, ${dangerPulse})`;
        for (let i = 0; i < 20; i += 1) {
          const angle = (i / 20) * Math.PI * 2;
          const px = Math.round(x + Math.cos(angle) * (boss.contactHalf + 12));
          const py = Math.round(y + 24 + Math.sin(angle) * (boss.contactHalf * 0.52));
          ctx.fillRect(px - 2, py - 1, 4, 2);
        }
      }

      // 椭圆影子
      ctx.fillStyle = PALETTE.bossShadow;
      ctx.beginPath();
      ctx.ellipse(x, y + 42, 46, 12, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(x, y + bob);
      if (dying) {
        ctx.globalAlpha = 1 - deathProgress * 0.72;
        ctx.translate(0, deathProgress * 24);
        ctx.scale(1 + deathProgress * 0.08, 1 - deathProgress * 0.3);
      }

      const barkOutline = PALETTE.bossOutline;
      const barkDark = flash ? '#fff1d2' : PALETTE.bossBarkDark;
      const bark = flash ? '#fff7e6' : PALETTE.bossBark;
      const barkLight = flash ? '#ffffff' : PALETTE.bossBarkLight;
      const leafDark = flash ? '#dfe8b9' : PALETTE.bossLeafDark;
      const leaf = flash ? '#eef6c9' : PALETTE.bossLeaf;

      // 粗壮树根 / 双腿
      ctx.fillStyle = barkOutline;
      ctx.fillRect(-33 + legSwing, 18, 24, 24);
      ctx.fillRect(9 - legSwing, 18, 24, 24);
      ctx.fillRect(-44, 32, 22, 10);
      ctx.fillRect(22, 32, 22, 10);
      ctx.fillStyle = barkDark;
      ctx.fillRect(-30 + legSwing, 20, 18, 19);
      ctx.fillRect(12 - legSwing, 20, 18, 19);
      ctx.fillStyle = bark;
      ctx.fillRect(-27 + legSwing, 21, 11, 15);
      ctx.fillRect(16 - legSwing, 21, 11, 15);

      // 左右树枝手臂
      ctx.fillStyle = barkOutline;
      ctx.fillRect(-50, -11 + sway, 27, 13);
      ctx.fillRect(23, -11 - sway, 27, 13);
      ctx.fillRect(-54, -7 + sway, 9, 17);
      ctx.fillRect(45, -7 - sway, 9, 17);
      ctx.fillStyle = barkDark;
      ctx.fillRect(-47, -8 + sway, 21, 8);
      ctx.fillRect(26, -8 - sway, 21, 8);
      ctx.fillStyle = barkLight;
      ctx.fillRect(-45, -8 + sway, 11, 3);
      ctx.fillRect(34, -8 - sway, 11, 3);

      // 主树干 / 身体
      ctx.fillStyle = barkOutline;
      ctx.fillRect(-29, -30, 58, 60);
      ctx.fillRect(-23, -37, 46, 8);
      ctx.fillStyle = barkDark;
      ctx.fillRect(-25, -28, 50, 55);
      ctx.fillStyle = bark;
      ctx.fillRect(-21, -27, 42, 51);
      ctx.fillStyle = barkLight;
      ctx.fillRect(-17, -24, 11, 38);
      ctx.fillRect(7, -18, 8, 29);
      ctx.fillRect(-8, 8, 15, 7);
      ctx.fillStyle = barkOutline;
      ctx.fillRect(-13, 3, 5, 20);
      ctx.fillRect(8, 9, 4, 16);

      // 树冠 / 枯叶披风
      ctx.fillStyle = barkOutline;
      ctx.fillRect(-43, -54, 86, 20);
      ctx.fillRect(-34, -63, 68, 13);
      ctx.fillRect(-22, -69, 44, 9);
      ctx.fillStyle = leafDark;
      ctx.fillRect(-39, -51, 78, 16);
      ctx.fillRect(-30, -59, 60, 11);
      ctx.fillRect(-18, -64, 36, 8);
      ctx.fillStyle = leaf;
      ctx.fillRect(-33, -50, 25, 9);
      ctx.fillRect(-6, -58, 31, 8);
      ctx.fillRect(17, -52, 17, 10);
      ctx.fillStyle = PALETTE.bossLeafLight;
      ctx.fillRect(-29, -49, 13, 4);
      ctx.fillRect(-2, -56, 15, 4);
      ctx.fillRect(21, -50, 9, 4);
      ctx.fillStyle = leafDark;
      ctx.fillRect(-12, -45, 8, 5);
      ctx.fillRect(10, -46, 7, 4);
      ctx.fillRect(-27, -39, 6, 5);
      ctx.fillRect(27, -40, 5, 5);

      // 树叶层次：深色底叶 + 亮色叶簇。
      ctx.fillStyle = PALETTE.bossLeafDark;
      for (const leaf of [
        [-36, -56, 8, 7], [-24, -63, 9, 7], [-10, -68, 8, 8],
        [4, -66, 9, 7], [18, -61, 9, 7], [30, -54, 7, 6]
      ]) {
        ctx.fillRect(
          leaf[0] - Math.round(leaf[2] * 0.75),
          leaf[1] - Math.round(leaf[3] * 0.75),
          Math.round(leaf[2] * 1.5),
          Math.round(leaf[3] * 1.5)
        );
        ctx.fillRect(
          leaf[0] - Math.round(leaf[2] * 0.4),
          leaf[1] - Math.round(leaf[3] * 1.1),
          Math.round(leaf[2] * 0.8),
          Math.round(leaf[3] * 0.5)
        );
      }
      ctx.fillStyle = PALETTE.bossLeaf;
      for (const leaf of [
        [-34, -59, 5, 4], [-21, -66, 6, 4], [-7, -70, 5, 4],
        [7, -68, 5, 4], [20, -63, 5, 4], [30, -56, 4, 3]
      ]) {
        ctx.fillRect(
          leaf[0] - leaf[2] / 2, leaf[1] - leaf[3] / 2,
          leaf[2], leaf[3]
        );
        ctx.fillRect(
          leaf[0] - leaf[2] / 2 + 1, leaf[1] - leaf[3] / 2 - 1,
          Math.max(2, leaf[2] - 2), 2
        );
      }
      ctx.fillStyle = PALETTE.bossLeafLight;
      for (const leaf of [[-33, -61], [-20, -67], [-6, -71], [8, -69]]) {
        ctx.fillRect(leaf[0], leaf[1], 3, 2);
      }

      // 树皮纹理。
      ctx.fillStyle = PALETTE.bossBarkDark;
      ctx.fillRect(-12, 12, 3, 18);
      ctx.fillRect(8, 16, 3, 13);
      ctx.fillRect(-18, -20, 2, 9);

      // 面部：燃烧的双眼与树洞嘴
      ctx.fillStyle = '#1b0a06';
      ctx.fillRect(-16, -12, 13, 7);
      ctx.fillRect(4, -12, 13, 7);
      if (!dying) {
        const eyePulse = stunned ? 0.5 : 1;
        ctx.fillStyle = 'rgba(255, 73, 51, .18)';
        ctx.fillRect(-20, -16, 18, 14);
        ctx.fillRect(2, -16, 18, 14);
        ctx.fillStyle = stunned ? '#ffd16f' : PALETTE.bossEye;
        ctx.globalAlpha = eyePulse;
        ctx.fillRect(-13, -10, 6, 4);
        ctx.fillRect(8, -10, 6, 4);
        ctx.fillStyle = PALETTE.bossEyeGlow;
        ctx.fillRect(-12, -10, 2, 2);
        ctx.fillRect(9, -10, 2, 2);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = '#54291b';
        ctx.fillRect(-13, -9, 6, 1);
        ctx.fillRect(8, -9, 6, 1);
      }

      ctx.fillStyle = PALETTE.bossMouth;
      ctx.fillRect(-10, 7, 20, 8);
      ctx.fillStyle = barkOutline;
      ctx.fillRect(-7, 8, 4, 5);
      ctx.fillRect(-1, 8, 3, 5);
      ctx.fillRect(4, 8, 3, 5);

      // 肩部苔藓
      ctx.fillStyle = PALETTE.bossLeafDark;
      ctx.fillRect(-26, -25, 9, 5);
      ctx.fillRect(19, -22, 7, 4);

      ctx.restore();

      if (stunned) {
        ctx.fillStyle = '#ffe57b';
        ctx.fillRect(x - 1, y - 80, 3, 8);
        ctx.fillRect(x - 1, y - 69, 3, 3);
      }
    }
  }

  Object.assign(PF, {
    BossTree, Boss, SwampFrogBoss, SandwormBoss, SnowmanChiefBoss,
    LavaDragonBoss, EvilMageBoss, AbyssWhaleBoss, DeityBoss, BossSystems
  });
})(window);
