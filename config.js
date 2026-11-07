/* ============================================================
 * config.js — 全局配置与数值
 * 所有可调数值、配色、怪物原型集中在此文件。
 * ============================================================ */
(function (global) {
  'use strict';

  const CFG = {
    WORLD: {
      W: 1280,                   // 恢复为大地图逻辑宽度
      H: 800,                    // 恢复为大地图逻辑高度
      WALL: 16,                  // 墙厚 16px
      TILE: 32,                  // 地板格子大小
      SEED: 20261025,            // 森林布局种子（固定，便于复现）
      FLOOR_SEED: 7319           // 地面装饰种子
    },

    PLAYER: {
      W: 24,
      H: 24,
      SPAWN_X: 640,
      SPAWN_Y: 700,
      SPEED: 185,                // 中等移动速度（px/s）
      MAX_HP: 10,
      ATK: 1,
      SHOOT_CD: 0.5,             // 法球冷却 0.5 秒
      INVULN_TIME: 1.0,          // 受伤后无敌 1 秒
      HIT_KNOCKBACK: 265,        // 受伤击退速度
      KNOCKBACK_DECAY: 9,        // 击退衰减系数
      WALK_ANIM_SPEED: 12        // 步行动画速度
    },

    ROLL: {
      DISTANCE: 120,
      DURATION: 0.3,
      IFRAME: 0.3,
      COOLDOWN: 1.5,
      GHOST_INTERVAL: 0.05,
      GHOST_LIFETIME: 0.24
    },

    POTION: {
      CHARGES: 1,
      HEAL: 3
    },

    BOSS_CHECKPOINT: {
      X: 728,
      Y: 700,
      TOUCH_RADIUS: 34
    },

    ORB: {
      SPEED: 600,                // 玩家法球速度 px/s
      RADIUS: 4,
      POOL_SIZE: 200,            // 玩家 / 精英共用的法球对象池容量
      SPAWN_OFFSET: 19,          // 出生点距玩家中心的距离
      TRAIL_LENGTH: 3
    },

    WEAPON: {
      PELLET_DAMAGE: 0.5,
      COUNT: 3,
      SPREAD_DEG: 15,
      HAIL_COUNT: 5,
      HAIL_SPREAD_DEG: 28
    },

    // 精英怪发射的敌方法球参数
    ENEMY_ORB: {
      SPEED: 300,
      RADIUS: 5,
      DAMAGE: 4,
      TREE_DAMAGE: 1,
      MUZZLE_OFFSET: 5
    },

    TREE: {
      COUNT: 12,
      HP: 5,
      BODY_W: 28,
      BODY_H: 24,
      MARGIN: 62,                // 树木距墙最小距离
      MIN_GAP: 82,               // 树木之间的最小间距
      PLAYER_CLEAR: 120,         // 玩家出生点周围留空半径
      FALL_TIME: 0.3,            // 倒下动画时长
      FALL_DAMAGE: 10,           // 倒树区域伤害
      FALL_LENGTH: 92,           // 伤害矩形长度
      FALL_WIDTH: 58,            // 伤害矩形宽度
      HIT_FLASH_TIME: 0.12
    },

    ENEMY: {
      COUNT: 12,                 // 普通小怪数量
      ELITE_COUNT: 2,            // 精英怪数量
      MAX_CHASERS: 4,            // 最多同时追击的怪物数量（小怪 + 精英共享）
      SPAWN_MARGIN: 38,
      SPAWN_PLAYER_CLEAR: 245,
      ELITE_SPAWN_PLAYER_CLEAR: 300,
      SPAWN_TREE_CLEAR: 54,
      ELITE_SPAWN_TREE_CLEAR: 74,
      SPAWN_ENEMY_CLEAR: 34,
      ELITE_SPAWN_ENEMY_CLEAR: 54,
      SPAWN_ATTEMPTS: 5000,
      SEPARATION_PADDING: 1,
      CONTACT_PUSH: 120          // 接触后的反向推动力
    },

    PATROL: {
      WAIT_MIN: 0.35,
      WAIT_MAX: 1.15,
      TIME_MIN: 2.0,
      TIME_MAX: 4.5,
      POINT_MARGIN: 48,
      SAMPLE_ATTEMPTS: 24
    },

    // 两个场景之间的传送门
    PORTAL: {
      FOREST: { x: 1172, y: 352, w: 64, h: 96 }, // 旧版本入口位置（房间系统已改走上下门）
      BOSS: { x: 600, y: 716, w: 80, h: 54 },    // Boss 房底部：返回普通房间
      CLEAR_RADIUS: 112,                         // 普通房间摆放树木/小怪时避开传送门
      COOLDOWN: 1.0,                             // 防止刚传送就立刻被反向触发
      HINT_COOLDOWN: 1.5,                        // “先清理所有敌人”提示的重复间隔
      OPEN_TIME: 0.6                             // 清怪后的开门动画时长
    },

    // Boss 树妖
    BOSS: {
      SPAWN_X: 820,
      SPAWN_Y: 400,
      ENTRY_X: 640,              // 进入 Boss 房时玩家出现的位置
      ENTRY_Y: 700,
      MAX_HP: 100,
      PHASE_TWO_HP: 70,          // 100~70 为一阶段，70~30 为二阶段
      PHASE_THREE_HP: 30,        // 30~0 为三阶段狂暴
      BASE_SPEED_RATIO: 0.40,    // 一阶段起始移速 = 玩家速度 × 40%
      PHASE_ONE_END_SPEED_RATIO: 0.50,   // 一阶段末尾缓慢提升到 50%
      PHASE_TWO_END_SPEED_RATIO: 0.80,   // 二阶段持续加速到 80%
      MAX_SPEED_RATIO: 0.80,     // 移速硬上限 = 玩家速度 × 80%
      CONTACT_HALF: 20,          // 即死碰撞框（40×40，显著小于 96×96 视觉）
      CONTACT_RECOIL_TIME: 0.25, // 命中玩家后的停顿后摇
      CONTACT_RECOIL_DISTANCE: 10, // 命中后的轻微后退
      ORB_HALF: 42,              // 法球命中框，比接触框略大
      TREE_HIT_HALF: 42,         // 被倒下树的矩形命中的体型
      CONTACT_DAMAGE: 10,
      CONTACT_COOLDOWN: 1.0,     // Boss 对同一玩家的碰撞伤害冷却
      STUN_TIME: 0.3,            // 被倒树砸中后的硬直
      HIT_FLASH_TIME: 0.18,      // 受击白闪时长
      TREE_DAMAGE: 20,           // 倒树砸中 Boss 的伤害
      DEATH_TIME: 1.4,           // 死亡动画时长
      STEP_INTERVAL: 0.36,       // 移动时的脚步震动间隔
      AVOID_TIME: 0.65,          // 被树/墙挡住后持续侧向绕行的时间
      AVOID_SPEED_RATIO: 0.95,   // 绕行时的速度比例
      TREE_BREAK_TIME: 1.5,      // 同一棵树持续阻挡超过该时长后，Boss 将其撞碎
      TREE_BREAK_RANGE: 170,     // 判定“仍在与这棵树纠缠”的距离
      TREE_BREAK_LOOKAHEAD: 52,  // 检测前方阻挡树的探测距离
      TREE_BREAK_PAUSE: 0.2,     // 撞碎树后的短暂停顿

      FIRST_TREE_TIME: 2.0,      // Boss 房开局第一棵预警树的出现时间
      TREE_INTERVAL_PHASE1: 6.0, // 一阶段每 6 秒生成一棵
      TREE_INTERVAL_PHASE2: 4.0, // 二阶段每 4 秒生成一棵
      TREE_INTERVAL_PHASE3: 3.0, // 三阶段每 3 秒生成一棵
      TREE_WARN_TIME: 1.2,       // 红光预警阶段，至少 1 秒
      MAX_WARNING_TREES: 2,      // 同时最多 2 棵处于红光预警的树

      // 三阶段狂暴法球
      PHASE3_ORB_INTERVAL: 1.6,
      PHASE3_ORB_INITIAL_DELAY: 0.9,
      PHASE3_ORB_DAMAGE: 4,
      PHASE3_ORB_SPEED: 270,
      PHASE3_ORB_RADIUS: 6,
      PHASE3_ORB_TREE_DAMAGE: 1,
      PHASE3_ORB_MUZZLE: 36,

      // Boss 房初始化时固定的四棵完全成长掩体树（普通树，可砍伐）
      INITIAL_TREES: [
        { x: 420, y: 260 },
        { x: 1000, y: 260 },
        { x: 300, y: 560 },
        { x: 840, y: 560 }
      ],
      TREE_WARN_RADIUS: 32,      // 预警伤害范围
      MAX_TREES: 5,              // Boss 生成树同时存在上限（不含 4 棵初始掩体）
      TREE_SPAWN_MARGIN: 78,     // 离墙距离
      TREE_SPAWN_PLAYER_CLEAR: 76,
      TREE_SPAWN_BOSS_CLEAR: 110,
      TREE_SPAWN_TREE_CLEAR: 78,
      TREE_SPAWN_EXIT_CLEAR: 100,
      TREE_SPAWN_ATTEMPTS: 60
    },

    // 房间进入保护
    ROOM: {
      ENTRY_PROTECTION_TIME: 1.5
    },

    // 第二层 Boss：沼泽巨蛙
    FROG_BOSS: {
      MAX_HP: 150,
      CONTACT_DAMAGE: 4,
      CONTACT_HALF: 28,
      SPAWN_X: 640,
      SPAWN_Y: 300,
      CRAWL_SPEED: 38,
      AI_DECISION_INTERVAL: 2.0,
      INITIAL_ATTACK_DELAY: 2.0,
      POST_SKILL_COOLDOWN: 1.0,
      ENRAGE_COOLDOWN_MULT: 0.9,
      ENRAGE_HP: 50,
      ENRAGE_WARNING_MULT: 0.8,
      ENRAGE_SPEED_MULT: 1.2,
      TONGUE_WARN: 0.5,
      TONGUE_ACTIVE: 0.5,
      TONGUE_RECOVER: 0.8,
      TONGUE_LENGTH: 300,
      TONGUE_WIDTH: 140,
      TONGUE_DAMAGE: 4,
      TONGUE_KNOCKBACK: 520,
      TONGUE_SLOW_DURATION: 2.5,
      TONGUE_SLOW_MULT: 0.62,
      SLAM_WARN: 0.75,
      SLAM_RADIUS: 100,
      SLAM_DAMAGE: 5,
      SLAM_JUMP_TIME: 0.5,
      SLAM_RECOVER: 1.0,
      SLAM_POD_RADIUS: 110,
      SLAM_ORB_COUNT: 8,
      SLAM_ORB_SPEED: 135,
      SLAM_ORB_DAMAGE: 3,
      SLAM_ORB_RADIUS: 6,
      SLAM_ORB_TREE_DAMAGE: 1,
      SLAM_ORB_OFFSET: 42,
      CROSSWAVE_LENGTH: 300,
      CROSSWAVE_WIDTH: 40,
      CROSSWAVE_DURATION: 0.55,
      CROSSWAVE_DAMAGE: 4,
      CHAIN_TONGUE_WARN: 0.3,
      DEATH_TIME: 1.4,
      HIT_FLASH_TIME: 0.16
    },

    // 第三层 Boss：深渊沙虫
    SANDWORM_BOSS: {
      MAX_HP: 150,
      CONTACT_DAMAGE: 5,
      CONTACT_HALF: 44,
      SPAWN_X: 640,
      SPAWN_Y: 420,
      TRACK_SPEED: 260,
      ENRAGE_TRACK_MULT: 1.2,
      TRACK_TIME: 1.4,
      WARN_RADIUS: 120,
      WARN_TIME: 1.0,
      ERUPT_DAMAGE: 6,
      ERUPT_KNOCKBACK: 560,
      EXPOSED_TIME: 1.5,
      SANDSTORM_COUNT: 5,
      SANDSTORM_DAMAGE: 4,
      SANDSTORM_SPEED: 240,
      SANDSTORM_SPREAD: 0.24,
      SANDSTORM_RADIUS: 6,
      SANDSTORM_TREE_DAMAGE: 1,
      SANDSTORM_TIME: 0.65,
      ENRAGE_HP: 50,
      QUICKSAND_COUNT: 2,
      QUICKSAND_RADIUS_MIN: 65,
      QUICKSAND_RADIUS_MAX: 90,
      QUICKSAND_MAX_PITS: 12,
      CACTUS_HIT_RADIUS: 95,
      DEATH_TIME: 1.6,
      HIT_FLASH_TIME: 0.16
    },

    EVIL_MAGE_BOSS: {
      MAX_HP: 400,
      CONTACT_DAMAGE: 6,
      CONTACT_HALF: 38,
      MOVE_SPEED: 78,
      ORB_INTERVAL: 6.0,
      ORB_CAST_TIME: 0.5,
      ORB_SPEED: 82,
      ORB_DAMAGE: 5,
      ORB_LIFE: 5,
      SCATTER_INTERVAL: 2.5,
      SCATTER_CAST_TIME: 0.3,
      SCATTER_COUNT: 5,
      SCATTER_SPREAD: 0.16,
      SCATTER_SPEED: 175,
      SCATTER_DAMAGE: 3,
      SCATTER_LIFE: 4.5,
      SCATTER_RADIUS: 7,
      GHOST_MIN_DISTANCE: 220,
      GHOST_MAX_DISTANCE: 360,
      TELEPORT_TRIGGER_RANGE: 150,
      TELEPORT_CAST_TIME: 0.5,
      TELEPORT_MIN_DISTANCE: 200,
      TELEPORT_MAX_DISTANCE: 300,
      TELEPORT_COOLDOWN: 6,
      TELEPORT_INTERVAL: 8,
      TELEPORT_DISTANCE: 250,
      TELEPORT_REAPPEAR_TIME: 0.5,
      RAY_WARN_TIME: 0.8,
      RAY_LENGTH: 400,
      RAY_WIDTH: 40,
      RAY_DAMAGE: 8,
      RAY_ACTIVE_TIME: 0.25,
      DEATH_TIME: 1.8
    },

    ABYSS_WHALE: {
      MAX_HP: 450,
      CONTACT_DAMAGE: 6,
      CONTACT_HALF: 70,
      MOVE_SPEED: 18,
      COLUMN_WIDTH: 120,
      COLUMN_LENGTH: 1000,
      COLUMN_WARN_TIME: 1.5,
      COLUMN_DURATION: 5,
      COLUMN_COOLDOWN: 8,
      COLUMN_DAMAGE: 5,
      WAVE_COUNT: 5,
      WAVE_WARN_TIME: 1.0,
      WAVE_SPEED: 380,
      WAVE_WIDTH: 140,
      WAVE_HEIGHT: 58,
      WAVE_DAMAGE: 4,
      WAVE_SLOW_DURATION: 1.2,
      WAVE_SLOW_MULT: 0.7,
      WAVE_COOLDOWN: 9,
      GRAVITY_DURATION: 3,
      GRAVITY_COOLDOWN: 11,
      GRAVITY_PULL: 95,
      SLAM_WARN_TIME: 1.2,
      SLAM_RADIUS: 200,
      SLAM_DAMAGE: 8,
      SLAM_STUN: 2.0,
      SLAM_ORB_COUNT: 8,
      SLAM_ORB_SPEED: 130,
      SLAM_ORB_DAMAGE: 3,
      SLAM_ORB_LIFE: 5,
      SLAM_COOLDOWN: 12,
      DEATH_TIME: 2.2
    },

    LAVA_DRAGON: {
      MAX_HP: 350,
      CONTACT_DAMAGE: 6,
      CONTACT_HALF: 46,
      VISUAL_SIZE: 200,
      RENDER_SIZE: 200,
      MOUTH_OFFSET_Y: 20,
      BREATH_AMPLITUDE: 3,
      SPAWN_X: 640,
      SPAWN_Y: 300,
      MOVE_SPEED: 34,
      BREATH_RANGE: 420,
      BREATH_HALF_ANGLE: Math.PI / 4,
      BREATH_WINDUP: 1,
      BREATH_ACTIVE: 0.55,
      BREATH_COOLDOWN: 4.4,
      BREATH_DAMAGE: 5,
      BURN_DURATION: 2,
      BURN_DPS: 2,
      TAIL_RANGE: 170,
      TAIL_TRIGGER_RANGE: 132,
      TAIL_WINDUP: 0.8,
      TAIL_COOLDOWN: 5,
      TAIL_DAMAGE: 8,
      TAIL_STUN: 1.5,
      TAIL_SPIN_TIME: 0.38,
      INFERNO_THRESHOLD: 0.5,
      INFERNO_COOLDOWN: 12,
      INFERNO_WARNING: 1.5,
      INFERNO_MIN_CIRCLES: 10,
      INFERNO_MAX_CIRCLES: 15,
      INFERNO_RADIUS_MIN: 78,
      INFERNO_RADIUS_MAX: 116,
      INFERNO_DAMAGE: 6,
      INFERNO_STUN: 2,
      INFERNO_SLAM_TIME: 0.4,
      DEATH_TIME: 2.0
    },

    SNOWMAN_BOSS: {
      MAX_HP: 180,
      CONTACT_DAMAGE: 5,
      CONTACT_HALF: 50,
      SPAWN_X: 640,
      SPAWN_Y: 300,
      BLIZZARD_INTERVAL: 10,
      BLIZZARD_ENRAGED_INTERVAL: 7,
      BLIZZARD_DURATION: 3,
      BLIZZARD_COLD_PER_SECOND: 20,
      ICE_INTERVAL: 4.2,
      ICE_ENRAGED_INTERVAL: 3.2,
      ICE_COUNT: 5,
      ICE_ENRAGED_COUNT: 7,
      ICE_DAMAGE: 3,
      ICE_SPEED: 270,
      ICE_SPREAD: 0.22,
      ICE_RADIUS: 6,
      ICE_COLD: 10,
      SLAM_COOLDOWN: 15,
      FIRE_RESPAWN_TIME: 8,
      SLAM_WARN_TIME: 0.8,
      SLAM_JUMP_TIME: 0.4,
      SLAM_JUMP_HEIGHT: 92,
      SLAM_JUMP_SCALE: 1.2,
      SLAM_SHOCKWAVE_TIME: 0.5,
      SLAM_RADIUS: 130,
      SLAM_DAMAGE: 6,
      SLAM_STUN_TIME: 2.0,
      ENRAGE_HP: 90,
      DEATH_TIME: 1.6,
      HIT_FLASH_TIME: 0.16
    },

    FX: {
      MAX_PARTICLES: 280,
      SHAKE_DECAY: 6,
      AMBIENT_COUNT: 12
    },

    // 绘制尺寸/展示尺寸也集中放置，避免渲染函数里出现难以调整的魔法数
    DRAW: {
      TREE_CANOPY_W: 42,
      TREE_CANOPY_H: 40,
      TREE_HP_BAR_W: 32,
      PLAYER_HP_BAR_H: 0,
      SHADOW_ALPHA: 0.32
    }
  };

  // 怪物原型表：
  // 扩展点：后续加入 Boss 时，只需在此新增配置，
  // 然后通过 game.spawnEnemyByType('boss', x, y) 生成即可。
  const ENEMY_ARCHETYPES = {
    grunt: {
      id: 'grunt',
      label: '赤棘小妖',
      isElite: false,
      hp: 1,
      radius: 9,
      contactDamage: 4,
      speedPatrol: 82,
      speedChase: 150,
      detectRadius: 230,
      loseRadius: 340,
      chaseMaxTime: 4.5,        // 短暂追击的最长时间
      loseTime: 2.0,            // 脱战 2 秒后返回巡逻
      chaseCooldown: 1.4,       // 放弃追击后的冷静时间
      colors: {
        outline: '#381018',
        body: '#c83b35',
        bodyDark: '#8c2427',
        bodyLight: '#ef6550',
        horn: '#f1c48a',
        eye: '#ffe58a',
        eyeChase: '#fff0a6',
        mouth: '#4b1116',
        shadow: 'rgba(0,0,0,.30)'
      }
    },
    elite: {
      id: 'elite',
      label: '紫棘精英',
      isElite: true,
      hp: 5,
      radius: 16,               // 碰撞体约 32×32
      contactDamage: 4,
      speedPatrol: 58,
      speedChase: 112,
      detectRadius: 270,
      loseRadius: 380,
      chaseDurationMin: 1.0,    // 发现玩家后只追击 1~2 秒
      chaseDurationMax: 2.0,
      loseTime: 2.0,
      chaseCooldown: 2.0,
      patrolMode: 'horizontal', // 默认左右巡逻
      patrolRange: 150,
      ranged: {
        interval: 2.0,          // 每 2 秒发射一颗敌方法球
        initialDelayMin: 1.2,
        initialDelayMax: 2.0,
        speed: 300,
        radius: 5,
        damage: 4,
        treeDamage: 1
      },
      colors: {
        outline: '#190f2b',
        body: '#7040a8',
        bodyDark: '#432565',
        bodyLight: '#b17aea',
        cloth: '#552e83',
        horn: '#e7c78d',
        eye: '#f6dcff',
        eyeChase: '#ffb8ff',
        mouth: '#2a103a',
        shadow: 'rgba(0,0,0,.34)',
        hpBack: '#160d20',
        hpFill: '#b56cf0'
      }
    },

    swampFly: {
      id: 'swampFly',
      label: '剧毒飞虫',
      isElite: false,
      hp: 1,
      radius: 8,
      contactDamage: 3,
      speedPatrol: 82,
      speedChase: 205,
      detectRadius: 285,
      loseRadius: 430,
      chaseMaxTime: 999,
      loseTime: 1.5,
      chaseCooldown: 0.35,
      ignoreChaseLimit: true,
      poisonImmune: true,
      colors: {
        outline: '#102818',
        body: '#5dbb52',
        bodyDark: '#2e713c',
        bodyLight: '#b9f77f',
        wing: 'rgba(183, 140, 255, .72)',
        wingDark: 'rgba(91, 58, 133, .7)',
        eye: '#efffbe',
        eyeChase: '#ffffff',
        stinger: '#b479ff',
        shadow: 'rgba(0,0,0,.26)'
      }
    },

    mireLurker: {
      id: 'mireLurker',
      label: '泥沼潜伏者',
      isElite: true,
      hp: 8,
      radius: 17,
      contactDamage: 4,
      speedPatrol: 55,
      speedChase: 95,
      detectRadius: 265,
      loseRadius: 395,
      chaseDurationMin: 1.5,
      chaseDurationMax: 3.0,
      loseTime: 2.0,
      chaseCooldown: 1.8,
      patrolMode: 'horizontal',
      patrolRange: 125,
      ranged: {
        interval: 3.0,
        initialDelayMin: 1.5,
        initialDelayMax: 2.5,
        speed: 240,
        radius: 6,
        damage: 3,
        treeDamage: 1,
        count: 3,
        spread: 0.28
      },
      deathPoison: {
        radius: 72,
        duration: 5.0
      },
      colors: {
        outline: '#1d1a10',
        body: '#6f7e39',
        bodyDark: '#3e4b26',
        bodyLight: '#b6c46a',
        muck: '#59406f',
        muckLight: '#9b6fbd',
        eye: '#e9ff9e',
        eyeChase: '#fffbd0',
        mouth: '#20150e',
        shadow: 'rgba(0,0,0,.36)',
        hpBack: '#17130f',
        hpFill: '#a7d95f'
      }
    },

    mummy: {
      id: 'mummy',
      label: '诅咒木乃伊',
      isElite: false,
      hp: 2,
      radius: 11,
      contactDamage: 3,
      speedPatrol: 48,
      speedChase: 105,
      detectRadius: 270,
      loseRadius: 380,
      chaseMaxTime: 999,
      loseTime: 1.7,
      chaseCooldown: 0.6,
      ignoreChaseLimit: true,
      quicksandImmune: true,
      deathCurse: {
        chance: 0.3,
        radius: 58,
        duration: 5.0,
        slowMultiplier: 0.65
      },
      colors: {
        outline: '#2a2118',
        bandage: '#cbbd9a',
        bandageDark: '#98886b',
        bandageLight: '#efe4c4',
        wrap: '#6f5e46',
        eye: '#67ff8b',
        eyeChase: '#c8ffd3',
        shadow: 'rgba(0,0,0,.30)'
      }
    },

    scorpion: {
      id: 'scorpion',
      label: '沙漠巨蝎',
      isElite: true,
      hp: 8,
      radius: 18,
      contactDamage: 4,
      speedPatrol: 52,
      speedChase: 100,
      detectRadius: 300,
      loseRadius: 420,
      chaseMaxTime: 999,
      loseTime: 2.0,
      chaseCooldown: 1.2,
      patrolMode: 'horizontal',
      patrolRange: 130,
      ranged: {
        interval: 3.0,
        initialDelayMin: 1.4,
        initialDelayMax: 2.2,
        speed: 260,
        radius: 6,
        damage: 3,
        treeDamage: 1,
        count: 3,
        spread: 0.30
      },
      burrow: {
        minRange: 220,
        hiddenTime: 1.0,
        warnTime: 0.5,
        radius: 80,
        damage: 4,
        cooldown: 4.2
      },
      colors: {
        outline: '#24150e',
        body: '#6b442e',
        bodyDark: '#442b1d',
        bodyLight: '#a87646',
        claw: '#7b4a2d',
        clawLight: '#c28a52',
        tail: '#d24a43',
        tailLight: '#ff8b70',
        eye: '#ffe27a',
        eyeChase: '#fff7bd',
        shadow: 'rgba(0,0,0,.36)',
        hpBack: '#1c100a',
        hpFill: '#e0a55c'
      }
    },

    snowman: {
      id: 'snowman',
      label: '雪人',
      isElite: false,
      hp: 3,
      radius: 13,
      contactDamage: 4,
      speedPatrol: 46,
      speedChase: 100,
      detectRadius: 285,
      loseRadius: 405,
      chaseMaxTime: 999,
      loseTime: 1.6,
      chaseCooldown: 0.5,
      contactSlow: {
        duration: 1.0,
        multiplier: 0.55
      },
      ranged: {
        interval: 2.2,
        initialDelayMin: 1.1,
        initialDelayMax: 1.8,
        speed: 225,
        radius: 7,
        damage: 2,
        treeDamage: 1,
        count: 1,
        spread: 0,
        cold: 15,
        minRange: 175
      },
      colors: {
        outline: '#2c3a45',
        snow: '#f4fbff',
        snowDark: '#c8dce8',
        snowShade: '#9eb8c8',
        arm: '#6f5239',
        nose: '#e6933f',
        eye: '#26313a',
        scarf: '#6e9fc1',
        shadow: 'rgba(31, 56, 70, .28)',
        hpBack: '#11212a',
        hpFill: '#d9f2ff'
      }
    },

    giantYeti: {
      id: 'giantYeti',
      label: '巨型雪怪',
      isElite: true,
      hp: 10,
      radius: 23,
      contactDamage: 5,
      speedPatrol: 38,
      speedChase: 72,
      detectRadius: 285,
      loseRadius: 405,
      chaseMaxTime: 999,
      loseTime: 2.0,
      chaseCooldown: 1.0,
      slam: {
        warnTime: 0.6,
        jumpTime: 0.4,
        stunTime: 0.8,
        jumpHeight: 58,
        jumpScale: 1.2,
        radius: 88,
        damage: 4,
        cold: 30,
        slowDuration: 1.0,
        slowMultiplier: 0.55,
        cooldown: 3.6
      },
      colors: {
        outline: '#23333e',
        fur: '#dcecf5',
        furDark: '#a8c2d2',
        furShade: '#7f9cac',
        face: '#eef9ff',
        eye: '#263744',
        horn: '#8da6b3',
        claw: '#6f8794',
        shadow: 'rgba(29, 51, 64, .32)',
        hpBack: '#0d1b24',
        hpFill: '#a9d9f2'
      }
    },

    // 第七层专属小怪：狂暴食人鱼
    piranha: {
      id: 'piranha',
      label: '狂暴食人鱼',
      isElite: false,
      hp: 2,
      radius: 10,
      contactDamage: 3,
      speedPatrol: 105,
      speedChase: 220,
      detectRadius: 320,
      loseRadius: 480,
      chaseMaxTime: 999,
      loseTime: 1.5,
      chaseCooldown: 0.4,
      dash: {
        interval: 3.0,
        windup: 0.5,
        speed: 600,
        duration: 0.25,
        stun: 1.0
      },
      colors: {
        outline: '#071a29',
        body: '#3f8fb8',
        bodyDark: '#1d4e70',
        bodyLight: '#8fd8ef',
        fin: '#dbeff6',
        eye: '#fff1a8',
        shadow: 'rgba(0,0,0,.28)'
      }
    },

    // 第七层专属精英：深海章鱼
    octopus: {
      id: 'octopus',
      label: '深海章鱼',
      isElite: true,
      hp: 10,
      radius: 25,
      contactDamage: 4,
      speedPatrol: 30,
      speedChase: 48,
      detectRadius: 310,
      loseRadius: 470,
      chaseMaxTime: 999,
      loseTime: 2.2,
      chaseCooldown: 1.2,
      ink: {
        threshold: 5,
        poolLife: 5,
        blindTime: 3,
        blobCount: 8
      },
      colors: {
        outline: '#100a18',
        body: '#4b2b6b',
        bodyDark: '#28143c',
        bodyLight: '#8b5caf',
        suckers: '#c9a6df',
        eye: '#ffcf63',
        ink: '#16101d',
        shadow: 'rgba(0,0,0,.40)'
      }
    },

    // 第六层专属小怪：重组骷髅
    skeleton: {
      id: 'skeleton',
      label: '重组骷髅',
      isElite: false,
      hp: 2,
      radius: 10,
      contactDamage: 4,
      speedPatrol: 58,
      speedChase: 108,
      detectRadius: 300,
      loseRadius: 440,
      chaseMaxTime: 999,
      loseTime: 1.6,
      chaseCooldown: 0.5,
      reviveTime: 2.5,
      colors: {
        outline: '#1d1820',
        bone: '#d8d3c2',
        boneDark: '#8e897c',
        boneLight: '#f1ede0',
        eye: '#b26cff',
        shadow: 'rgba(0,0,0,.34)'
      }
    },

    // 第六层专属精英：深渊行刑者
    executioner: {
      id: 'executioner',
      label: '深渊行刑者',
      isElite: true,
      hp: 15,
      radius: 27,
      contactDamage: 5,
      speedPatrol: 26,
      speedChase: 42,
      detectRadius: 320,
      loseRadius: 480,
      chaseMaxTime: 999,
      loseTime: 2.2,
      chaseCooldown: 1.0,
      spikeImmune: true,
      hook: {
        cooldown: 6,
        speed: 300,
        damage: 2,
        maxDistance: 430,
        pullTime: 0.5
      },
      slam: {
        triggerRange: 190,
        warnTime: 1.2,
        range: 180,
        halfAngle: Math.PI / 4,
        damage: 8,
        stunTime: 1
      },
      colors: {
        outline: '#0c0b0f',
        body: '#3a3942',
        bodyDark: '#1c1b22',
        bodyLight: '#77747f',
        metal: '#8e8a94',
        chain: '#6e1712',
        eye: '#ff5a4f',
        shadow: 'rgba(0,0,0,.45)',
        hpBack: '#0b0a0e',
        hpFill: '#9a94a4'
      }
    },

    // 第五层专属小怪：炎爆火灵
    fireSpirit: {
      id: 'fireSpirit',
      label: '炎爆火灵',
      isElite: false,
      hp: 3,
      radius: 11,
      contactDamage: 3,
      speedPatrol: 92,
      speedChase: 170,
      detectRadius: 310,
      loseRadius: 460,
      chaseMaxTime: 999,
      loseTime: 1.4,
      chaseCooldown: 0.3,
      deathBomb: {
        warnTime: 0.6,
        radius: 72,
        damage: 4
      },
      colors: {
        outline: '#4b1008',
        body: '#ff5a22',
        bodyDark: '#b72a10',
        bodyLight: '#ffcf63',
        eye: '#fff3c4',
        shadow: 'rgba(0,0,0,.32)'
      }
    },

    // 第五层专属精英：熔岩巨像
    lavaGolem: {
      id: 'lavaGolem',
      label: '熔岩巨像',
      isElite: true,
      hp: 12,
      radius: 24,
      contactDamage: 5,
      speedPatrol: 18,
      speedChase: 28,
      detectRadius: 300,
      loseRadius: 460,
      chaseMaxTime: 999,
      loseTime: 2.2,
      chaseCooldown: 1.0,
      lavaBall: {
        interval: 3.0,
        speed: 175,
        radius: 9,
        damage: 4,
        maxDistance: 540,
        poolRadius: 28,
        poolDuration: 5.0
      },
      colors: {
        outline: '#1b0707',
        body: '#6e1712',
        bodyDark: '#3d0b0a',
        bodyLight: '#b92f1c',
        crack: '#ff6a28',
        eye: '#ffd166',
        shadow: 'rgba(0,0,0,.40)',
        hpBack: '#1c0606',
        hpFill: '#ff6a28'
      }
    }
  };

  const PALETTE = {
    outside: '#050d08',
    floorA: '#123b28',
    floorB: '#16432c',
    floorLine: '#0f3422',
    floorSpeck: '#1d5535',
    floorDark: '#0b2b1d',
    wall: '#33402f',
    wallDark: '#1a231b',
    wallLight: '#556348',
    wallMoss: '#3d6239',
    wallSeam: '#11180f',
    wallInnerShadow: 'rgba(0, 0, 0, .42)',
    wallInnerEdge: 'rgba(188, 215, 150, .16)',

    bossFloorA: '#261512',
    bossFloorB: '#2d1a15',
    bossFloorLine: '#190d0a',
    bossFloorRoot: '#4b2619',
    bossFloorGlow: 'rgba(156, 67, 37, .14)',

    portalFrame: '#2a231d',
    portalFrameLight: '#5e503f',
    portalDark: '#07050a',
    portalPurple: '#7d43c4',
    portalPurpleLight: '#c58cff',
    portalGreen: '#6aa763',

    bossShadow: 'rgba(0, 0, 0, .42)',
    bossOutline: '#190c07',
    bossBarkDark: '#4a2712',
    bossBark: '#71431e',
    bossBarkLight: '#a9753b',
    bossBarkHi: '#c69655',
    bossLeafDark: '#34461f',
    bossLeaf: '#5d7430',
    bossLeafLight: '#8b9c48',
    bossEye: '#ff8a3c',
    bossEyeGlow: '#ffc072',
    bossMouth: '#2b100b',
    bossWarning: '#ff5348',
    bossWarningDark: '#5e1813',

    treeShadow: 'rgba(2, 12, 7, .36)',
    treeLine: '#092015',
    treeTrunkDark: '#3b2414',
    treeTrunk: '#674022',
    treeTrunkLight: '#92613a',
    treeCanopyDark: '#0c3520',
    treeCanopyMid: '#176b39',
    treeCanopyLight: '#2e8d4b',
    treeCanopyHi: '#64b963',
    treeLeaf: '#84cf6c',
    treeHpBack: '#101a0e',
    treeHpFill: '#d7b04c',

    playerOutline: '#08182e',
    playerDark: '#15366e',
    playerBlue: '#2f6dd1',
    playerLight: '#69a5ff',
    playerSkin: '#efc28d',
    playerSkinShade: '#c98f63',
    playerEye: '#07152b',
    playerScarf: '#58c7d7',
    playerBoot: '#10213f',
    muzzle: '#fff6b0',

    orbPlayer: {
      dark: '#b36a17', mid: '#ffc12e', light: '#ffe973', core: '#fffbe0',
      glow: 'rgba(255, 223, 100, .13)'
    },
    orbEnemy: {
      dark: '#4a1670', mid: '#9b4de0', light: '#c892ff', core: '#f3e2ff',
      glow: 'rgba(166, 90, 255, .16)'
    },

    hpRed: '#d4523e',
    leafColors: ['#2e8d4b', '#64b963', '#176b39', '#92613a', '#c99b57'],
    sparkColors: ['#fff6b0', '#ffc12e', '#e98b30'],
    enemyOrbSpark: ['#c892ff', '#9b4de0', '#f3e2ff'],
    bloodColors: ['#c83b35', '#8c2427', '#ef6550'],
    eliteBlood: ['#b56cf0', '#7040a8', '#f3e2ff'],
    dustColors: ['#7b8a62', '#596a49', '#a0a37a']
  };

  // ============================================================
  // 多层爬塔数据：Level1 为当前森林层，Level2 为占位层
  // ============================================================
  const LEVELS = {
    Level1: {
      id: 1,
      key: 'Level1',
      name: '林间试炼',
      layerName: '第一层',
      themeName: 'forest',
      enemyTypes: ['grunt', 'elite'],
      boss: {
        type: 'treeSpirit',
        name: '树妖',
        maxHp: CFG.BOSS.MAX_HP
      },
      roomPlan: ['spawn', 'combat', 'combat', 'boss'],
      theme: {
        outside: '#050d08',
        floor: {
          a: PALETTE.floorA,
          b: PALETTE.floorB,
          line: PALETTE.floorLine,
          spawnMark: 'rgba(8, 25, 15, .20)',
          grass: ['#245f3a', '#2b7145', '#398657'],
          flower: '#e8d26b',
          flowerCenter: '#e8f2cf',
          stone: '#4c5a45',
          stoneLight: '#647257',
          leaf: '#6e4b2b'
        },
        wall: {
          dark: PALETTE.wallDark,
          topA: PALETTE.wall,
          topB: '#2b3729',
          topLight: PALETTE.wallLight,
          seam: PALETTE.wallSeam,
          moss: PALETTE.wallMoss,
          bottomA: '#2a3528',
          bottomB: PALETTE.wall,
          bottomLight: '#45533c',
          leftA: '#2c382b',
          leftB: '#263126',
          leftLight: '#495640',
          innerShadow: PALETTE.wallInnerShadow,
          innerEdge: PALETTE.wallInnerEdge
        },
        firefly: {
          rgb: '234, 236, 132',
          glow: 'rgba(240, 232, 150, .10)'
        }
      }
    },

    Level2: {
      id: 2,
      key: 'Level2',
      name: '幽影回廊',
      layerName: '第二层',
      themeName: 'crypt',
      placeholder: true,
      enemyTypes: ['swampFly', 'mireLurker'],
      boss: {
        type: 'swampFrog',
        name: '沼泽巨蛙',
        maxHp: 150
      },
      roomPlan: ['spawn', 'combat', 'boss'],
      combatRoomMin: 2,
      combatRoomMax: 3,
      enemyBudget: {
        gruntMin: 14,
        gruntMax: 18,
        eliteMin: 2,
        eliteMax: 3
      },
      spawnZones: [
        { label: '左上', x: 110, y: 170, w: 380, h: 230 },
        { label: '右上', x: 790, y: 170, w: 380, h: 230 },
        { label: '左下', x: 110, y: 440, w: 380, h: 180 },
        { label: '右下', x: 790, y: 440, w: 380, h: 180 }
      ],
      mechanics: {
        poison: {
          countMin: 3,
          countMax: 5,
          radiusMin: 70,
          radiusMax: 95,
          speedMultiplier: 0.70,
          damage: 1,
          tickInterval: 1.0,
          safeRadius: 150,
          corridorHalf: 70
        },
        gasPod: {
          countMin: 5,
          countMax: 8,
          hp: 3,
          radius: 18,
          explosionRadius: 150,
          explosionDamage: 15
        }
      },
      theme: {
        outside: '#04070f',
        floor: {
          a: '#121a2d',
          b: '#17213a',
          line: '#0a0f1d',
          spawnMark: 'rgba(10, 20, 42, .25)',
          grass: ['#2f4a6b', '#3b5c82', '#56749b'],
          flower: '#8cc7ff',
          flowerCenter: '#dff4ff',
          stone: '#3d4a62',
          stoneLight: '#55627a',
          leaf: '#314a66'
        },
        wall: {
          dark: '#171a2a',
          topA: '#2f344b',
          topB: '#282d40',
          topLight: '#59617e',
          seam: '#0b0e18',
          moss: '#3b5b7a',
          bottomA: '#282d40',
          bottomB: '#2f344b',
          bottomLight: '#4b5470',
          leftA: '#2a2f45',
          leftB: '#23283a',
          leftLight: '#4c5672',
          innerShadow: 'rgba(0, 0, 0, .50)',
          innerEdge: 'rgba(160, 190, 255, .14)'
        },
        firefly: {
          rgb: '126, 180, 255',
          glow: 'rgba(110, 160, 255, .10)'
        }
      }
    },

    Level3: {
      id: 3,
      key: 'Level3',
      name: '流沙荒漠',
      layerName: '第三层',
      themeName: 'desert',
      placeholder: true,
      enemyTypes: ['mummy', 'scorpion'],
      boss: {
        type: 'sandworm',
        name: '深渊沙虫',
        maxHp: 150
      },
      roomPlan: ['spawn', 'combat', 'boss'],
      combatRoomMin: 2,
      combatRoomMax: 3,
      enemyBudget: {
        gruntMin: 12,
        gruntMax: 16,
        eliteMin: 2,
        eliteMax: 3
      },
      spawnZones: [
        { label: '左上', x: 110, y: 170, w: 380, h: 230 },
        { label: '右上', x: 790, y: 170, w: 380, h: 230 },
        { label: '左下', x: 110, y: 440, w: 380, h: 180 },
        { label: '右下', x: 790, y: 440, w: 380, h: 180 }
      ],
      mechanics: {
        quicksand: {
          countMin: 3,
          countMax: 5,
          radiusMin: 70,
          radiusMax: 95,
          speedMultiplier: 0.5,
          pullSpeed: 55,
          sinkTime: 1.5,
          rootDuration: 0.5,
          damage: 2,
          ejectExtra: 34,
          safeRadius: 150,
          corridorHalf: 70
        },
        cactus: {
          countMin: 5,
          countMax: 8,
          hp: 5,
          radius: 18,
          spikeCount: 8,
          spikeDamage: 4,
          spikeSpeed: 240,
          spikeLife: 1.8,
          spikeRadius: 6
        }
      },
      theme: {
        outside: '#1b1207',
        floor: {
          a: '#c9a24f',
          b: '#c19945',
          line: '#a87d35',
          spawnMark: 'rgba(80, 52, 20, .18)',
          grass: ['#9a7a3c', '#ad8a45', '#c7a153'],
          flower: '#f2ce6a',
          flowerCenter: '#fff0b0',
          stone: '#8b6b45',
          stoneLight: '#a98555',
          leaf: '#9c6e32'
        },
        wall: {
          dark: '#5b4226',
          topA: '#a87c42',
          topB: '#98703a',
          topLight: '#d5ab67',
          seam: '#4a3218',
          moss: '#8f6b34',
          bottomA: '#8d6535',
          bottomB: '#a57a40',
          bottomLight: '#c99a58',
          leftA: '#986f3b',
          leftB: '#896334',
          leftLight: '#c69a5c',
          innerShadow: 'rgba(43, 26, 8, .52)',
          innerEdge: 'rgba(255, 220, 150, .14)'
        },
        firefly: {
          rgb: '255, 214, 122',
          glow: 'rgba(255, 200, 100, .10)'
        }
      }
    },

    Level4: {
      id: 4,
      key: 'Level4',
      name: '霜雪回廊',
      layerName: '第四层',
      themeName: 'ice',
      placeholder: true,
      enemyTypes: ['snowman', 'giantYeti'],
      boss: {
        type: 'snowmanChief',
        name: '雪人头目',
        maxHp: 180
      },
      roomPlan: ['spawn', 'combat', 'boss'],
      combatRoomMin: 2,
      combatRoomMax: 3,
      enemyBudget: {
        gruntMin: 8,
        gruntMax: 12,
        eliteMin: 2,
        eliteMax: 3
      },
      spawnZones: [
        { label: '左上', x: 110, y: 170, w: 380, h: 230 },
        { label: '右上', x: 790, y: 170, w: 380, h: 230 },
        { label: '左下', x: 110, y: 440, w: 380, h: 180 },
        { label: '右下', x: 790, y: 440, w: 380, h: 180 }
      ],
      mechanics: {
        cold: {
          max: 100,
          gainPerSecond: 5,
          fireRadius: 150,
          recoverPerSecond: 30,
          damage: 1,
          damageInterval: 1
        },
        campfire: {
          countMin: 2,
          countMax: 3,
          bossCount: 5,
          hp: 3,
          radius: 18,
          safeRadius: 130
        }
      },
      theme: {
        outside: '#a8c2d1',
        floor: {
          a: '#d7e6ed',
          b: '#c5d9e3',
          line: '#aac3d0',
          spawnMark: 'rgba(69, 105, 124, .18)',
          grass: ['#b7d4df', '#c9e0e8', '#e8f3f6'],
          flower: '#f4fbff',
          flowerCenter: '#ffffff',
          stone: '#8faeba',
          stoneLight: '#abc5cf',
          leaf: '#7d9eab'
        },
        wall: {
          dark: '#5b7482',
          topA: '#abc4d0',
          topB: '#96b2c0',
          topLight: '#e9f5f9',
          seam: '#6e8896',
          moss: '#d2e5ec',
          bottomA: '#94b0bd',
          bottomB: '#a9c3cf',
          bottomLight: '#d6e8ef',
          leftA: '#9ab7c4',
          leftB: '#8ba8b6',
          leftLight: '#d0e4ec',
          innerShadow: 'rgba(32, 63, 79, .28)',
          innerEdge: 'rgba(255, 255, 255, .30)'
        },
        firefly: {
          rgb: '235, 247, 255',
          glow: 'rgba(220, 242, 255, .14)'
        }
      }
    },

    Level5: {
      id: 5,
      key: 'Level5',
      name: '神明领域·火山层',
      layerName: '第五层',
      themeName: 'volcano',
      enemyTypes: ['fireSpirit', 'lavaGolem'],
      boss: {
        type: 'lavaDragon',
        name: '熔岩巨龙',
        maxHp: 350
      },
      roomPlan: ['spawn', 'combat', 'boss'],
      combatRoomMin: 2,
      combatRoomMax: 3,
      enemyBudget: {
        gruntMin: 8,
        gruntMax: 10,
        eliteMin: 2,
        eliteMax: 3
      },
      spawnZones: [
        { label: '左上', x: 110, y: 170, w: 380, h: 230 },
        { label: '右上', x: 790, y: 170, w: 380, h: 230 },
        { label: '左下', x: 110, y: 440, w: 380, h: 180 },
        { label: '右下', x: 790, y: 440, w: 380, h: 180 }
      ],
      mechanics: {
        lava: {
          countMin: 3,
          countMax: 5,
          radiusMin: 48,
          radiusMax: 82,
          damage: 1,
          tickInterval: 0.5,
          slowDuration: 1.0,
          slowMultiplier: 0.8,
          safeRadius: 150,
          poolDuration: 5
        },
        obsidianWalls: {
          countMin: 2,
          countMax: 4,
          bossCount: 2,
          safeRadius: 150,
          gap: 22
        }
      },
      theme: {
        outside: '#120405',
        floor: {
          a: '#3a0e0d',
          b: '#2d0908',
          line: '#1e0504',
          spawnMark: 'rgba(255, 104, 53, .13)',
          grass: ['#5a1711', '#741f15', '#9b2e1c'],
          flower: '#ff8844',
          flowerCenter: '#ffd17b',
          stone: '#201114',
          stoneLight: '#3b1a19',
          leaf: '#1b0908'
        },
        wall: {
          dark: '#080304',
          topA: '#24100f',
          topB: '#1a0909',
          topLight: '#55201b',
          seam: '#050202',
          moss: '#4a1510',
          bottomA: '#1f0c0c',
          bottomB: '#140707',
          bottomLight: '#3d1411',
          leftA: '#1c0b0b',
          leftB: '#130707',
          leftLight: '#361211',
          innerShadow: 'rgba(0, 0, 0, .55)',
          innerEdge: 'rgba(255, 94, 52, .16)'
        },
        firefly: {
          rgb: '255, 116, 54',
          glow: 'rgba(255, 76, 28, .16)'
        }
      }
    },

    Level6: {
      id: 6,
      key: 'Level6',
      name: '黑暗地牢',
      layerName: '第六层',
      themeName: 'dungeon',
      enemyTypes: ['skeleton', 'executioner'],
      boss: {
        type: 'evilMage',
        name: '邪恶法师',
        maxHp: 400
      },
      roomPlan: ['spawn', 'combat', 'boss'],
      combatRoomMin: 2,
      combatRoomMax: 3,
      enemyBudget: {
        gruntMin: 8,
        gruntMax: 11,
        eliteMin: 1,
        eliteMax: 2
      },
      spawnZones: [
        { label: '左上', x: 110, y: 170, w: 380, h: 230 },
        { label: '右上', x: 790, y: 170, w: 380, h: 230 },
        { label: '左下', x: 110, y: 440, w: 380, h: 180 },
        { label: '右下', x: 790, y: 440, w: 380, h: 180 }
      ],
      mechanics: {
        spikes: {
          countMin: 3,
          countMax: 5,
          sizeMin: 70,
          sizeMax: 100,
          damage: 3,
          cooldown: 1,
          safeRadius: 150
        },
        darkness: {
          radius: 250,
          alpha: 0.82,
          innerRadius: 90
        }
      },
      theme: {
        outside: '#050507',
        floor: {
          a: '#292a30',
          b: '#202127',
          line: '#15161b',
          spawnMark: 'rgba(117, 92, 160, .12)',
          grass: ['#3b3446', '#4a3d59', '#5a486b'],
          flower: '#8e6bb5',
          flowerCenter: '#c8b4e2',
          stone: '#17171c',
          stoneLight: '#3a3942',
          leaf: '#221b2d'
        },
        wall: {
          dark: '#08070d',
          topA: '#241b30',
          topB: '#1a1424',
          topLight: '#4a3560',
          seam: '#050409',
          moss: '#3a2450',
          bottomA: '#1d1628',
          bottomB: '#130f1c',
          bottomLight: '#34264a',
          leftA: '#1b1527',
          leftB: '#120e1a',
          leftLight: '#302044',
          innerShadow: 'rgba(0, 0, 0, .62)',
          innerEdge: 'rgba(137, 91, 190, .18)'
        },
        firefly: {
          rgb: '162, 126, 220',
          glow: 'rgba(130, 79, 190, .12)'
        }
      }
    },

    Level7: {
      id: 7,
      key: 'Level7',
      name: '深海迷境',
      layerName: '第七层',
      themeName: 'abyss',
      enemyTypes: ['piranha', 'octopus'],
      boss: {
        type: 'abyssWhale',
        name: '深渊巨鲸',
        maxHp: 450
      },
      roomPlan: ['spawn', 'combat', 'boss'],
      combatRoomMin: 2,
      combatRoomMax: 3,
      enemyBudget: {
        gruntMin: 6,
        gruntMax: 8,
        eliteMin: 1,
        eliteMax: 2
      },
      spawnZones: [
        { label: '左上', x: 110, y: 170, w: 380, h: 230 },
        { label: '右上', x: 790, y: 170, w: 380, h: 230 },
        { label: '左下', x: 110, y: 440, w: 380, h: 180 },
        { label: '右下', x: 790, y: 440, w: 380, h: 180 }
      ],
      mechanics: {
        whirlpools: {
          countMin: 2,
          countMax: 4,
          radiusMin: 72,
          radiusMax: 122,
          pull: 58,
          safeRadius: 155
        }
      },
      theme: {
        outside: '#020b17',
        floor: {
          a: '#12314a',
          b: '#0d2439',
          line: '#081727',
          spawnMark: 'rgba(82, 173, 210, .12)',
          grass: ['#1d4b64', '#28647b', '#357e91'],
          flower: '#74d4e8',
          flowerCenter: '#d7fbff',
          stone: '#092033',
          stoneLight: '#244b60',
          leaf: '#123448'
        },
        wall: {
          dark: '#010710',
          topA: '#0e2a42',
          topB: '#091d30',
          topLight: '#2c647f',
          seam: '#020a12',
          moss: '#1e5868',
          bottomA: '#0b2338',
          bottomB: '#061726',
          bottomLight: '#22536b',
          leftA: '#0a2134',
          leftB: '#051521',
          leftLight: '#1d4b63',
          innerShadow: 'rgba(0, 0, 0, .58)',
          innerEdge: 'rgba(94, 208, 235, .18)'
        },
        firefly: {
          rgb: '126, 221, 244',
          glow: 'rgba(70, 190, 230, .13)'
        }
      }
    }
  };

  const WALL_RECTS = [
    { x: 0, y: 0, w: CFG.WORLD.W, h: CFG.WORLD.WALL },
    { x: 0, y: CFG.WORLD.H - CFG.WORLD.WALL, w: CFG.WORLD.W, h: CFG.WORLD.WALL },
    { x: 0, y: 0, w: CFG.WORLD.WALL, h: CFG.WORLD.H },
    { x: CFG.WORLD.W - CFG.WORLD.WALL, y: 0, w: CFG.WORLD.WALL, h: CFG.WORLD.H }
  ];

  global.PF = global.PF || {};
  Object.assign(global.PF, { CFG, ENEMY_ARCHETYPES, PALETTE, WALL_RECTS, LEVELS });
})(window);
