/* ============================================================
 * entities.js — 玩家、法球、树木、普通小怪、精英怪
 * 依赖 config.js 与 utils.js。
 * ============================================================ */
(function (global) {
  'use strict';
  const PF = global.PF;
  const { CFG, PALETTE } = PF;
  const {
    clamp, distance, randomRange, moveBody, isCircleBlocked, pointInRect, ObjectPool
  } = PF;

  /** 法球对象池：玩家法球与敌方法球共用。 */
  class OrbPool extends ObjectPool {
    constructor(size) {
      super(size, () => ({
        active: false,
        x: 0, y: 0,
        dirX: 1, dirY: 0,
        radius: CFG.ORB.RADIUS,
        speed: CFG.ORB.SPEED,
        damage: 1,
        treeDamage: 1,
        team: 'player',
        cold: 0,
        fire: false,
        pierce: 0,
        hitEnemies: [],
        sizeMultiplier: 1,
        visualScale: 1,
        weaponTrail: false,
        age: 0
      }));
      this.orbs = this.items;
    }

    /**
     * 生成一颗法球。
     * treeDamage 单独配置，确保敌方法球对玩家造成 4 点伤害、对树只造成 1 点。
     */
    spawn(
      x, y, dirX, dirY, team, damage,
      speed = CFG.ORB.SPEED,
      treeDamage = 1,
      radius = CFG.ORB.RADIUS,
      cold = 0
    ) {
      const orb = this.acquire();
      orb.active = true;
      orb.x = x;
      orb.y = y;
      orb.dirX = dirX;
      orb.dirY = dirY;
      orb.radius = radius;
      orb.speed = speed;
      orb.damage = damage;
      orb.treeDamage = treeDamage;
      orb.team = team;
      orb.cold = cold;
      orb.fire = false;
      orb.pierce = 0;
      orb.hitEnemies.length = 0;
      orb.sizeMultiplier = 1;
      // 敌我视觉尺寸彻底分离：敌方只按自身基础半径渲染，绝不继承玩家尺寸。
      orb.visualScale = team === 'enemy'
        ? clamp(radius / CFG.ENEMY_ORB.RADIUS, 0.8, 1.35)
        : 1;
      orb.weaponTrail = false;
      orb.age = 0;
      return orb;
    }
  }


  class Player {
    constructor(game) {
      this.game = game;
      this.x = CFG.PLAYER.SPAWN_X;
      this.y = CFG.PLAYER.SPAWN_Y;
      this.halfW = CFG.PLAYER.W / 2;
      this.halfH = CFG.PLAYER.H / 2;
      const upgrades = game.playerUpgrades || {};
      this.playerBuild = game.playerBuild || window.playerBuild || null;
      this.maxHp = CFG.PLAYER.MAX_HP + (upgrades.maxHpBonus || 0);
      this.hp = this.maxHp;
      this.orbDamage = CFG.PLAYER.ATK + (upgrades.orbDamageBonus || 0);
      this.invuln = 0;
      this.shootCd = 0;
      this.knockX = 0;
      this.knockY = 0;
      this.aimAngle = 0;
      this.facing = 1;
      this.direction = 'down';
      this.walkTime = 0;
      this.moving = false;
      this.muzzleTimer = 0;
      this.hurtFlash = 0;
      this.burnTimer = 0;
      this.burnDps = 0;
      this.burnTickTimer = 0;
      this.tongueSlowTimer = 0;
      this.tongueSlowMultiplier = 1;
      this.inkBlindTimer = 0;
      this.silenceTimer = 0;
      this.rootTimer = 0;
      this.rollCooldown = 0;
      this.rollTimer = 0;
      this.rolling = false;
      this.rollDirX = 0;
      this.rollDirY = 1;
      this.rollGhostTimer = 0;
      this.rollRequested = false;
      this.rollKeyWasDown = false;
      const shadowLevel = game.divine ? game.divine.shadowLevel : 0;
      this.rollMaxCharges = shadowLevel > 0 ? 2 : 1;
      this.rollCharges = this.rollMaxCharges;
      this.rollChargeTimer = 0;
      this.rollHitEnemies = [];
      this.potionCharges = CFG.POTION.CHARGES;
      this.shootInterval = upgrades.shootInterval || CFG.PLAYER.SHOOT_CD;
      this.orbPierce = Math.max(0, upgrades.orbPierce || 0);
      this.potionHeal = CFG.POTION.HEAL + (upgrades.potionHealBonus || 0);
      this.frostShieldEnabled = Boolean(upgrades.frostShield);
      this.frostShieldTimer = this.frostShieldEnabled ? 10 : 0;
      this.frostShieldReady = false;
      this.weaponType = upgrades.weaponType || 'single';
      this.shotgunCount = Math.max(
        1, upgrades.shotgunCount || CFG.WEAPON.COUNT
      );
      this.shotgunSpread = (
        upgrades.shotgunSpreadDeg || CFG.WEAPON.SPREAD_DEG
      ) * Math.PI / 180;
      this.weaponPelletDamage = upgrades.weaponPelletDamage ||
        CFG.WEAPON.PELLET_DAMAGE;
      this.weaponSizeMultiplier = upgrades.weaponSizeMultiplier || 1;
      this.weaponTrail = Boolean(upgrades.weaponTrail);
      this.cold = 0;
      this.coldDamageTimer = 0;
      this.isWarming = false;
    }

    tryBlockFrostShield() {
      if (!this.frostShieldEnabled || !this.frostShieldReady) return false;
      this.frostShieldReady = false;
      this.frostShieldTimer = 10;
      this.game.spawnBurst(
        this.x, this.y - 8, 18,
        ['#c8f2ff', '#8fd7f2', '#ffffff'],
        95, 0.6
      );
      this.game.showToast('冰霜护盾抵挡一次伤害', 1.2);
      return true;
    }

    addCold(amount) {
      const max = this.game.currentLevel &&
        this.game.currentLevel.mechanics &&
        this.game.currentLevel.mechanics.cold
        ? this.game.currentLevel.mechanics.cold.max
        : 100;
      this.cold = Math.max(0, Math.min(max, (this.cold || 0) + amount));
      return this.cold;
    }

    takeColdDamage(amount) {
      if (this.game.godMode) return false;
      if (this.game.state !== 'playing' || this.hp <= 0) return false;
      if (this.tryBlockFrostShield()) return false;
      this.hp = Math.max(0, this.hp - amount);
      this.hurtFlash = 0.18;
      this.game.addShake(1.4, 0.08);
      this.game.spawnBurst(
        this.x, this.y - 8, 5,
        ['#b9e4f4', '#7fb6d2', '#e8f8ff'],
        42, 0.35
      );
      if (this.hp <= 0) this.game.onPlayerDeath();
      return true;
    }

    usePotion() {
      if (
        this.game.state !== 'playing' ||
        window.currentGameState !== 'PLAYING' ||
        this.hp <= 0 ||
        this.potionCharges <= 0 ||
        this.hp >= this.maxHp
      ) {
        return false;
      }

      this.hp = Math.min(this.maxHp, this.hp + this.potionHeal);
      this.potionCharges = Math.max(0, this.potionCharges - 1);
      this.game.spawnBurst(
        this.x, this.y - 10, 14,
        ['#d76860', '#e89a8f', '#9fd08a', '#e8d9a6'],
        90, 0.5
      );
      this.game.addShake(1.4, 0.08);
      this.game.showToast(`药水回复 ${this.potionHeal} HP`, 1.1);
      return true;
    }

    requestRoll() {
      this.rollRequested = true;
    }

    tryRoll() {
      if (
        this.game.state !== 'playing' ||
        window.currentGameState !== 'PLAYING' ||
        this.dead ||
        this.rollCharges <= 0 ||
        this.rollTimer > 0 ||
        this.rootTimer > 0 ||
        this.silenceTimer > 0 ||
        this.hp <= 0
      ) {
        return false;
      }

      let dx = 0;
      let dy = 0;
      if (PF.Input.down('KeyA') || PF.Input.down('ArrowLeft')) dx -= 1;
      if (PF.Input.down('KeyD') || PF.Input.down('ArrowRight')) dx += 1;
      if (PF.Input.down('KeyW') || PF.Input.down('ArrowUp')) dy -= 1;
      if (PF.Input.down('KeyS') || PF.Input.down('ArrowDown')) dy += 1;

      // 没有移动输入时，朝当前面朝/鼠标方向翻滚，绝不保留 (0,0)。
      if (Math.hypot(dx, dy) < 0.001) {
        dx = Math.cos(this.aimAngle);
        dy = Math.sin(this.aimAngle);
      }
      let len = Math.hypot(dx, dy);
      if (!Number.isFinite(len) || len < 0.001) {
        dx = 1;
        dy = 0;
        len = 1;
      }
      this.rollDirX = dx / len;
      this.rollDirY = dy / len;
      this.rollTimer = CFG.ROLL.DURATION;
      this.rollCooldown = CFG.ROLL.COOLDOWN;
      this.rollCharges = Math.max(0, this.rollCharges - 1);
      this.rollChargeTimer = CFG.ROLL.COOLDOWN;
      this.rollHitEnemies = [];
      this.rolling = true;
      this.rollGhostTimer = 0;
      this.invuln = Math.max(this.invuln, CFG.ROLL.IFRAME);
      this.game.spawnRollGhost(this);
      this.game.addShake(1.2, 0.07);
      console.log(
        `Roll triggered! Direction: ${this.rollDirX.toFixed(2)}, ${this.rollDirY.toFixed(2)}`
      );
      return true;
    }

    applyRollDamage() {
      if (!this.game.divine || this.game.divine.shadowLevel < 2) return;
      const reach = this.halfW + 13;
      for (const enemy of this.game.enemies) {
        if (enemy.dead || enemy.burrowed) continue;
        if (this.rollHitEnemies.includes(enemy)) continue;
        if (
          distance(this.x, this.y, enemy.x, enemy.y) <
          reach + enemy.radius
        ) {
          this.rollHitEnemies.push(enemy);
          enemy.takeDamage(10, this.x, this.y);
        }
      }
      const boss = this.game.boss;
      if (
        boss &&
        boss.state === 'active' &&
        !boss.burrowed &&
        !this.rollHitEnemies.includes(boss) &&
        distance(this.x, this.y, boss.x, boss.y) <
          reach + boss.contactHalf
      ) {
        this.rollHitEnemies.push(boss);
        boss.takeDamage(10, this.x, this.y, 'orb');
      }
    }

    applyTongueSlow(duration, multiplier) {
      this.tongueSlowTimer = Math.max(this.tongueSlowTimer, duration);
      this.tongueSlowMultiplier = Math.min(
        this.tongueSlowTimer > 0 ? this.tongueSlowMultiplier : 1,
        multiplier
      );
    }

    applyBurn(duration, dps) {
      this.burnTimer = Math.max(this.burnTimer, duration);
      this.burnDps = Math.max(this.burnDps, dps);
      if (this.burnTickTimer <= 0) this.burnTickTimer = 1;
    }

    takeBurnDamage(amount) {
      if (this.game.godMode || this.game.state !== 'playing' || this.hp <= 0) {
        return false;
      }
      this.hp = Math.max(0, this.hp - amount);
      this.hurtFlash = Math.max(this.hurtFlash, 0.12);
      this.game.spawnBurst(
        this.x, this.y - 5, 4,
        ['#ff6a28', '#ffb347', '#8a2a10'], 55, 0.35
      );
      if (this.hp <= 0) this.game.onPlayerDeath();
      return true;
    }

    update(dt) {
      this.invuln = Math.max(0, this.invuln - dt);
      this.shootCd = Math.max(0, this.shootCd - dt);
      this.muzzleTimer = Math.max(0, this.muzzleTimer - dt);
      this.hurtFlash = Math.max(0, this.hurtFlash - dt);
      this.inkBlindTimer = Math.max(0, this.inkBlindTimer - dt);
      this.silenceTimer = Math.max(0, this.silenceTimer - dt);
      if (this.burnTimer > 0 && this.game.state === 'playing') {
        this.burnTimer = Math.max(0, this.burnTimer - dt);
        this.burnTickTimer -= dt;
        if (this.burnTickTimer <= 0) {
          this.burnTickTimer = 1;
          this.takeBurnDamage(this.burnDps);
        }
        if (this.burnTimer === 0) {
          this.burnDps = 0;
          this.burnTickTimer = 0;
        }
      }
      this.tongueSlowTimer = Math.max(0, this.tongueSlowTimer - dt);
      this.rootTimer = Math.max(0, this.rootTimer - dt);
      this.rollCooldown = Math.max(0, this.rollCooldown - dt);
      if (this.rollCharges < this.rollMaxCharges) {
        this.rollChargeTimer = Math.max(0, this.rollChargeTimer - dt);
        if (this.rollChargeTimer === 0) {
          this.rollCharges = Math.min(this.rollMaxCharges, this.rollCharges + 1);
          if (this.rollCharges < this.rollMaxCharges) {
            this.rollChargeTimer = CFG.ROLL.COOLDOWN;
          }
        }
      }
      if (this.tongueSlowTimer === 0) this.tongueSlowMultiplier = 1;

      if (this.frostShieldEnabled && !this.frostShieldReady) {
        this.frostShieldTimer = Math.max(0, this.frostShieldTimer - dt);
        if (this.frostShieldTimer === 0) this.frostShieldReady = true;
      }

      // 瞄准：始终跟随最近一次有效的鼠标世界坐标
      this.aimAngle = Math.atan2(
        PF.Input.mouse.y - this.y,
        PF.Input.mouse.x - this.x
      );

      // 翻滚请求在物理步进中消费；keydown 只负责登记，不直接位移。
      const rollKeyDown =
        PF.Input.down('ShiftLeft') || PF.Input.down('ShiftRight') ||
        PF.Input.down('Shift') || PF.Input.down('Space');
      if (rollKeyDown && !this.rollKeyWasDown) this.rollRequested = true;
      this.rollKeyWasDown = rollKeyDown;
      if (this.rollRequested) {
        this.rollRequested = false;
        this.tryRoll();
      }

      // 翻滚：固定方向高速位移，期间跳过普通移动。
      if (this.rollTimer > 0) {
        const rollSpeed = CFG.ROLL.DISTANCE / CFG.ROLL.DURATION;
        moveBody(
          this.game,
          this,
          this.rollDirX * rollSpeed * dt,
          this.rollDirY * rollSpeed * dt,
          this.halfW,
          this.halfH
        );
        this.rollGhostTimer -= dt;
        if (this.rollGhostTimer <= 0) {
          this.rollGhostTimer = CFG.ROLL.GHOST_INTERVAL;
          this.game.spawnRollGhost(this);
        }
        this.applyRollDamage();
        this.rollTimer = Math.max(0, this.rollTimer - dt);
        if (this.rollTimer === 0) {
          this.rolling = false;
          if (this.game.divine && this.game.divine.shadowLevel >= 3) {
            this.game.spawnRollTrap(this.x, this.y);
          }
        }
        this.moving = true;
        this.walkTime += dt;
        if (PF.Input.mouse.down) this.tryShoot();
        return;
      }

      this.rolling = false;

      // WASD 输入
      let ix = 0;
      let iy = 0;
      if (PF.Input.down('KeyA') || PF.Input.down('ArrowLeft')) ix -= 1;
      if (PF.Input.down('KeyD') || PF.Input.down('ArrowRight')) ix += 1;
      if (PF.Input.down('KeyW') || PF.Input.down('ArrowUp')) iy -= 1;
      if (PF.Input.down('KeyS') || PF.Input.down('ArrowDown')) iy += 1;
      if (this.rootTimer > 0) {
        ix = 0;
        iy = 0;
      }
      if (ix < 0) this.facing = -1;
      else if (ix > 0) this.facing = 1;

      // 三方向贴图：上/下优先于左右；水平移动统一使用朝右图。
      if (iy < 0) this.direction = 'up';
      else if (iy > 0) this.direction = 'down';
      else if (ix !== 0) this.direction = 'right';

      const inputLength = Math.hypot(ix, iy);
      if (inputLength > 0) {
        ix /= inputLength;
        iy /= inputLength;
        this.moving = true;
      } else {
        this.moving = false;
      }

      const terrainSpeed = this.game.getTerrainSpeedMultiplier
        ? this.game.getTerrainSpeedMultiplier(this.x, this.y)
        : 1;
      const tongueSlow = this.tongueSlowTimer > 0 ? this.tongueSlowMultiplier : 1;
      const curseSlow = this.game.getCurseSandSpeedMultiplier
        ? this.game.getCurseSandSpeedMultiplier(this.x, this.y)
        : 1;
      const moveX = ix * CFG.PLAYER.SPEED * terrainSpeed * tongueSlow * curseSlow * dt + this.knockX * dt;
      const moveY = iy * CFG.PLAYER.SPEED * terrainSpeed * tongueSlow * curseSlow * dt + this.knockY * dt;
      moveBody(this.game, this, moveX, moveY, this.halfW, this.halfH);

      // 击退衰减
      const decay = Math.exp(-CFG.PLAYER.KNOCKBACK_DECAY * dt);
      this.knockX *= decay;
      this.knockY *= decay;

      if (this.moving) this.walkTime += dt;

      // 按住左键持续发射，冷却由 shootCd 控制
      if (PF.Input.mouse.down) this.tryShoot();
    }

    /**
     * 底层统一发射入口：角度偏移、尺寸倍率与单发伤害都显式传入。
     * 墙体/树木碰撞仍由 Orb 的通用 findOrbHit 处理。
     */
    spawnBall(x, y, angleOffset, sizeMultiplier, damage) {
      const angle = this.aimAngle + (angleOffset || 0);
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const radius = CFG.ORB.RADIUS * (sizeMultiplier || 1);
      const orb = this.game.orbs.spawn(
        x + dx * CFG.ORB.SPAWN_OFFSET,
        y + dy * CFG.ORB.SPAWN_OFFSET,
        dx, dy, 'player', damage,
        CFG.ORB.SPEED, 1, radius
      );
      orb.pierce = this.orbPierce;
      orb.sizeMultiplier = sizeMultiplier || 1;
      orb.visualScale = sizeMultiplier || 1;
      orb.weaponTrail = this.weaponTrail;
      return orb;
    }

    tryShoot() {
      if (this.game.state !== 'playing' || this.shootCd > 0) return false;

      const isWeapon = this.weaponType === 'shotgun';
      const count = isWeapon ? Math.max(1, this.shotgunCount) : 1;
      const spread = isWeapon ? this.shotgunSpread : 0;
      const damage = isWeapon ? this.weaponPelletDamage : this.orbDamage;
      const size = isWeapon ? this.weaponSizeMultiplier : 1;

      for (let i = 0; i < count; i += 1) {
        const t = count <= 1 ? 0 : (i / (count - 1)) - 0.5;
        this.spawnBall(this.x, this.y, t * spread, size, damage);
      }

      this.shootCd = this.shootInterval;
      this.muzzleTimer = 0.06;
      this.game.addShake(1.3, 0.045);
      return true;
    }

    /** 毒水伤害：不触发无敌帧，也不产生击退，仅触发受击闪烁。 */
    takePoisonDamage(amount) {
      if (this.game.godMode) return false;
      if (this.game.state !== 'playing') return false;
      if (this.rolling && this.rollTimer > 0) return false;
      if (this.tryBlockFrostShield()) return false;

      this.hp = Math.max(0, this.hp - amount);
      this.hurtFlash = 0.18;
      this.game.addShake(1.6, 0.08);
      this.game.spawnBurst(
        this.x,
        this.y,
        4,
        ['#74d06d', '#a56cff', '#3f7d48'],
        38,
        0.35
      );
      if (this.hp <= 0) this.game.onPlayerDeath();
      return true;
    }

    /** 岩浆伤害：不触发无敌帧，比毒水更痛。 */
    takeLavaDamage(amount) {
      if (this.game.godMode) return false;
      if (this.game.state !== 'playing') return false;
      if (this.rolling && this.rollTimer > 0) return false;
      if (this.tryBlockFrostShield()) return false;

      this.hp = Math.max(0, this.hp - amount);
      this.hurtFlash = 0.2;
      this.game.addShake(3.4, 0.16);
      this.game.spawnBurst(
        this.x, this.y + 6, 8,
        ['#ff6a28', '#ffcb63', '#b72a10'],
        62, 0.45
      );
      if (this.hp <= 0) this.game.onPlayerDeath();
      return true;
    }

    /** 流沙下陷伤害：不触发无敌帧。 */
    takeQuicksandDamage(amount) {
      if (this.game.godMode) return false;
      if (this.game.state !== 'playing') return false;
      if (this.rolling && this.rollTimer > 0) return false;
      if (this.tryBlockFrostShield()) return false;

      this.hp = Math.max(0, this.hp - amount);
      this.hurtFlash = 0.22;
      this.game.addShake(3.2, 0.18);
      this.game.spawnBurst(
        this.x,
        this.y + 8,
        7,
        ['#7a4d28', '#b2813e', '#d8b268'],
        58,
        0.4
      );
      if (this.hp <= 0) this.game.onPlayerDeath();
      return true;
    }

    takeDamage(amount, sourceX, sourceY) {
      if (
        this.game.godMode ||
        this.invuln > 0 ||
        (this.rolling && this.rollTimer > 0) ||
        this.game.state !== 'playing'
      ) return false;
      if (this.tryBlockFrostShield()) return false;

      this.hp = Math.max(0, this.hp - amount);
      this.invuln = CFG.PLAYER.INVULN_TIME;
      this.hurtFlash = 0.18;
      this.game.addShake(4.5, 0.18);

      // 从伤害来源方向反向击退
      let angle = Math.atan2(this.y - sourceY, this.x - sourceX);
      if (!Number.isFinite(angle) || (Math.abs(this.x - sourceX) < 0.001 && Math.abs(this.y - sourceY) < 0.001)) {
        angle = Math.random() * Math.PI * 2;
      }
      this.knockX = Math.cos(angle) * CFG.PLAYER.HIT_KNOCKBACK;
      this.knockY = Math.sin(angle) * CFG.PLAYER.HIT_KNOCKBACK;

      this.game.spawnBurst(this.x, this.y, 10, PALETTE.bloodColors, 110, 0.42);
      if (this.hp <= 0) this.game.onPlayerDeath();
      return true;
    }

    takeTrueDamage(amount) {
      // 真实伤害：无视无敌帧、翻滚和护盾，也不受 godMode 保护。
      this.hp = Math.max(0, this.hp - amount);
      this.hurtFlash = 0.18;
      this.game.addShake(6.5, 0.25);
      this.game.spawnBurst(
        this.x, this.y, 18,
        ['#fff4c2', '#ffd76b', '#ffffff', '#c79a3d'], 140, 0.6
      );
      if (this.hp <= 0) this.game.onPlayerDeath();
      return true;
    }
  }

  class Tree {
    constructor(game, x, y) {
      this.game = game;
      this.x = x;
      this.y = y;
      this.hp = CFG.TREE.HP;
      this.maxHp = CFG.TREE.HP;
      this.state = 'alive';       // alive | falling | stump
      this.fallTimer = 0;
      this.fallDir = 'right';
      this.fallRect = null;
      this.hitFlash = 0;
      this.landTimer = 0;
    }

    blocksMovement() {
      return this.state === 'alive';
    }

    getBody() {
      const w = CFG.TREE.BODY_W;
      const h = CFG.TREE.BODY_H;
      return {
        x: this.x - w / 2,
        y: this.y - h + 4,
        w,
        h
      };
    }

    hit(amount, hitX, hitY) {
      if (this.state !== 'alive') return;

      this.hp -= amount;
      this.hitFlash = CFG.TREE.HIT_FLASH_TIME;
      this.game.addShake(1.8, 0.07);
      this.game.spawnBurst(hitX, hitY, 6, PALETTE.leafColors, 95, 0.38);

      if (this.hp <= 0) {
        this.hp = 0;
        this.startFalling();
      }
    }

    startFalling() {
      if (this.state !== 'alive') return;
      this.state = 'falling';
      this.fallTimer = 0;

      const player = this.game.player;
      let awayX = this.x - player.x;
      let awayY = this.y - player.y;

      if (Math.abs(awayX) < 0.01 && Math.abs(awayY) < 0.01) {
        awayX = 0;
        awayY = 1;
      }

      if (Math.abs(awayX) >= Math.abs(awayY)) {
        this.fallDir = awayX >= 0 ? 'right' : 'left';
      } else {
        this.fallDir = awayY >= 0 ? 'down' : 'up';
      }

      const length = CFG.TREE.FALL_LENGTH;
      const width = CFG.TREE.FALL_WIDTH;
      const baseX = this.x;
      const baseY = this.y;

      if (this.fallDir === 'right') {
        this.fallRect = { x: baseX, y: baseY - width / 2, w: length, h: width };
      } else if (this.fallDir === 'left') {
        this.fallRect = { x: baseX - length, y: baseY - width / 2, w: length, h: width };
      } else if (this.fallDir === 'down') {
        this.fallRect = { x: baseX - width / 2, y: baseY, w: width, h: length };
      } else {
        this.fallRect = { x: baseX - width / 2, y: baseY - length, w: width, h: length };
      }

      this.game.addShake(2.4, 0.12);
      this.game.spawnBurst(this.x, this.y - 35, 10, PALETTE.leafColors, 125, 0.5);
    }

    update(dt) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.landTimer = Math.max(0, this.landTimer - dt);

      if (this.state === 'falling') {
        this.fallTimer += dt;
        if (this.fallTimer >= CFG.TREE.FALL_TIME) {
          this.state = 'stump';
          this.landTimer = 0.36;
          this.game.landTree(this);
        }
      }
    }
  }

  class Enemy {
    constructor(game, archetype, x, y) {
      this.game = game;
      const levelScale = game.currentLevel && game.currentLevel.enemyStatScale;
      if (levelScale) {
        archetype = {
          ...archetype,
          hp: Math.ceil(archetype.hp * (levelScale.hp || 1)),
          speedPatrol: archetype.speedPatrol * (levelScale.speed || 1),
          speedChase: archetype.speedChase * (levelScale.speed || 1)
        };
      }
      this.archetype = archetype;
      this.type = archetype.id;
      this.x = x;
      this.y = y;
      this.radius = archetype.radius;
      this.hp = archetype.hp;
      this.maxHp = archetype.hp;
      this.dead = false;

      this.state = 'patrol';      // patrol | chase
      this.hasChaseSlot = false;
      this.chaseTimer = 0;
      this.lostTimer = 0;
      this.chaseCooldown = 0;
      this.lastSeenX = x;
      this.lastSeenY = y;

      this.patrolTargetX = x;
      this.patrolTargetY = y;
      this.patrolWait = randomRange(Math.random, CFG.PATROL.WAIT_MIN, CFG.PATROL.WAIT_MAX);
      this.patrolTimer = 0;

      this.knockX = 0;
      this.knockY = 0;
      this.walkTime = Math.random() * 10;
      this.faceX = 1;
      this.alertBlink = 0;
      this.avoidTimer = 0;
      this.avoidSide = Math.random() < 0.5 ? -1 : 1;
      this.patrolDir = Math.random() < 0.5 ? -1 : 1;

      // 精英怪使用 1~2 秒的短追击；普通小怪使用 chaseMaxTime。
      this.chaseDuration = archetype.chaseMaxTime ?? archetype.chaseDurationMax ?? 2;
      this.hitFlash = 0;
      this.muzzleTimer = 0;

      // 远程攻击冷却：只有配置了 ranged 的怪物才会发射敌方法球。
      if (archetype.ranged) {
        this.rangedCooldown = randomRange(
          Math.random,
          archetype.ranged.initialDelayMin ?? archetype.ranged.interval,
          archetype.ranged.initialDelayMax ?? archetype.ranged.interval
        );
      } else {
        this.rangedCooldown = Infinity;
      }

      this.burrowed = false;
      this.burrowPhase = null;
      this.burrowTimer = 0;
      this.emergeTarget = null;
      this.burrowCooldown = archetype.burrow ? 0 : Infinity;
      this.holdTimer = 0;
      this.slamState = null;
      this.slamTimer = 0;
      this.slamCooldown = archetype.slam ? 0 : Infinity;
      this.slamTargetX = x;
      this.slamTargetY = y;
      this.slamJumpFromX = x;
      this.slamJumpFromY = y;
      this.jumpOffsetY = 0;
      this.slamShockwave = 0;
      this.deathBombSpawned = false;
      this.lavaBallTimer = archetype.lavaBall ? archetype.lavaBall.interval : 0;
      this.hookCooldown = archetype.hook ? archetype.hook.cooldown : Infinity;
      this.pullTimer = 0;
      this.slamTimer = 0;
      this.slamAngle = 0;
      this.slamDodged = false;
      this.executionerStun = 0;
      this.dashCooldown = archetype.dash ? archetype.dash.interval : 0;
      this.dashWindup = 0;
      this.dashTimer = 0;
      this.dashStun = 0;
      this.dashDirX = 0;
      this.dashDirY = 0;
      this.inkDamage = 0;
      this.bones = false;
      this.bonesTimer = 0;
      this.bonesFlash = 0;
      this.reviveTime = archetype.reviveTime || 0;
    }

    updateBones(dt) {
      this.bonesTimer = Math.max(0, this.bonesTimer - dt);
      this.bonesFlash += dt;
      if (
        distance(this.x, this.y, this.game.player.x, this.game.player.y) <
        this.radius + this.game.player.halfW + 4
      ) {
        this.bones = false;
        this.dead = true;
        this.game.spawnBurst(
          this.x, this.y, 12,
          ['#d8d3c2', '#8e897c', '#6f6a60'], 95, 0.4
        );
        return;
      }
      if (this.bonesTimer === 0) {
        this.bones = false;
        this.hp = this.maxHp;
        this.state = 'patrol';
        this.chaseCooldown = 0;
        this.game.spawnBurst(
          this.x, this.y, 18,
          ['#b26cff', '#d8d3c2', '#8e897c'], 110, 0.5
        );
      }
    }

    startExecutionerSlam() {
      const slam = this.archetype.slam;
      if (!slam) return;
      this.slamTimer = slam.warnTime;
      this.slamDodged = false;
      this.moving = false;
      this.slamAngle = Math.atan2(
        this.game.player.y - this.y,
        this.game.player.x - this.x
      );
      this.game.spawnBurst(
        this.x, this.y - 10, 8,
        ['#6e1712', '#8e8a94', '#3a3942'], 70, 0.3
      );
    }

    updateExecutioner(dt) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.walkTime += dt;
      this.hookCooldown = Math.max(0, this.hookCooldown - dt);
      const player = this.game.player;
      if (Math.abs(player.x - this.x) > 2) {
        this.faceX = player.x >= this.x ? 1 : -1;
      }

      if (this.executionerStun > 0) {
        this.executionerStun = Math.max(0, this.executionerStun - dt);
        this.moving = false;
        return;
      }

      if (this.pullTimer > 0) {
        if (player.rolling) {
          this.pullTimer = 0;
          this.executionerStun = this.archetype.slam.stunTime;
          return;
        }
        this.pullTimer = Math.max(0, this.pullTimer - dt);
        const pull = Math.min(1, dt * 7);
        player.x += (this.x - player.x) * pull;
        player.y += (this.y - player.y) * pull;
        this.moving = false;
        if (this.pullTimer === 0) this.startExecutionerSlam();
        return;
      }

      if (this.slamTimer > 0) {
        if (player.rolling) this.slamDodged = true;
        this.slamTimer = Math.max(0, this.slamTimer - dt);
        this.moving = false;
        if (this.slamTimer === 0) {
          const slam = this.archetype.slam;
          const dx = player.x - this.x;
          const dy = player.y - this.y;
          const dist = Math.hypot(dx, dy);
          const diff = Math.abs(
            Math.atan2(Math.sin(Math.atan2(dy, dx) - this.slamAngle),
              Math.cos(Math.atan2(dy, dx) - this.slamAngle))
          );
          if (!this.slamDodged &&
            dist <= slam.range &&
            diff <= slam.halfAngle) {
            player.takeDamage(slam.damage, this.x, this.y);
          }
          if (this.slamDodged) {
            this.executionerStun = slam.stunTime;
          }
        }
        return;
      }

      const dist = distance(this.x, this.y, player.x, player.y);
      if (dist <= this.archetype.slam.triggerRange) {
        this.startExecutionerSlam();
        return;
      }
      if (dist > 240 && this.hookCooldown <= 0) {
        this.game.spawnExecutionerHook(
          this, player.x, player.y, this.archetype.hook
        );
        this.hookCooldown = this.archetype.hook.cooldown;
        return;
      }

      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      if (dist > 42) {
        moveBody(
          this.game, this,
          (dx / len) * this.archetype.speedChase * dt,
          (dy / len) * this.archetype.speedChase * dt,
          this.radius, this.radius
        );
        this.moving = true;
      } else {
        this.moving = false;
      }
    }

    updatePiranha(dt) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.walkTime += dt;
      const player = this.game.player;
      const dash = this.archetype.dash;

      if (this.dashStun > 0) {
        this.dashStun = Math.max(0, this.dashStun - dt);
        this.moving = false;
        return;
      }

      if (this.dashTimer > 0) {
        this.dashTimer = Math.max(0, this.dashTimer - dt);
        moveBody(
          this.game, this,
          this.dashDirX * dash.speed * dt,
          this.dashDirY * dash.speed * dt,
          this.radius, this.radius
        );
        this.moving = true;
        if (this.dashTimer === 0) {
          this.moving = false;
          this.dashStun = dash.stun;
        }
        return;
      }

      if (this.dashWindup > 0) {
        this.dashWindup = Math.max(0, this.dashWindup - dt);
        this.moving = false;
        if (this.dashWindup === 0) {
          const angle = Math.atan2(player.y - this.y, player.x - this.x);
          this.dashDirX = Math.cos(angle);
          this.dashDirY = Math.sin(angle);
          this.dashTimer = dash.duration;
          this.game.spawnBurst(
            this.x, this.y, 6,
            ['#8fd8ef', '#3f8fb8'], 80, 0.25
          );
        }
        return;
      }

      this.dashCooldown = Math.max(0, this.dashCooldown - dt);
      const dist = distance(this.x, this.y, player.x, player.y);
      if (this.dashCooldown === 0 && dist < 320) {
        this.dashWindup = dash.windup;
        this.dashCooldown = dash.interval;
        this.moving = false;
        return;
      }

      if (dist > 4) {
        const angle = Math.atan2(player.y - this.y, player.x - this.x);
        moveBody(
          this.game, this,
          Math.cos(angle) * this.archetype.speedChase * dt,
          Math.sin(angle) * this.archetype.speedChase * dt,
          this.radius, this.radius
        );
        this.moving = true;
      }
    }

    update(dt) {
      if (this.dead) return;
      if (this.bones) {
        this.updateBones(dt);
        return;
      }

      if (this.type === 'scorpion') {
        this.updateScorpion(dt);
        return;
      }
      if (this.type === 'snowman') {
        this.updateSnowman(dt);
        return;
      }
      if (this.type === 'giantYeti') {
        this.updateGiantYeti(dt);
        return;
      }
      if (this.type === 'executioner') {
        this.updateExecutioner(dt);
        return;
      }
      if (this.type === 'piranha') {
        this.updatePiranha(dt);
        return;
      }

      this.chaseCooldown = Math.max(0, this.chaseCooldown - dt);
      this.alertBlink += dt;
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.muzzleTimer = Math.max(0, this.muzzleTimer - dt);

      // 进门保护期内绝不保持追击状态。
      if (this.game.enemyAggroLockTimer > 0 && this.state === 'chase') {
        this.giveUpChase();
      }

      // 击退衰减
      const decay = Math.exp(-9 * dt);

      if (this.state === 'chase') {
        this.updateChase(dt);
      } else {
        this.updatePatrol(dt);
      }

      // 即使处于巡逻状态，精英怪也会按固定频率向玩家发射法球。
      this.updateRanged(dt);

      if (this.type === 'lavaGolem') {
        const lavaBall = this.archetype.lavaBall;
        if (lavaBall) {
          this.lavaBallTimer = Math.max(0, this.lavaBallTimer - dt);
          if (this.lavaBallTimer === 0 && this.game.state === 'playing') {
            this.lavaBallTimer = lavaBall.interval;
            this.game.spawnLavaBall(
              this.x, this.y,
              this.game.player.x, this.game.player.y,
              lavaBall
            );
          }
        }
      }

      // 击退位移
      if (Math.abs(this.knockX) > 1 || Math.abs(this.knockY) > 1) {
        moveBody(
          this.game,
          this,
          this.knockX * dt,
          this.knockY * dt,
          this.radius,
          this.radius
        );
        this.knockX *= decay;
        this.knockY *= decay;
      }

      this.walkTime += dt;
    }

    updateScorpion(dt) {
      this.alertBlink += dt;
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.muzzleTimer = Math.max(0, this.muzzleTimer - dt);
      this.contactCooldown = Math.max(0, this.contactCooldown - dt);
      this.walkTime += dt;

      if (this.burrowPhase) {
        this.updateBurrow(dt);
        return;
      }
      if (this.burrowed) return;
      if (this.game.state !== 'playing') return;
      if (this.game.enemyAggroLockTimer > 0) {
        this.state = 'patrol';
        this.moving = false;
        return;
      }

      const player = this.game.player;
      const dist = distance(this.x, this.y, player.x, player.y);
      const burrow = this.archetype.burrow;
      this.state = 'chase';
      this.burrowCooldown = Math.max(0, this.burrowCooldown - dt);

      const decay = Math.exp(-9 * dt);
      if (Math.abs(this.knockX) > 1 || Math.abs(this.knockY) > 1) {
        moveBody(
          this.game, this,
          this.knockX * dt, this.knockY * dt,
          this.radius, this.radius
        );
        this.knockX *= decay;
        this.knockY *= decay;
      }

      if (dist > burrow.minRange && this.burrowCooldown <= 0) {
        this.startBurrow();
        return;
      }

      if (dist > burrow.minRange) {
        this.faceX = player.x >= this.x ? 1 : -1;
        this.moveToward(player.x, player.y, this.archetype.speedChase, dt);
        this.moving = true;
        return;
      }

      // 近距离：停下用尾巴发射三发扇形毒刺。
      const willFire = this.rangedCooldown <= dt;
      this.updateRanged(dt);
      if (willFire) this.holdTimer = 0.6;

      if (this.holdTimer > 0) {
        this.holdTimer = Math.max(0, this.holdTimer - dt);
        this.moving = false;
        return;
      }

      this.faceX = player.x >= this.x ? 1 : -1;
      this.moveToward(player.x, player.y, this.archetype.speedChase, dt);
      this.moving = true;
    }

    applyCustomKnockback(dt) {
      const decay = Math.exp(-9 * dt);
      if (Math.abs(this.knockX) > 1 || Math.abs(this.knockY) > 1) {
        moveBody(
          this.game, this,
          this.knockX * dt, this.knockY * dt,
          this.radius, this.radius
        );
        this.knockX *= decay;
        this.knockY *= decay;
      }
      this.walkTime += dt;
    }

    updateSnowman(dt) {
      this.alertBlink += dt;
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.muzzleTimer = Math.max(0, this.muzzleTimer - dt);
      this.holdTimer = Math.max(0, this.holdTimer - dt);

      if (this.game.state !== 'playing') return;
      const player = this.game.player;
      const dist = distance(this.x, this.y, player.x, player.y);

      if (this.game.enemyAggroLockTimer > 0) {
        this.state = 'patrol';
        this.moving = false;
        this.applyCustomKnockback(dt);
        return;
      }

      if (dist > this.archetype.loseRadius) {
        this.state = 'patrol';
        this.moving = false;
        this.applyCustomKnockback(dt);
        return;
      }

      this.state = 'chase';
      this.faceX = player.x >= this.x ? 1 : -1;

      if (dist > this.archetype.ranged.minRange) {
        this.moving = false;
        const fired = this.updateRanged(dt);
        if (fired) this.holdTimer = 0.45;
        this.applyCustomKnockback(dt);
        return;
      }

      this.holdTimer = 0;
      this.moveToward(
        player.x, player.y,
        this.archetype.speedChase,
        dt
      );
      this.moving = true;
      this.applyCustomKnockback(dt);
    }

    updateGiantYeti(dt) {
      this.alertBlink += dt;
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.muzzleTimer = Math.max(0, this.muzzleTimer - dt);
      this.slamShockwave = Math.max(0, this.slamShockwave - dt);
      const cfg = this.archetype.slam;

      if (this.game.state !== 'playing') return;

      if (this.slamState === 'charge') {
        this.slamTimer -= dt;
        this.moving = false;
        this.jumpOffsetY = 0;
        if (this.slamTimer <= 0) {
          this.slamState = 'jump';
          this.slamTimer = cfg.jumpTime;
          this.slamJumpFromX = this.x;
          this.slamJumpFromY = this.y;
        }
        this.applyCustomKnockback(dt);
        return;
      }

      if (this.slamState === 'jump') {
        this.slamTimer -= dt;
        this.moving = false;
        const elapsed = cfg.jumpTime - this.slamTimer;
        const t = Math.max(0, Math.min(1, elapsed / cfg.jumpTime));
        this.x = this.slamJumpFromX +
          (this.slamTargetX - this.slamJumpFromX) * t;
        this.y = this.slamJumpFromY +
          (this.slamTargetY - this.slamJumpFromY) * t;
        this.jumpOffsetY = Math.sin(t * Math.PI) * cfg.jumpHeight;
        this.knockX = 0;
        this.knockY = 0;
        if (this.slamTimer <= 0) this.impactGiantSlam();
        return;
      }

      if (this.slamState === 'stun') {
        this.slamTimer -= dt;
        this.moving = false;
        this.jumpOffsetY = 0;
        if (this.slamTimer <= 0) {
          this.slamState = null;
          this.slamCooldown = cfg.cooldown;
        }
        this.applyCustomKnockback(dt);
        return;
      }

      this.slamCooldown = Math.max(0, this.slamCooldown - dt);

      if (this.game.enemyAggroLockTimer > 0) {
        this.state = 'patrol';
        this.moving = false;
        this.applyCustomKnockback(dt);
        return;
      }

      const player = this.game.player;
      const dist = distance(this.x, this.y, player.x, player.y);
      if (dist <= this.archetype.detectRadius) this.state = 'chase';
      if (this.state !== 'chase' || dist > this.archetype.loseRadius) {
        this.state = 'patrol';
        this.moving = false;
        this.applyCustomKnockback(dt);
        return;
      }

      this.faceX = player.x >= this.x ? 1 : -1;
      if (this.slamCooldown <= 0 && dist <= 145) {
        this.startGiantSlam(player);
        this.applyCustomKnockback(dt);
        return;
      }

      this.moveToward(
        player.x, player.y,
        this.archetype.speedChase,
        dt
      );
      this.moving = true;
      this.applyCustomKnockback(dt);
    }

    startGiantSlam(player) {
      const cfg = this.archetype.slam;
      this.slamState = 'charge';
      this.slamTimer = cfg.warnTime;
      this.slamTargetX = player.x;
      this.slamTargetY = player.y;
      this.slamJumpFromX = this.x;
      this.slamJumpFromY = this.y;
      this.jumpOffsetY = 0;
      this.slamShockwave = 0;
      this.moving = false;
      this.state = 'chase';
      this.game.addShake(1.5, 0.1);
    }

    impactGiantSlam() {
      const cfg = this.archetype.slam;
      this.slamState = 'slam';
      this.x = this.slamTargetX;
      this.y = this.slamTargetY;
      this.jumpOffsetY = 0;

      const player = this.game.player;
      if (distance(player.x, player.y, this.x, this.y) <= cfg.radius) {
        const hit = player.takeDamage(cfg.damage, this.x, this.y);
        if (hit) {
          player.addCold(cfg.cold);
          player.applyTongueSlow(cfg.slowDuration, cfg.slowMultiplier);
        }
      }

      this.game.addShake(6.2, 0.35);
      this.game.spawnBurst(
        this.x, this.y, 28,
        ['#e8f7ff', '#a9d8ee', '#6f9db5', '#ffffff'],
        185, 0.7
      );
      this.slamShockwave = 0.45;
      this.slamState = 'stun';
      this.slamTimer = cfg.stunTime;
    }

    startBurrow() {
      const cfg = this.archetype.burrow;
      this.burrowPhase = 'hidden';
      this.burrowTimer = cfg.hiddenTime;
      this.burrowed = true;
      this.moving = false;
      this.state = 'patrol';
      this.knockX = 0;
      this.knockY = 0;
      this.game.spawnBurst(
        this.x, this.y + 8, 14,
        ['#7a4d28', '#b2813e', '#d8b268'],
        90, 0.55
      );
      this.game.addShake(1.2, 0.1);
    }

    updateBurrow(dt) {
      const cfg = this.archetype.burrow;
      this.burrowTimer -= dt;

      if (this.burrowPhase === 'hidden') {
        if (this.burrowTimer > 0) return;

        this.burrowPhase = 'warning';
        this.burrowTimer = cfg.warnTime;
        const player = this.game.player;
        const margin = CFG.WORLD.WALL + this.radius + 8;
        this.emergeTarget = {
          x: clamp(player.x, margin, CFG.WORLD.W - margin),
          y: clamp(player.y, margin, CFG.WORLD.H - margin)
        };
        this.x = this.emergeTarget.x;
        this.y = this.emergeTarget.y;
        this.game.spawnBurst(
          this.x, this.y + 8, 10,
          ['#7a4d28', '#b2813e'], 70, 0.4
        );
        return;
      }

      if (this.burrowPhase === 'warning' && this.burrowTimer <= 0) {
        this.burrowPhase = null;
        this.burrowed = false;
        this.burrowCooldown = cfg.cooldown;
        this.state = 'chase';
        this.game.addShake(5.5, 0.32);
        this.game.spawnBurst(
          this.x, this.y + 10, 20,
          ['#7a4d28', '#b2813e', '#e0bd75', '#6b442e'],
          145, 0.65
        );
        if (
          distance(this.game.player.x, this.game.player.y, this.x, this.y) <= cfg.radius
        ) {
          this.game.player.takeDamage(cfg.damage, this.x, this.y);
        }
        this.emergeTarget = null;
      }
    }

    updatePatrol(dt) {
      const player = this.game.player;

      // 发现玩家：距离足够近且还有追击名额时进入追击
      if (
        this.game.state === 'playing' &&
        this.game.enemyAggroLockTimer <= 0 &&
        this.chaseCooldown <= 0 &&
        distance(this.x, this.y, player.x, player.y) <= this.archetype.detectRadius
      ) {
        const canChase = this.archetype.ignoreChaseLimit
          ? true
          : this.game.requestChase(this);
        if (canChase) {
          this.enterChase(!this.archetype.ignoreChaseLimit);
          return;
        }
      }

      if (this.patrolWait > 0) {
        this.patrolWait -= dt;
        return;
      }

      this.patrolTimer -= dt;
      const distToTarget = distance(this.x, this.y, this.patrolTargetX, this.patrolTargetY);

      if (distToTarget < 8 || this.patrolTimer <= 0) {
        this.pickPatrolTarget();
        this.patrolWait = randomRange(Math.random, CFG.PATROL.WAIT_MIN, CFG.PATROL.WAIT_MAX);
        return;
      }

      this.moveToward(
        this.patrolTargetX,
        this.patrolTargetY,
        this.archetype.speedPatrol,
        dt
      );
    }

    enterChase(hasSlot = true) {
      this.state = 'chase';
      this.hasChaseSlot = hasSlot;
      this.chaseTimer = 0;
      this.lostTimer = 0;
      this.patrolWait = 0;
      this.lastSeenX = this.game.player.x;
      this.lastSeenY = this.game.player.y;

      const minDuration = this.archetype.chaseDurationMin
        ?? this.archetype.chaseMaxTime
        ?? 2;
      const maxDuration = this.archetype.chaseDurationMax
        ?? this.archetype.chaseMaxTime
        ?? minDuration;
      this.chaseDuration = randomRange(Math.random, minDuration, Math.max(minDuration, maxDuration));
    }

    updateChase(dt) {
      const player = this.game.player;
      const distToPlayer = distance(this.x, this.y, player.x, player.y);
      const canSeePlayer = distToPlayer <= this.archetype.loseRadius;

      this.chaseTimer += dt;
      if (canSeePlayer) {
        this.lostTimer = 0;
        this.lastSeenX = player.x;
        this.lastSeenY = player.y;
      } else {
        this.lostTimer += dt;
      }

      // 脱战满 2 秒，或本次追击持续时间结束，就返回巡逻
      if (
        this.game.state !== 'playing' ||
        this.lostTimer >= this.archetype.loseTime ||
        this.chaseTimer >= this.chaseDuration
      ) {
        this.giveUpChase();
        return;
      }

      const targetX = canSeePlayer ? player.x : this.lastSeenX;
      const targetY = canSeePlayer ? player.y : this.lastSeenY;
      this.moveToward(targetX, targetY, this.archetype.speedChase, dt);
    }

    /** 精英怪的远程攻击：每 2 秒朝玩家发射一颗紫色敌方法球。 */
    updateRanged(dt) {
      const ranged = this.archetype.ranged;
      if (!ranged || this.game.state !== 'playing') return false;
      if (this.game.enemyAggroLockTimer > 0) return false;

      this.rangedCooldown -= dt;
      if (this.rangedCooldown > 0) return false;

      const player = this.game.player;
      let baseAngle = Math.atan2(player.y - this.y, player.x - this.x);
      if (!Number.isFinite(baseAngle)) baseAngle = 0;

      const count = Math.max(1, ranged.count || 1);
      const spread = ranged.spread || 0;
      const spawnDistance = this.radius + ranged.radius + CFG.ENEMY_ORB.MUZZLE_OFFSET;

      for (let i = 0; i < count; i += 1) {
        const angle = baseAngle + (i - (count - 1) / 2) * spread;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const spawnX = this.x + dx * spawnDistance;
        const spawnY = this.y + dy * spawnDistance;

        this.game.orbs.spawn(
          spawnX, spawnY, dx, dy, 'enemy',
          ranged.damage,
          ranged.speed,
          ranged.treeDamage,
          ranged.radius,
          ranged.cold || 0
        );
        this.game.spawnBurst(spawnX, spawnY, 4, PALETTE.enemyOrbSpark, 55, 0.28);
      }

      this.muzzleTimer = 0.13;
      this.rangedCooldown = ranged.interval;
      this.game.addShake(0.7, 0.045);
      return true;
    }

    giveUpChase() {
      this.game.releaseChase(this);
      this.hasChaseSlot = false;
      this.state = 'patrol';
      this.chaseCooldown = this.archetype.chaseCooldown;
      this.patrolWait = 0;
      this.patrolTimer = 0;
      this.pickPatrolTarget();
    }

    moveToward(targetX, targetY, speed, dt) {
      const dx = targetX - this.x;
      const dy = targetY - this.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) return;

      let terrainSpeed = this.game.getTerrainSpeedMultiplier
        ? this.game.getTerrainSpeedMultiplier(this.x, this.y)
        : 1;
      if (
        (this.game.currentLevelId === 2 && this.archetype.poisonImmune) ||
        (this.game.currentLevelId === 3 && this.archetype.quicksandImmune)
      ) {
        terrainSpeed = 1;
      }
      speed *= terrainSpeed;

      const dirX = dx / len;
      const dirY = dy / len;
      if (Math.abs(dirX) > 0.08) this.faceX = dirX >= 0 ? 1 : -1;

      const beforeX = this.x;
      const beforeY = this.y;
      moveBody(
        this.game,
        this,
        dirX * speed * dt,
        dirY * speed * dt,
        this.radius,
        this.radius
      );

      const moved = Math.hypot(this.x - beforeX, this.y - beforeY);
      const expected = speed * dt;

      // 简单避障：被树干正面挡住时朝侧面挪一点，避免原地卡死。
      if (moved < expected * 0.24 && expected > 0.01) {
        const side = this.avoidSide;
        this.avoidTimer = 0.28;
        moveBody(
          this.game,
          this,
          -dirY * side * speed * 0.78 * dt,
          dirX * side * speed * 0.78 * dt,
          this.radius,
          this.radius
        );
      } else if (this.avoidTimer > 0) {
        this.avoidTimer -= dt;
      }
    }

    pickPatrolTarget() {
      const margin = CFG.WORLD.WALL + CFG.PATROL.POINT_MARGIN;

      // 精英怪默认左右巡逻：本次向左/向右走一段，下一次反向。
      if (this.archetype.patrolMode === 'horizontal') {
        const range = this.archetype.patrolRange ?? 140;
        let dir = this.patrolDir;
        let targetX = this.x + dir * range;

        if (targetX < margin || targetX > CFG.WORLD.W - margin) {
          dir = -dir;
          targetX = this.x + dir * range;
        }

        this.patrolTargetX = clamp(targetX, margin, CFG.WORLD.W - margin);
        this.patrolTargetY = clamp(this.y, margin, CFG.WORLD.H - margin);
        this.patrolTimer = randomRange(Math.random, CFG.PATROL.TIME_MIN, CFG.PATROL.TIME_MAX);
        this.patrolDir = -dir;
        return;
      }

      let bestX = this.x;
      let bestY = this.y;

      for (let i = 0; i < CFG.PATROL.SAMPLE_ATTEMPTS; i += 1) {
        const x = randomRange(Math.random, margin, CFG.WORLD.W - margin);
        const y = randomRange(Math.random, margin, CFG.WORLD.H - margin);
        bestX = x;
        bestY = y;
        if (!isCircleBlocked(this.game, x, y, this.radius + 8)) break;
      }

      this.patrolTargetX = bestX;
      this.patrolTargetY = bestY;
      this.patrolTimer = randomRange(Math.random, CFG.PATROL.TIME_MIN, CFG.PATROL.TIME_MAX);
    }

    takeDamage(amount, sourceX, sourceY) {
      if (this.dead || this.burrowed || this.bones) return;
      this.hp -= amount;
      this.hitFlash = 0.12;

      if (this.type === 'octopus') {
        this.inkDamage += amount;
        if (this.inkDamage > this.archetype.ink.threshold || this.hp <= 0) {
          this.inkDamage = 0;
          this.game.spawnInk(this.x, this.y);
        }
      }

      if (this.hp <= 0 && this.type === 'skeleton') {
        this.hp = 0;
        this.bones = true;
        this.bonesTimer = this.reviveTime;
        this.bonesFlash = 0;
        this.state = 'bones';
        this.moving = false;
        this.game.spawnBurst(
          this.x, this.y, 14,
          ['#d8d3c2', '#8e897c', '#b26cff'], 100, 0.5
        );
        return;
      }

      if (this.hp <= 0) {
        if (this.type === 'fireSpirit' && !this.deathBombSpawned) {
          this.deathBombSpawned = true;
          this.game.spawnFireSpiritBomb(
            this.x, this.y, this.archetype.deathBomb
          );
        }
        this.game.killEnemy(this, sourceX, sourceY);
      } else {
        const colors = this.archetype.isElite
          ? PALETTE.eliteBlood
          : PALETTE.bloodColors;
        this.game.spawnBurst(this.x, this.y, 4, colors, 70, 0.3);
      }
    }
  }

  class GasPod {
    constructor(game, x, y, settings = {}) {
      this.game = game;
      this.x = x;
      this.y = y;
      this.radius = settings.radius || 18;
      this.maxHp = settings.hp || 3;
      this.hp = this.maxHp;
      this.dead = false;
      this.hitFlash = 0;
      this.phase = Math.random() * Math.PI * 2;
    }

    getBody() {
      return {
        x: this.x - this.radius,
        y: this.y - this.radius,
        w: this.radius * 2,
        h: this.radius * 2
      };
    }

    update(dt) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
    }

    takeDamage(amount) {
      if (this.dead) return;
      this.hp -= amount;
      this.hitFlash = 0.15;
      this.game.spawnBurst(
        this.x,
        this.y,
        5,
        ['#9b64ff', '#59d06d', '#d2ffad'],
        60,
        0.3
      );
      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
        this.game.explodeGasPod(this);
      }
    }
  }

  class Campfire {
    constructor(game, x, y, settings = {}) {
      this.game = game;
      this.type = 'campfire';
      this.x = x;
      this.y = y;
      this.radius = settings.radius || 18;
      this.warmRadius = settings.warmRadius || 150;
      this.maxHp = settings.hp || 3;
      this.hp = this.maxHp;
      this.dead = false;
      this.hitFlash = 0;
      this.phase = Math.random() * Math.PI * 2;
      this.destroyedByBoss = false;
      this.respawnTimer = 0;
    }

    getBody() {
      return {
        x: this.x - this.radius,
        y: this.y - this.radius,
        w: this.radius * 2,
        h: this.radius * 2
      };
    }

    getOrbBody() {
      return {
        x: this.x - this.radius - 3,
        y: this.y - this.radius - 5,
        w: this.radius * 2 + 6,
        h: this.radius * 2 + 10
      };
    }

    update(dt) {
      if (this.dead) {
        if (this.destroyedByBoss && this.respawnTimer > 0) {
          this.respawnTimer = Math.max(0, this.respawnTimer - dt);
          if (this.respawnTimer === 0) {
            this.dead = false;
            this.hp = this.maxHp;
            this.destroyedByBoss = false;
            this.hitFlash = 0;
            this.game.spawnBurst(
              this.x, this.y - 10, 16,
              ['#ffd36a', '#f08a4b', '#dfe8ef'],
              90, 0.55
            );
            this.game.showToast('火堆重新燃起', 1.2);
          }
        }
        return;
      }
      this.hitFlash = Math.max(0, this.hitFlash - dt);
    }

    takeDamage(amount) {
      if (this.dead) return;
      this.hp -= amount;
      this.hitFlash = 0.16;
      this.game.spawnBurst(
        this.x, this.y - 10, 6,
        ['#ffd36a', '#f08a4b', '#dfe8ef'],
        65, 0.3
      );
      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
        this.game.onCampfireExtinguished(this);
      }
    }
  }

  class Cactus {
    constructor(game, x, y, settings = {}) {
      this.game = game;
      this.x = x;
      this.y = y;
      this.radius = settings.radius || 18;
      this.maxHp = settings.hp || 5;
      this.hp = this.maxHp;
      this.dead = false;
      this.hitFlash = 0;
      this.phase = Math.random() * Math.PI * 2;
    }

    getBody() {
      return {
        x: this.x - this.radius,
        y: this.y - this.radius,
        w: this.radius * 2,
        h: this.radius * 2
      };
    }

    update(dt) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
    }

    takeDamage(amount) {
      if (this.dead) return;
      this.hp -= amount;
      this.hitFlash = 0.15;
      this.game.spawnBurst(
        this.x,
        this.y - 6,
        5,
        ['#5e8a3a', '#8fb85a', '#d8c27a'],
        62,
        0.3
      );
      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
        this.game.onCactusDestroyed(this);
      }
    }
  }

  Object.assign(PF, { OrbPool, Player, Tree, Enemy, GasPod, Cactus, Campfire });
})(window);
