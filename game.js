/* ============================================================
 * game.js — 输入、游戏主循环、碰撞流程、渲染与 HUD
 * 依赖前面加载的所有模块。
 * ============================================================ */
(function (global) {
  'use strict';
  const PF = global.PF;
  const { CFG, PALETTE, WALL_RECTS } = PF;
  const {
    clamp, lerp, distance, easeOutCubic, expandRect, pointInRect,
    aabbOverlap, rayAABB, moveBody, isCircleBlocked
  } = PF;
  const { OrbPool, BossTree, RoomSystems } = PF;

  const GAME_STATES = Object.freeze({
    MENU: 'MENU',
    INTRO: 'INTRO',
    ENDING: 'ENDING',
    PLAYING: 'PLAYING',
    LOADING: 'LOADING',
    DEAD: 'DEAD',
    REWARD: 'REWARD'
  });
  window.GAME_STATES = GAME_STATES;
  window.currentGameState = GAME_STATES.MENU;
  PF.GAME_STATES = GAME_STATES;
  console.log('[GameState] INIT -> MENU');

  const Input = {
    keys: new Set(),
    mouse: {
      x: CFG.WORLD.W * 0.75,
      y: CFG.WORLD.H * 0.5,
      inside: false,
      down: false
    },
    canvas: null,

    init(canvas) {
      this.canvas = canvas;

      window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const code = e.code ||
          (e.key === 'Shift' ? 'ShiftLeft' : e.key === ' ' ? 'Space' : e.key);
        this.keys.add(code);
        if (e.key === 'Shift') this.keys.add('Shift');
        if (e.key === ' ') this.keys.add('Space');
      });

      window.addEventListener('keyup', (e) => {
        this.keys.delete(e.code);
        if (e.key === 'Shift') {
          this.keys.delete('Shift');
          this.keys.delete('ShiftLeft');
          this.keys.delete('ShiftRight');
        }
        if (e.key === ' ') this.keys.delete('Space');
      });

      window.addEventListener('blur', () => {
        this.keys.clear();
        this.mouse.down = false;
      });

      canvas.addEventListener('mousemove', (e) => {
        this.updateMousePosition(e);
      });

      canvas.addEventListener('mouseenter', (e) => {
        this.mouse.inside = true;
        this.updateMousePosition(e);
      });

      canvas.addEventListener('mouseleave', () => {
        this.mouse.inside = false;
      });

      canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this.mouse.down = true;
        this.updateMousePosition(e);
      });

      window.addEventListener('mouseup', (e) => {
        if (e.button === 0) this.mouse.down = false;
      });

      canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.keys.clear();
          this.mouse.down = false;
        }
      });
    },

    updateMousePosition(e) {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = CFG.WORLD.W / rect.width;
      const scaleY = CFG.WORLD.H / rect.height;
      this.mouse.x = clamp((e.clientX - rect.left) * scaleX, 0, CFG.WORLD.W);
      this.mouse.y = clamp((e.clientY - rect.top) * scaleY, 0, CFG.WORLD.H);
      this.mouse.inside =
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
    },

    down(code) {
      return this.keys.has(code);
    }
  };

  PF.Input = Input;

  const enemySpriteSources = {
    skeleton: 'assets/skeleton.png',
    executioner: 'assets/executioner.png'
  };
  const enemyArt = {};

  function removeEnemyWhiteBackground(image) {
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
    if (changed) ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function buildEnemyFlash(source) {
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    return canvas;
  }

  function loadEnemyArt() {
    for (const [type, src] of Object.entries(enemySpriteSources)) {
      const image = new Image();
      const entry = { image, source: null, flash: null, ready: false, failed: false };
      enemyArt[type] = entry;
      image.onload = () => {
        try {
          entry.source = removeEnemyWhiteBackground(image);
          entry.flash = buildEnemyFlash(entry.source);
          entry.ready = true;
        } catch (error) {
          console.warn('[EnemyArt]', type, error);
          entry.failed = true;
        }
      };
      image.onerror = () => { entry.failed = true; };
      image.src = src;
    }
  }

  loadEnemyArt();
  PF.EnemyArt = enemyArt;

  class Game extends RoomSystems {
    constructor() {
      super();
      this.canvas = document.getElementById('gameCanvas');
      this.ctx = this.canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false;

      this.stage = document.getElementById('stage');
      this.overlay = document.getElementById('overlay');
      this.overlayCard = this.overlay.querySelector('.overlay__card');
      this.overlayTitle = document.getElementById('overlayTitle');
      this.overlayHint = document.getElementById('overlayHint');
      this.controlsHint = document.getElementById('controlsHint');
      this.upgradeOverlay = document.getElementById('upgradeOverlay');
      this.upgradeKicker = document.getElementById('upgradeKicker');
      this.upgradeTitle = document.getElementById('upgradeTitle');
      this.upgradeDesc = document.getElementById('upgradeDesc');
      this.rewardOptions = document.getElementById('rewardOptions');
      this.upgradeButtons = Array.from(
        this.upgradeOverlay.querySelectorAll('[data-upgrade]')
      );

      this.hud = {
        levelLabel: document.getElementById('levelLabel'),
        hpFill: document.getElementById('hpFill'),
        hpText: document.getElementById('hpText'),
        orbFill: document.getElementById('orbFill'),
        orbText: document.getElementById('orbText'),
        monsterFill: document.getElementById('monsterFill'),
        monsterText: document.getElementById('monsterText'),
        chaseText: document.getElementById('chaseText'),
        bossHud: document.getElementById('bossHud'),
        bossNameText: document.getElementById('bossNameText'),
        bossRoomText: document.getElementById('bossRoomText'),
        bossMetaLabelA: document.getElementById('bossMetaLabelA'),
        bossMetaLabelB: document.getElementById('bossMetaLabelB'),
        bossFill: document.getElementById('bossFill'),
        bossHpText: document.getElementById('bossHpText'),
        bossTreeText: document.getElementById('bossTreeText'),
        bossSpeedText: document.getElementById('bossSpeedText'),
        bossStateText: document.getElementById('bossStateText'),
        bossDamageText: document.getElementById('bossDamageText')
      };
      this.toast = document.getElementById('toast');

      this.orbs = new OrbPool(CFG.ORB.POOL_SIZE);
      this.particles = [];
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
      this.spikeTrapCooldown = 0;
      this.evilOrbs = [];
      this.evilRays = [];
      this.executionerHooks = [];
      this.whirlpools = [];
      this.ripples = [];
      this.inkPools = [];
      this.rippleTimer = 0;
      this.spikes = [];
      this.gasExplosions = [];
      this.blizzardTimer = 0;
      this.blizzardActive = false;
      this.lavaTickTimer = 0;
      this.divine = { meteorLevel: 0, shadowLevel: 0 };
      this.meteorCooldown = 0;
      this.meteors = [];
      this.meteorFlashTimer = 0;
      this.rollTraps = [];
      this.poisonTickTimer = 0;
      this.quicksandStay = 0;
      this.quicksandSink = 0;
      this.quicksandCooldown = 0;
      this.quicksandSinkZone = null;
      this.enemyAggroLockTimer = 0;
      this.activeChasers = new Set();
      this.decor = [];
      this.fireflies = [];
      this.player = null;
      this.state = 'playing';
      this.scene = 'forest';      // forest | boss
      this.portalCooldown = 0;
      this.portalHintCooldown = 0;
      this.bossDoorUnlocked = false;
      this.bossRoomExitUnlocked = false;
      this.portalOpenProgress = 0;
      this.bossDamagePopupTimer = 0;
      this.toastTimer = 0;
      this.forestTrees = [];
      this.forestEnemies = [];
      this.bossTrees = [];
      this.boss = null;
      this.levelRooms = [];
      this.currentRoomIndex = 0;
      this.currentLevelId = 1;
      this.currentLevel = PF.LEVELS.Level1;
      this.playerBuild = null;
      window.playerBuild = null;
      this.playerUpgrades = {
        maxHpBonus: 0,
        orbDamageBonus: 0,
        shootInterval: CFG.PLAYER.SHOOT_CD,
        orbPierce: 0,
        potionHealBonus: 0,
        frostShield: false,
        weaponType: 'single',
        shotgunCount: CFG.WEAPON.COUNT,
        shotgunSpreadDeg: CFG.WEAPON.SPREAD_DEG,
        weaponPelletDamage: CFG.WEAPON.PELLET_DAMAGE,
        weaponSizeMultiplier: 1,
        weaponTrail: false
      };
      this.rewardChoices = [];
      this.pendingFinalClear = false;
      this.intro = null;
      this.ending = null;
      this.divineWhisper = null;
      this.cinematic = null;
      this.divineIntroPlayed = false;
      this.divineOrb = null;
      this.divineDialog = null;
      this.levelExitPortal = null;
      this.bossCheckpoint = null;
      this.deathInBossRoom = false;
      this.deathRoomIndex = null;
      this.upgradeChoiceOpen = false;
      this.time = 0;
      this.shakeTime = 0;
      this.shakeDuration = 0;
      this.shakeMagnitude = 0;
      this.clearTimer = 0;
      this.initialEnemyCount = 0;
      this.debug = false;         // F1 调试视图
      this.godMode = false;       // G：开发者无敌
      this.pendingLayerId = null;

      Input.init(this.canvas);
      this.bindEvents();
      this.reset();
      this.stage.classList.add('is-menu');
      this.setGameState('MENU', '主菜单');
    }

    startFromMenu() {
      if (window.currentGameState !== GAME_STATES.MENU) return false;
      this.beginIntro();
      return true;
    }

    beginIntro() {
      this.intro = {
        pages: [
          '神明在世界的中心建了一座高塔，传闻，登顶者可以实现任何愿望。',
          '你不在乎什么神明，你只知道，病榻上的妻子快要撑不过今晚了。',
          '为了那一丝渺茫的希望，你握紧了手中破旧的法杖。',
          '哪怕前方是深渊，哪怕要直面神明。',
          '你踏入了高塔的第一层。'
        ],
        page: 0,
        typed: 0,
        charTimer: 0,
        phase: 'typing',
        fadeTimer: 0,
        time: 0
      };
      this.stage.classList.remove('is-menu');
      this.setGameState('INTRO', '开场白');
      Input.mouse.down = false;
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    }

    updateIntro(dt) {
      const intro = this.intro;
      if (!intro) return;
      intro.time += dt;
      if (intro.phase === 'typing') {
        const page = intro.pages[intro.page];
        intro.charTimer += dt;
        while (intro.charTimer >= 0.042 && intro.typed < page.length) {
          intro.charTimer -= 0.042;
          intro.typed += 1;
        }
        if (intro.typed >= page.length) {
          intro.phase = 'waiting';
        }
      } else if (intro.phase === 'fade') {
        intro.fadeTimer += dt;
        if (intro.fadeTimer >= 1.0) this.finishIntro();
      }
    }

    advanceIntro() {
      const intro = this.intro;
      if (!intro || intro.phase === 'fade') return;
      const page = intro.pages[intro.page];
      if (intro.typed < page.length) {
        intro.typed = page.length;
        intro.phase = 'waiting';
        return;
      }
      if (intro.page < intro.pages.length - 1) {
        intro.page += 1;
        intro.typed = 0;
        intro.charTimer = 0;
        intro.phase = 'typing';
      } else {
        intro.phase = 'fade';
        intro.fadeTimer = 0;
      }
    }

    skipIntro() {
      if (!this.intro) return;
      this.finishIntro(true);
    }

    finishIntro(skipLoading = false) {
      if (this.intro === null) return;
      this.intro = null;
      this.stage.classList.remove('is-menu');
      this.player.invuln = Math.max(this.player.invuln, 0.8);
      if (!skipLoading && this.beginLayerTransition(1)) return;
      this.startLevel(1, { preservePlayer: false, skipLoadingState: true });
      this.setGameState('PLAYING', '开场白结束');
    }

    wrapIntroText(ctx, text, maxWidth) {
      const lines = [];
      let line = '';
      for (const ch of text) {
        const candidate = line + ch;
        if (ctx.measureText(candidate).width > maxWidth && line) {
          lines.push(line);
          line = ch;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
      return lines;
    }

    renderIntro() {
      const ctx = this.ctx;
      const W = CFG.WORLD.W;
      const H = CFG.WORLD.H;
      const intro = this.intro;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, W, H);

      // 极简星空。
      for (let i = 0; i < 90; i += 1) {
        const x = (i * 193 + 47) % W;
        const y = (i * 83 + 31) % H;
        const alpha = 0.18 + (Math.sin(intro.time * 1.4 + i) + 1) * 0.16;
        ctx.fillStyle = `rgba(220, 228, 235, ${alpha})`;
        const size = i % 7 === 0 ? 2 : 1;
        ctx.fillRect(x, y, size, size);
      }

      // 远处高塔剪影。
      const tx = W / 2;
      const base = H - 70;
      ctx.fillStyle = '#0c0e15';
      ctx.fillRect(tx - 62, 150, 124, base - 150);
      ctx.fillRect(tx - 80, 128, 160, 30);
      ctx.fillRect(tx - 44, 96, 88, 36);
      ctx.fillStyle = '#151924';
      ctx.fillRect(tx - 40, 154, 80, base - 154);
      ctx.fillStyle = '#080a10';
      for (let i = 0; i < 5; i += 1) {
        ctx.fillRect(tx - 55, 205 + i * 64, 110, 5);
      }
      ctx.fillStyle = 'rgba(220, 185, 92, .55)';
      for (let i = 0; i < 6; i += 1) {
        const wx = tx - 28 + (i % 2) * 44;
        const wy = 230 + Math.floor(i / 2) * 85;
        ctx.fillRect(wx, wy, 8, 12);
      }
      ctx.fillStyle = '#07080d';
      ctx.fillRect(tx - 110, base, 220, 70);
      const glow = ctx.createRadialGradient(tx, 250, 10, tx, 250, 260);
      glow.addColorStop(0, 'rgba(196, 165, 90, .10)');
      glow.addColorStop(1, 'rgba(196, 165, 90, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      if (intro) {
        const page = intro.pages[intro.page];
        const shown = page.slice(0, intro.typed);
        ctx.save();
        if (intro.phase === 'fade') {
          ctx.globalAlpha = Math.max(0, 1 - intro.fadeTimer);
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 20px "Microsoft YaHei", "Courier New", monospace';
        ctx.fillStyle = '#e9e3d1';
        ctx.shadowColor = 'rgba(0,0,0,.9)';
        ctx.shadowBlur = 8;
        const lines = this.wrapIntroText(ctx, shown, 700);
        const startY = H / 2 + 40 - (lines.length - 1) * 18;
        lines.forEach((line, i) => {
          ctx.fillText(line, W / 2, startY + i * 38);
        });
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(214, 198, 154, .62)';
        ctx.font = '12px "Courier New", monospace';
        ctx.fillText(`${String(intro.page + 1).padStart(2, '0')} / 05`, W / 2, H - 55);
        ctx.restore();

        if (intro.phase !== 'fade') {
          ctx.save();
          ctx.globalAlpha = 0.34 + Math.abs(Math.sin(intro.time * 3.2)) * 0.3;
          ctx.textAlign = 'right';
          ctx.font = '13px "Microsoft YaHei", monospace';
          ctx.fillStyle = '#d9d0b8';
          ctx.fillText('[ 空格 / 左键 ] 继续', W - 34, H - 34);
          ctx.restore();
        }
      }

      if (intro && intro.phase === 'fade') {
        ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, intro.fadeTimer)})`;
        ctx.fillRect(0, 0, W, H);
      }
    }

    startDivineWhisper(levelId) {
      const texts = {
        1: '蝼蚁，你也会为了虚无的执念送死吗？',
        2: '灵魂的重量，比你想的要轻得多。',
        3: '时间会风化一切，包括你的爱。',
        4: '你每杀一个怪物，我就多一分力量。',
        5: '你就快要见到我了。可你真的敢直视我那张脸吗？',
        6: '那些死在黑暗里的人，都在为你鼓掌。',
        7: '来吧。把你的执念，统统献给我。'
      };
      const text = texts[levelId];
      if (!text) {
        this.divineWhisper = null;
        return;
      }
      this.divineWhisper = {
        text,
        timer: 0,
        duration: 4.2
      };
    }

    updateDivineWhisper(dt) {
      if (!this.divineWhisper) return;
      this.divineWhisper.timer += dt;
      if (this.divineWhisper.timer >= this.divineWhisper.duration) {
        this.divineWhisper = null;
      }
    }

    drawDivineWhisper(ctx) {
      const whisper = this.divineWhisper;
      if (!whisper) return;
      const t = whisper.timer;
      const fadeIn = Math.min(1, t / 0.55);
      const fadeOut = Math.min(1, (whisper.duration - t) / 0.9);
      const alpha = Math.max(0, Math.min(fadeIn, fadeOut)) * 0.72;
      if (alpha <= 0) return;
      const drift = Math.sin(t * 1.45) * 4;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '18px "Microsoft YaHei", "Courier New", monospace';
      ctx.fillStyle = '#b8343e';
      ctx.shadowColor = 'rgba(0,0,0,.85)';
      ctx.shadowBlur = 10;
      const lines = this.wrapIntroText(ctx, whisper.text, 820);
      const startY = CFG.WORLD.H * 0.09 + drift - (lines.length - 1) * 12;
      lines.forEach((line, i) => {
        ctx.fillText(line, CFG.WORLD.W / 2, startY + i * 26);
      });
      ctx.restore();
    }

    startEnding() {
      if (window.currentGameState === GAME_STATES.ENDING || this.ending) return;
      this.ending = {
        pages: [
          '神明的身躯化作无数光点，涌入你的体内。你感受到了前所未有的力量。',
          '你迫不及待地冲回家，将这股力量倾注在妻子身上。',
          '然而……她依然没有醒来。即使是神明的伟力，也无法逆转生命的消亡。',
          '你呆坐在床边，看着她苍白的脸。脑海中回响起神明临死前的话。',
          '‘死在塔里的所有人，生命力量都会汇聚到塔顶……’',
          '三天后，世界中心的那座高塔，再次亮起了微光。',
          '传闻，塔顶依然有一位能实现任何愿望的神明。',
          '只是这一次，坐在那座纯白王座上的人，是你。'
        ],
        page: 0,
        typed: 0,
        charTimer: 0,
        phase: 'typing',
        blankTimer: 0,
        time: 0,
        buttonsTime: 0,
        buttons: []
      };
      this.state = 'ending';
      this.pendingFinalClear = false;
      this.intro = null;
      this.cinematic = null;
      this.divineOrb = null;
      this.boss = null;
      this.enemies.length = 0;
      this.orbs.reset();
      this.meteors.length = 0;
      this.meteorFlashTimer = 0;
      this.meteorCooldown = 0;
      this.fireSpiritBombs = [];
      this.lavaBalls = [];
      this.evilOrbs = [];
      this.evilRays = [];
      this.executionerHooks = [];
      this.inkPools = [];
      this.ripples = [];
      this.whirlpools = [];
      this.particles.length = 0;
      this.spikes.length = 0;
      this.holyOrbs = [];
      if (this.hud.bossHud) this.hud.bossHud.hidden = true;
      if (this.overlay) this.overlay.hidden = true;
      if (this.upgradeOverlay) this.upgradeOverlay.hidden = true;
      this.stage.classList.remove('is-boss', 'is-dead', 'is-cleared');
      Input.mouse.down = false;
      this.setGameState('ENDING', '终局');
    }

    updateEnding(dt) {
      const e = this.ending;
      if (!e) return;
      e.time += dt;
      if (e.phase === 'typing') {
        const page = e.pages[e.page];
        e.charTimer += dt;
        while (e.charTimer >= 0.042 && e.typed < page.length) {
          e.charTimer -= 0.042;
          e.typed += 1;
        }
        if (e.typed >= page.length) e.phase = 'waiting';
      } else if (e.phase === 'blank') {
        e.blankTimer += dt;
        if (e.blankTimer >= 3.0) {
          e.phase = 'buttons';
          e.buttonsTime = 0;
        }
      } else if (e.phase === 'buttons') {
        e.buttonsTime += dt;
      }
    }

    advanceEnding() {
      const e = this.ending;
      if (!e || e.phase === 'blank' || e.phase === 'buttons') return;
      const page = e.pages[e.page];
      if (e.typed < page.length) {
        e.typed = page.length;
        e.phase = 'waiting';
        return;
      }
      if (e.page < e.pages.length - 1) {
        e.page += 1;
        e.typed = 0;
        e.charTimer = 0;
        e.phase = 'typing';
      } else {
        e.phase = 'blank';
        e.blankTimer = 0;
      }
    }

    endingButtonAt(x, y) {
      if (!this.ending || this.ending.phase !== 'buttons') return null;
      for (const button of this.ending.buttons) {
        if (x >= button.x && x <= button.x + button.w &&
          y >= button.y && y <= button.y + button.h) {
          return button.id;
        }
      }
      return null;
    }

    handleEndingClick(e) {
      if (!this.ending) return;
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (e.clientX - rect.left) * CFG.WORLD.W / rect.width;
      const y = (e.clientY - rect.top) * CFG.WORLD.H / rect.height;
      const button = this.endingButtonAt(x, y);
      if (button === 'restart') this.restartEnding();
      else if (button === 'menu') this.returnEndingToMenu();
    }

    restartEnding() {
      this.ending = null;
      this.intro = null;
      this.divineIntroPlayed = false;
      this.divine = { meteorLevel: 0, shadowLevel: 0 };
      this.playerUpgrades = {};
      this.playerBuild = null;
      this.meteorCooldown = 0;
      this.meteors = [];
      this.stage.classList.remove('is-menu', 'is-dead', 'is-cleared', 'is-boss');
      this.startLevel(1, { preservePlayer: false, skipLoadingState: true });
      this.player.invuln = Math.max(this.player.invuln, 0.8);
      this.setGameState('PLAYING', '重新开始');
    }

    returnEndingToMenu() {
      this.ending = null;
      this.intro = null;
      this.divineIntroPlayed = false;
      Input.mouse.down = false;
      this.stage.classList.add('is-menu');
      this.setGameState('MENU', '返回主菜单');
    }

    renderEnding() {
      const ctx = this.ctx;
      const W = CFG.WORLD.W;
      const H = CFG.WORLD.H;
      const e = this.ending;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);

      if (!e || e.phase === 'blank') return;

      if (e.phase === 'typing' || e.phase === 'waiting') {
        const page = e.pages[e.page];
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '20px "Microsoft YaHei", "Courier New", monospace';
        ctx.fillStyle = '#f2f2f2';
        const lines = this.wrapIntroText(ctx, page.slice(0, e.typed), 700);
        const startY = H / 2 - (lines.length - 1) * 18;
        lines.forEach((line, i) => {
          ctx.fillText(line, W / 2, startY + i * 38);
        });
        if (e.phase === 'waiting') {
          ctx.globalAlpha = 0.28 + Math.abs(Math.sin(e.time * 3)) * 0.24;
          ctx.textAlign = 'right';
          ctx.font = '12px "Courier New", monospace';
          ctx.fillStyle = '#d0d0d0';
          ctx.fillText('[ 空格 / 左键 ] 继续', W - 34, H - 32);
        }
        ctx.restore();
        return;
      }

      if (e.phase === 'buttons') {
        const alpha = Math.min(1, e.buttonsTime * 2.2);
        ctx.save();
        ctx.globalAlpha = alpha;
        const bw = 220;
        const bh = 52;
        const gap = 30;
        const y = H / 2 + 40;
        const buttons = [
          {
            id: 'restart', label: '重新开始',
            x: W / 2 - bw - gap / 2, y, w: bw, h: bh
          },
          {
            id: 'menu', label: '返回主菜单',
            x: W / 2 + gap / 2, y, w: bw, h: bh
          }
        ];
        e.buttons = buttons;
        for (const button of buttons) {
          const hover = Input.mouse.x >= button.x &&
            Input.mouse.x <= button.x + button.w &&
            Input.mouse.y >= button.y &&
            Input.mouse.y <= button.y + button.h;
          ctx.fillStyle = hover ? 'rgba(42, 42, 42, .88)' : 'rgba(18, 18, 18, .82)';
          ctx.fillRect(button.x, button.y, button.w, button.h);
          ctx.strokeStyle = hover ? '#e2dcc8' : 'rgba(180, 174, 158, .55)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(button.x, button.y, button.w, button.h);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '16px "Microsoft YaHei", monospace';
          ctx.fillStyle = hover ? '#ffffff' : '#d8d3c4';
          ctx.fillText(
            button.label,
            button.x + button.w / 2,
            button.y + button.h / 2
          );
        }
        ctx.restore();
      }
    }

    beginLayerTransition(levelId) {
      if (this.pendingLayerId) return false;
      const target = PF.LEVELS[`Level${levelId}`];
      if (!target) return false;

      this.pendingLayerId = levelId;
      this.setGameState('LOADING', `踏入 ${target.layerName}`);

      const finish = () => this.completeLayerTransition();
      if (PF.UI && typeof PF.UI.startLoadingTransition === 'function') {
        PF.UI.startLoadingTransition(levelId, finish);
      } else {
        window.setTimeout(finish, 1500);
      }
      return true;
    }

    completeLayerTransition() {
      const levelId = this.pendingLayerId;
      if (!levelId) return false;
      const target = PF.LEVELS[`Level${levelId}`];
      this.pendingLayerId = null;
      this.startLevel(levelId, {
        preservePlayer: true,
        skipLoadingState: true,
        message: target ? `${target.layerName} · ${target.name}` : ''
      });
      return true;
    }

    debugJumpToLevel(levelId) {
      const level = PF.LEVELS[`Level${levelId}`];
      if (!level) return false;
      this.stage.classList.remove('is-menu', 'is-dead', 'is-cleared');
      this.startLevel(levelId, { preservePlayer: false });
      this.player.hp = this.player.maxHp;
      this.player.cold = 0;
      this.player.potionCharges = CFG.POTION.CHARGES;
      if (levelId === 8) {
        this.enterRoom(this.levelRooms.length - 1, 'forward');
        this.showToast('调试跳转 · 最终层 · 神明之巅', 1.8);
        return true;
      }
      this.showToast(`调试跳转 · ${level.layerName} · ${level.name}`, 1.8);
      return true;
    }

    ensureDivineDialog() {
      if (this.divineDialog) return this.divineDialog;
      const host = document.querySelector('.stage') || document.body;
      const dialog = document.createElement('div');
      dialog.id = 'divineDialog';
      dialog.style.cssText = [
        'position:absolute', 'left:50%', 'bottom:12%',
        'transform:translateX(-50%)', 'width:min(760px,78%)',
        'padding:18px 24px', 'box-sizing:border-box',
        'background:rgba(18,14,9,.90)',
        'border:2px solid #d9b45a', 'border-radius:4px',
        'box-shadow:0 0 34px rgba(236,195,95,.32)',
        'color:#f8efd5', 'font:17px/1.9 "Microsoft YaHei",sans-serif',
        'letter-spacing:.5px', 'white-space:pre-line',
        'pointer-events:none', 'z-index:40', 'display:none'
      ].join(';');
      dialog.hidden = true;
      host.appendChild(dialog);
      this.divineDialog = dialog;
      return dialog;
    }

    startDivineIntro() {
      this.divineIntroPlayed = true;
      this.cinematic = {
        phase: 'appear',
        time: 0,
        lineIndex: 0,
        chars: 0,
        charTimer: 0,
        pause: 0,
        hold: 0,
        ambushTimer: 0
      };
      this.ensureDivineDialog();
      Input.mouse.down = false;
      this.player.moving = false;
      this.player.knockX = 0;
      this.player.knockY = 0;
      if (this.boss) {
        this.boss.introVisible = true;
        this.boss.skillState = 'idle';
      }
      this.addShake(2.5, 0.3);
    }

    updateDivineIntro(dt) {
      const c = this.cinematic;
      if (!c) return;
      c.time += dt;
      const line1 = '凡人，你以为我是因为无聊才建这座塔的吗？';
      const line2 = '我的生命即将走到尽头……这里只是我的电池，死在塔里的所有人，他们的生命力量，都汇聚到了我这里！';

      if (c.phase === 'appear') {
        if (c.time >= 0.55) {
          c.phase = 'typing';
          this.divineDialog.hidden = false;
          this.divineDialog.style.display = 'block';
          this.divineDialog.textContent = '▌';
          this.spawnBurst(
            this.boss.x, this.boss.y, 30,
            ['#fff4c2', '#ffd76b', '#ffffff'], 160, 0.8
          );
        }
        return;
      }

      if (c.phase === 'typing') {
        if (c.pause > 0) {
          c.pause = Math.max(0, c.pause - dt);
          return;
        }
        c.charTimer += dt;
        if (c.charTimer < 0.035) return;
        c.charTimer = 0;
        const current = c.lineIndex === 0 ? line1 : line2;
        c.chars += 1;
        if (c.chars >= current.length) {
          c.lineIndex += 1;
          c.chars = 0;
          if (c.lineIndex >= 2) {
            c.phase = 'hold';
            c.hold = 0.9;
          } else {
            c.pause = 0.45;
          }
        }
        let text = c.lineIndex > 0 ? line1 : line1.slice(0, c.chars);
        if (c.lineIndex >= 1) {
          text += '\n' + (c.lineIndex > 1 ? line2 : line2.slice(0, c.chars));
        }
        this.divineDialog.textContent = text + (c.phase === 'typing' ? '▌' : '');
        return;
      }

      if (c.phase === 'hold') {
        c.hold = Math.max(0, c.hold - dt);
        this.divineDialog.textContent = line1 + '\n' + line2;
        if (c.hold === 0) this.executeDivineAmbush();
        return;
      }

      if (c.phase === 'ambush') {
        c.ambushTimer += dt;
        if (c.ambushTimer >= 0.75) {
          this.cinematic = null;
          this.divineDialog.hidden = true;
          this.divineDialog.style.display = 'none';
          Input.mouse.down = false;
        }
      }
    }

    executeDivineAmbush() {
      const c = this.cinematic;
      if (!c || c.phase === 'ambush') return;
      c.phase = 'ambush';
      c.ambushTimer = 0;
      const player = this.player;
      const boss = this.boss;
      if (boss) {
        boss.x = clamp(player.x + 125, 120, CFG.WORLD.W - 120);
        boss.y = clamp(player.y, 120, CFG.WORLD.H - 120);
        boss.contactCooldown = 0;
        boss.contactRecoilTimer = 0;
        boss.moving = false;
        boss.introVisible = true;
      }
      this.divineOrb = {
        x: player.x,
        y: player.y,
        radius: 72,
        life: 0.7,
        maxLife: 0.7
      };
      player.takeTrueDamage(3);
      this.addShake(9, 0.55);
      this.spawnBurst(
        player.x, player.y, 34,
        ['#fff4c2', '#ffd76b', '#ffffff', '#d8b04e'], 210, 0.8
      );
    }

    updateDivineOrb(dt) {
      if (!this.divineOrb) return;
      this.divineOrb.life -= dt;
      if (this.divineOrb.life <= 0) this.divineOrb = null;
    }

    drawDeityOverlays(ctx) {
      const boss = this.boss;
      if (!boss || boss.type !== 'deity') return;
      if (boss.rageMode) {
        ctx.save();
        const edge = 46;
        const red = 'rgba(185, 22, 24, .34)';
        ctx.fillStyle = red;
        ctx.fillRect(0, 0, CFG.WORLD.W, edge);
        ctx.fillRect(0, CFG.WORLD.H - edge, CFG.WORLD.W, edge);
        ctx.fillRect(0, 0, edge, CFG.WORLD.H);
        ctx.fillRect(CFG.WORLD.W - edge, 0, edge, CFG.WORLD.H);
        ctx.restore();
      }
      if (boss.timeStopActive) {
        ctx.save();
        ctx.fillStyle = 'rgba(95, 95, 98, .38)';
        ctx.fillRect(0, 0, CFG.WORLD.W, CFG.WORLD.H);
        ctx.restore();
      }
      if (boss.skillState === 'ultimate') {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 252, 240, .64)';
        ctx.fillRect(0, 0, CFG.WORLD.W, CFG.WORLD.H);
        const n = Math.max(1, Math.ceil(boss.ultimateTimer));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 28px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#8e2c20';
        ctx.fillText('终极毁灭 · 击碎神明', CFG.WORLD.W / 2, CFG.WORLD.H / 2 - 190);
        ctx.font = 'bold 190px "Microsoft YaHei", sans-serif';
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#7d251d';
        ctx.strokeText(String(n), CFG.WORLD.W / 2, CFG.WORLD.H / 2);
        ctx.fillStyle = '#c53a26';
        ctx.fillText(String(n), CFG.WORLD.W / 2, CFG.WORLD.H / 2);
        ctx.restore();
      }
    }

    drawSilenceMark(ctx) {
      if (!this.player || this.player.silenceTimer <= 0) return;
      const x = this.player.x;
      const y = this.player.y - 42;
      ctx.save();
      ctx.fillStyle = 'rgba(220, 40, 45, .85)';
      ctx.beginPath();
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x + 8, y);
      ctx.lineTo(x, y + 12);
      ctx.lineTo(x - 8, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffe9c2';
      ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`沉默 ${Math.ceil(this.player.silenceTimer)}`, x, y - 20);
      ctx.restore();
    }

    drawDivineOrb(ctx) {
      if (!this.divineOrb) return;
      const orb = this.divineOrb;
      const t = 1 - orb.life / orb.maxLife;
      ctx.save();
      ctx.globalAlpha = 1 - t * 0.75;
      ctx.fillStyle = 'rgba(255, 224, 128, .20)';
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.radius * (1 + t * 0.35), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 236, 166, .72)';
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.radius * (0.55 + t * 0.2), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.radius * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    debugToggleGodMode() {
      this.godMode = !this.godMode;
      this.showToast(
        this.godMode ? '开发者无敌：开启' : '开发者无敌：关闭',
        1.4
      );
      return this.godMode;
    }

    debugClearRoom() {
      if (window.currentGameState !== GAME_STATES.PLAYING) return false;
      if (this.state !== 'playing') return false;
      const room = this.getCurrentRoom();
      if (!room) return false;

      for (const enemy of this.enemies) {
        if (!enemy.dead) this.killEnemy(enemy, enemy.x, enemy.y);
      }
      this.enemies.length = 0;
      room.enemies.length = 0;
      this.activeChasers.clear();

      if (this.scene === 'forest') {
        room.cleared = true;
        room.unlocked = true;
        room.openProgress = 1;
        this.bossDoorUnlocked = true;
        this.portalOpenProgress = 1;
      }
      this.showToast('调试：当前房间已清空', 1.2);
      this.updateHud(true);
      return true;
    }

    bindEvents() {
      window.addEventListener('keydown', (e) => {
        console.log('Key pressed:', e.key);
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (window.currentGameState === GAME_STATES.ENDING) {
          if (e.code === 'Space' || e.code === 'Enter') {
            e.preventDefault();
            if (!e.repeat) this.advanceEnding();
          } else {
            e.preventDefault();
          }
          return;
        }
        if (window.currentGameState === GAME_STATES.INTRO) {
          if (e.code === 'Escape') {
            e.preventDefault();
            if (!e.repeat) this.skipIntro();
            return;
          }
          if (e.code === 'Space' || e.code === 'Enter') {
            e.preventDefault();
            if (!e.repeat) this.advanceIntro();
            return;
          }
          e.preventDefault();
          return;
        }
        if (e.code === 'KeyR' && !e.repeat) {
          e.preventDefault();
          // 结算、死亡、异常卡帧时都允许强制重置。
          try {
            if (window.currentGameState === GAME_STATES.MENU) {
              this.startFromMenu();
            } else {
              this.reset();
            }
          } catch (error) {
            console.error('[R键重置失败]', error);
            try { window.location.reload(); } catch { /* 最后兜底 */ }
          }
          return;
        }
        if (e.code === 'F1' && !e.repeat) {
          e.preventDefault();
          this.debug = !this.debug;
        }
        const isRollKey = e.key === 'Shift' || e.key === ' ' ||
          e.code === 'ShiftLeft' || e.code === 'ShiftRight' ||
          e.code === 'Space';
        if (isRollKey) {
          e.preventDefault();
          if (!e.repeat && window.currentGameState === GAME_STATES.PLAYING) {
            this.player.requestRoll();
          }
        }
        if (e.code === 'KeyQ' || (e.key || '').toLowerCase() === 'q') {
          e.preventDefault();
          if (!e.repeat && window.currentGameState === GAME_STATES.PLAYING) {
            this.player.usePotion();
          }
        }
        if (e.code === 'KeyE' && !e.repeat) {
          e.preventDefault();
          this.castMeteor();
        }
        if (e.code === 'KeyG' && !e.repeat) {
          e.preventDefault();
          this.debugToggleGodMode();
        }
        if (e.code === 'KeyK' && !e.repeat) {
          e.preventDefault();
          this.debugClearRoom();
        }
        const jumpLevel = {
          Digit1: 1, Numpad1: 1,
          Digit2: 2, Numpad2: 2,
          Digit3: 3, Numpad3: 3,
          Digit4: 4, Numpad4: 4,
          Digit5: 5, Numpad5: 5,
          Digit6: 6, Numpad6: 6,
          Digit7: 7, Numpad7: 7,
          Digit8: 8, Numpad8: 8
        }[e.code];
        // 结算界面保留 1/2/3 选择奖励；其他时候 1~5 用于调试跳层。
        const thirdReward = this.state === 'levelClear' &&
          this.rewardChoices.length >= 3;
        const upgradeNumber = this.state === 'levelClear' &&
          (e.code === 'Digit1' || e.code === 'Numpad1' ||
            e.code === 'Digit2' || e.code === 'Numpad2' ||
            (thirdReward &&
              (e.code === 'Digit3' || e.code === 'Numpad3')));
        if (jumpLevel && !e.repeat && !upgradeNumber) {
          e.preventDefault();
          this.debugJumpToLevel(jumpLevel);
          return;
        }
        if (this.state === 'levelClear' && !e.repeat) {
          if (e.code === 'Digit1' || e.code === 'Numpad1') {
            e.preventDefault();
            this.chooseReward(0);
            return;
          }
          if (e.code === 'Digit2' || e.code === 'Numpad2') {
            e.preventDefault();
            this.chooseReward(1);
            return;
          }
          if (e.code === 'Digit3' || e.code === 'Numpad3') {
            e.preventDefault();
            this.chooseReward(2);
            return;
          }
        }
        if (
          e.code === 'KeyW' || e.code === 'KeyA' ||
          e.code === 'KeyS' || e.code === 'KeyD' ||
          e.code === 'ArrowUp' || e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' || e.code === 'ArrowRight'
        ) {
          e.preventDefault();
        }
      });

      for (const button of this.upgradeButtons) {
        button.addEventListener('click', () => {
          this.chooseReward(Number(button.dataset.rewardIndex));
        });
      }

      this.canvas.addEventListener('mousedown', (e) => {
        if (e.button === 2) {
          e.preventDefault();
          this.castMeteor();
        }
      });
      window.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (window.currentGameState === GAME_STATES.INTRO) {
          e.preventDefault();
          this.advanceIntro();
          return;
        }
        if (window.currentGameState === GAME_STATES.ENDING) {
          e.preventDefault();
          this.handleEndingClick(e);
        }
      });

      this.canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
      });
    }

    setGameState(next, reason = '') {
      const valid = Object.values(GAME_STATES).includes(next);
      if (!valid) return;
      const previous = window.currentGameState;
      if (previous === next) return;
      window.currentGameState = next;
      const suffix = reason ? ` · ${reason}` : '';
      console.log(`[GameState] ${previous} -> ${next}${suffix}`);
      if (PF.UI && typeof PF.UI.switchUI === 'function') {
        PF.UI.switchUI(next);
      }
    }

    showToast(text, duration = 1.8) {
      this.toast.textContent = text;
      this.toast.hidden = false;
      this.toastTimer = duration;
    }

    updateToast(dt) {
      if (this.toastTimer <= 0) return;
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.toastTimer = 0;
        this.toast.hidden = true;
      }
    }

    requestChase(enemy) {
      if (this.activeChasers.has(enemy)) return true;
      if (this.activeChasers.size >= CFG.ENEMY.MAX_CHASERS) return false;
      this.activeChasers.add(enemy);
      return true;
    }

    releaseChase(enemy) {
      this.activeChasers.delete(enemy);
    }

    killEnemy(enemy, sourceX, sourceY) {
      if (enemy.dead) return;
      enemy.dead = true;
      enemy.hp = 0;
      this.releaseChase(enemy);

      if (enemy.archetype.deathPoison) {
        this.spawnDeathPoison(enemy.x, enemy.y, enemy.archetype.deathPoison);
      }
      if (enemy.archetype.deathCurse &&
        Math.random() < enemy.archetype.deathCurse.chance) {
        this.spawnCurseSand(enemy.x, enemy.y, enemy.archetype.deathCurse);
      }

      const isElite = Boolean(enemy.archetype.isElite);
      let colors = isElite ? PALETTE.eliteBlood : PALETTE.bloodColors;
      if (enemy.type === 'swampFly') colors = ['#5dbb52', '#b9f77f', '#9b6cff'];
      else if (enemy.type === 'mireLurker') colors = ['#6f7e39', '#59406f', '#b6c46a'];
      else if (enemy.type === 'snowman' || enemy.type === 'giantYeti') {
        colors = ['#f4fbff', '#c9e6f2', '#ffffff', '#8fb6c8'];
      }
      const count = isElite ? 24 : 14;
      this.spawnBurst(enemy.x, enemy.y, count, colors, isElite ? 170 : 145, 0.58);
      this.addShake(isElite ? 3.2 : 1.6, 0.12);
    }

    landTree(tree) {
      const rect = tree.fallRect;
      if (!rect) return;

      // 倒下的树对区域内所有怪物造成 10 点伤害（包括精英怪）
      for (const enemy of this.enemies) {
        if (enemy.dead || enemy.burrowed) continue;
        if (pointInRect(enemy.x, enemy.y, rect)) {
          enemy.takeDamage(CFG.TREE.FALL_DAMAGE, tree.x, tree.y);
        }
      }

      // Boss 房：倒树命中 Boss 时扣 10 血并造成 0.3 秒硬直
      if (
        this.scene === 'boss' &&
        this.boss &&
        this.boss.state === 'active' &&
        aabbOverlap(rect, this.boss.getTreeHitBody())
      ) {
        this.boss.takeDamage(CFG.BOSS.TREE_DAMAGE, tree.x, tree.y, 'tree');
      }

      this.addShake(5.5, 0.24);

      // 沿倒地方向喷出尘土和碎叶
      const horizontal = tree.fallDir === 'left' || tree.fallDir === 'right';
      const steps = 5;
      for (let i = 0; i < steps; i += 1) {
        const t = (i + 1) / steps;
        const px = horizontal ? lerp(rect.x, rect.x + rect.w, t) : lerp(rect.x, rect.x + rect.w, 0.5);
        const py = horizontal ? lerp(rect.y, rect.y + rect.h, 0.5) : lerp(rect.y, rect.y + rect.h, t);
        this.spawnBurst(px, py, 5, PALETTE.dustColors, 105, 0.5);
        if (i % 2 === 0) this.spawnBurst(px, py, 4, PALETTE.leafColors, 85, 0.55);
      }
    }

    onPlayerDeath() {
      if (this.state !== 'playing') return;
      this.deathInBossRoom = this.scene === 'boss';
      this.deathRoomIndex = this.currentRoomIndex;
      this.state = 'dead';
      Input.mouse.down = false;
      this.toast.hidden = true;
      this.toastTimer = 0;
      this.stage.classList.add('is-dead');
      this.showOverlay('dead');
      this.setGameState('DEAD', '玩家死亡');
      this.updateHud(true);
    }

    onCleared() {
      if (this.state !== 'playing') return;
      this.state = 'cleared';
      Input.mouse.down = false;
      this.stage.classList.add('is-cleared');
      this.showOverlay('clear');
      this.updateHud(true);
    }

    showOverlay(kind) {
      this.overlay.hidden = false;
      this.overlay.classList.toggle('overlay--dead', kind === 'dead');
      this.overlay.classList.toggle('overlay--clear', kind === 'clear');
      this.overlay.classList.toggle(
        'overlay--boss',
        kind === 'boss' || kind === 'level2Clear' || kind === 'level3Clear'
      );
      if (kind === 'dead') {
        const layerName = this.currentLevel ? this.currentLevel.layerName : '本层';
        this.overlayTitle.textContent = `已死亡，按 R 重置${layerName}`;
        this.overlayHint.innerHTML = `按 <b>R</b> 回到${layerName}出生点`;
      } else if (kind === 'level2Clear') {
        this.overlayTitle.textContent = '击败沼泽巨蛙，第二层通关！';
        this.overlayHint.innerHTML = '按 <b>R</b> 重新挑战第二层 · 后续层开发中';
      } else if (kind === 'level3Clear') {
        this.overlayTitle.textContent = '击败深渊沙虫，沙海封印解除！';
        this.overlayHint.innerHTML = '按 <b>R</b> 重新挑战第三层 · 后续层开发中';
      } else if (kind === 'level4Clear') {
        this.overlayTitle.textContent = '击败雪人头目，风雪暂歇！';
        this.overlayHint.innerHTML = '按 <b>R</b> 重新挑战第四层';
      } else if (kind === 'level5Clear') {
        this.overlayTitle.textContent = '击败熔岩巨龙，神明领域暂归沉寂！';
        this.overlayHint.innerHTML = '按 <b>R</b> 重新挑战第五层';
      } else if (kind === 'level6Clear') {
        this.overlayTitle.textContent = '击败邪恶法师，黑暗地牢的诅咒解除！';
        this.overlayHint.innerHTML = '按 <b>R</b> 重新挑战第六层';
      } else if (kind === 'level7Clear') {
        this.overlayTitle.textContent = '击败深渊巨鲸，深海迷境重归平静！';
        this.overlayHint.innerHTML = '按 <b>R</b> 重新挑战第七层';
      } else if (kind === 'level8Clear') {
        this.overlayTitle.textContent = '击败神明，八层高塔的轮回终结！';
        this.overlayHint.innerHTML = '按 <b>R</b> 重新挑战最终层';
      } else if (kind === 'boss') {
        this.overlayTitle.textContent = 'Boss 已击败';
        this.overlayHint.innerHTML = '按 <b>R</b> 返回普通房间重新开始';
      } else {
        this.overlayTitle.textContent = '森林已清空！';
        this.overlayHint.innerHTML = '按 <b>R</b> 再来一局';
      }
    }

    hideOverlay() {
      this.overlay.hidden = true;
      this.overlay.classList.remove('overlay--dead', 'overlay--clear', 'overlay--boss');
    }

    getBuildRewardPool(build) {
      if (build === 'Attack') return ['atkDamage', 'atkSpeed', 'atkPierce'];
      if (build === 'Tank') return ['tankHp', 'tankPotion', 'tankShield'];
      if (build === 'Weapon') return ['weaponSize', 'weaponHail', 'weaponEnchant'];
      return ['buildAttack', 'buildTank', 'buildWeapon'];
    }

    pickRewardIds(pool, count = 2) {
      const ids = [...pool];
      for (let i = ids.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      return ids.slice(0, Math.min(count, ids.length));
    }

    makeRewardChoice(id) {
      const player = this.player;
      switch (id) {
        case 'buildAttack':
          return {
            id,
            title: '攻击流 · 法球专精',
            desc: '法球伤害 +1，法球冷却 -0.1s（与生命流互斥）'
          };
        case 'buildTank':
          return {
            id,
            title: '生命流 · 坚韧',
            desc: '最大生命 +3，并立即回满（与攻击流互斥）'
          };
        case 'buildWeapon':
          return {
            id,
            title: '武器流 · 散弹',
            desc: '法球变 3 颗散弹，单颗 0.5 伤害，15°扇形'
          };
        case 'weaponSize': {
          const nextDamage = player.weaponPelletDamage + 0.5;
          return {
            id,
            title: '法球体积 +100%',
            desc: `单发 ${player.weaponPelletDamage.toFixed(1)} → ${nextDamage.toFixed(1)}，射速 -20%`
          };
        }
        case 'weaponHail':
          return {
            id,
            title: '火力倾泻',
            desc: `散弹 ${player.shotgunCount} → 5 颗，散布角 15° → 28°`
          };
        case 'weaponEnchant':
          return {
            id,
            title: '附魔弹',
            desc: '法球穿透 1 个怪物，拖尾判定范围增强'
          };
        case 'atkDamage':
          return {
            id,
            title: '法球伤害 +1',
            desc: `当前法球伤害 ${player.orbDamage} → ${player.orbDamage + 1}`
          };
        case 'atkSpeed': {
          const next = Math.max(0.08, player.shootInterval * 0.85);
          return {
            id,
            title: '法球发射速度 +15%',
            desc: `法球冷却 ${player.shootInterval.toFixed(2)}s → ${next.toFixed(2)}s`
          };
        }
        case 'atkPierce':
          return {
            id,
            title: '法球穿透 +1',
            desc: '法球可以额外穿透 1 个怪物'
          };
        case 'tankHp':
          return {
            id,
            title: '最大生命 +2',
            desc: `生命 ${player.maxHp} → ${player.maxHp + 2}，并立即回满`
          };
        case 'tankPotion':
          return {
            id,
            title: '药水回复 +2',
            desc: `药水回复 ${player.potionHeal} → ${player.potionHeal + 2}`
          };
        case 'tankShield':
          return {
            id,
            title: '冰霜护盾',
            desc: '每 10 秒抵挡一次伤害'
          };
        case 'divineMeteor':
          return {
            id,
            title: '神明之火 · 陨石火球',
            desc: 'E / 鼠标右键释放巨大火球，30 范围伤害，冷却 8 秒'
          };
        case 'divineShadow':
          return {
            id,
            title: '暗影之舞 · 双翻滚',
            desc: '翻滚充能上限 2 次，可连续翻滚；穿敌造成 10 伤害'
          };
        case 'meteorSplit':
          return {
            id,
            title: '陨石分裂',
            desc: '爆炸后分裂 4 颗小法球，每颗 10 伤害'
          };
        case 'meteorCooldown':
          return {
            id,
            title: '陨石冷却缩减',
            desc: '陨石火球冷却 8 秒 → 4 秒'
          };
        case 'shadowDamage':
          return {
            id,
            title: '翻滚伤害',
            desc: '翻滚穿过敌人时造成 10 点伤害'
          };
        case 'shadowTrap':
          return {
            id,
            title: '翻滚爆炸陷阱',
            desc: '翻滚结束留下陷阱，1 秒后爆炸造成 20 伤害'
          };
        default:
          return { id, title: '强化', desc: '' };
      }
    }

    getDivineRewardIds() {
      const ids = [];
      if (this.divine.meteorLevel === 0) ids.push('divineMeteor');
      else if (this.divine.meteorLevel === 1) ids.push('meteorSplit');
      else if (this.divine.meteorLevel === 2) ids.push('meteorCooldown');

      if (this.divine.shadowLevel === 0) ids.push('divineShadow');
      else if (this.divine.shadowLevel === 1) ids.push('shadowDamage');
      else if (this.divine.shadowLevel === 2) ids.push('shadowTrap');
      return ids.slice(0, 2);
    }

    showLevelClearChoice() {
      this.upgradeChoiceOpen = true;
      this.upgradeOverlay.hidden = false;
      if (this.currentLevelId < 5) this.pendingFinalClear = false;

      const isDivine = this.currentLevelId >= 5;
      const isInitial = !isDivine && !this.playerBuild;
      let ids;
      if (isDivine) {
        ids = this.getDivineRewardIds();
      } else {
        const pool = this.getBuildRewardPool(this.playerBuild);
        ids = isInitial ? pool : this.pickRewardIds(pool, 2);
      }
      this.rewardChoices = ids.map((id) => this.makeRewardChoice(id));

      this.upgradeKicker.textContent = isDivine
        ? 'DIVINE REWARD'
        : (this.pendingFinalClear
          ? 'FINAL REWARD'
          : `LEVEL ${this.currentLevelId} CLEARED`);
      if (isDivine) {
        this.upgradeTitle.textContent = '神明神技';
        this.upgradeDesc.textContent = this.currentLevelId >= 8
          ? '选择一项神技，随后结束最终层。'
          : (this.currentLevelId === 7
            ? '选择一项神技，随后前往最终层。'
            : (this.currentLevelId === 6
              ? '选择一项神技，随后前往第七层。'
              : '选择一项神技，随后前往第六层。'));
      } else if (isInitial) {
        this.upgradeTitle.textContent = '选择你的流派';
        this.upgradeDesc.textContent =
          '攻击流、生命流、武器流三选一，本局不可更改。';
      } else if (this.pendingFinalClear) {
        this.upgradeTitle.textContent = '最终强化';
        this.upgradeDesc.textContent =
          '从随机两项强化中选择一项，随后结束第四层。';
      } else if (this.playerBuild === 'Attack') {
        this.upgradeTitle.textContent = '攻击流强化';
        this.upgradeDesc.textContent =
          '从随机两项攻击强化中选择一项，然后走进传送阵。';
      } else if (this.playerBuild === 'Weapon') {
        this.upgradeTitle.textContent = '武器流强化';
        this.upgradeDesc.textContent =
          '从随机两项武器强化中选择一项，然后走进传送阵。';
      } else {
        this.upgradeTitle.textContent = '生命流强化';
        this.upgradeDesc.textContent =
          '从随机两项生命强化中选择一项，然后走进传送阵。';
      }
      if (this.rewardOptions) {
        this.rewardOptions.classList.toggle(
          'is-three', this.rewardChoices.length === 3
        );
      }

      for (let i = 0; i < this.upgradeButtons.length; i += 1) {
        const button = this.upgradeButtons[i];
        const choice = this.rewardChoices[i];
        if (!choice) {
          button.hidden = true;
          button.disabled = true;
          continue;
        }
        button.hidden = false;
        button.disabled = false;
        button.dataset.rewardIndex = String(i);
        button.dataset.upgrade = choice.id;
        button.classList.toggle(
          'reward-option--atk',
          choice.id.startsWith('atk') || choice.id === 'buildAttack'
        );
        button.classList.toggle(
          'reward-option--weapon',
          choice.id.startsWith('weapon') || choice.id === 'buildWeapon'
        );
        button.innerHTML =
          `<span class="reward-option__key">${i + 1}</span>` +
          '<strong></strong><small></small>';
        button.querySelector('strong').textContent = choice.title;
        button.querySelector('small').textContent = choice.desc;
      }

      this.hideOverlay();
      this.toast.hidden = true;
      this.toastTimer = 0;
      if (this.upgradeButtons[0]) {
        this.upgradeButtons[0].focus({ preventScroll: true });
      }
      this.updateHud(true);
    }

    hideUpgradeChoice() {
      this.upgradeChoiceOpen = false;
      if (this.upgradeOverlay) {
        this.upgradeOverlay.hidden = true;
      }
      for (const button of this.upgradeButtons) {
        button.disabled = true;
      }
      if (document.activeElement && this.upgradeOverlay.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    }

    applyRewardChoice(choice) {
      if (!choice || !this.player) return null;
      const p = this.player;
      const u = this.playerUpgrades;

      switch (choice.id) {
        case 'buildAttack':
          if (this.playerBuild) return null;
          this.playerBuild = 'Attack';
          window.playerBuild = 'Attack';
          p.playerBuild = 'Attack';
          u.orbDamageBonus += 1;
          p.orbDamage += 1;
          u.shootInterval = Math.max(
            0.08,
            (u.shootInterval || CFG.PLAYER.SHOOT_CD) - 0.1
          );
          p.shootInterval = u.shootInterval;
          break;
        case 'buildTank':
          if (this.playerBuild) return null;
          this.playerBuild = 'Tank';
          window.playerBuild = 'Tank';
          p.playerBuild = 'Tank';
          u.maxHpBonus += 3;
          p.maxHp += 3;
          p.hp = p.maxHp;
          break;
        case 'buildWeapon':
          if (this.playerBuild) return null;
          this.playerBuild = 'Weapon';
          window.playerBuild = 'Weapon';
          p.playerBuild = 'Weapon';
          u.weaponType = 'shotgun';
          u.shotgunCount = CFG.WEAPON.COUNT;
          u.shotgunSpreadDeg = CFG.WEAPON.SPREAD_DEG;
          u.weaponPelletDamage = CFG.WEAPON.PELLET_DAMAGE;
          u.weaponSizeMultiplier = 1;
          u.weaponTrail = false;
          p.weaponType = 'shotgun';
          p.shotgunCount = CFG.WEAPON.COUNT;
          p.shotgunSpread = CFG.WEAPON.SPREAD_DEG * Math.PI / 180;
          p.weaponPelletDamage = CFG.WEAPON.PELLET_DAMAGE;
          p.weaponSizeMultiplier = 1;
          p.weaponTrail = false;
          break;
        case 'atkDamage':
          u.orbDamageBonus += 1;
          p.orbDamage += 1;
          break;
        case 'atkSpeed':
          u.shootInterval = Math.max(
            0.08,
            (u.shootInterval || CFG.PLAYER.SHOOT_CD) * 0.85
          );
          p.shootInterval = u.shootInterval;
          break;
        case 'atkPierce':
          u.orbPierce = Math.max(1, u.orbPierce || 0);
          p.orbPierce = u.orbPierce;
          break;
        case 'tankHp':
          u.maxHpBonus += 2;
          p.maxHp += 2;
          p.hp = p.maxHp;
          break;
        case 'tankPotion':
          u.potionHealBonus = (u.potionHealBonus || 0) + 2;
          p.potionHeal += 2;
          break;
        case 'tankShield':
          u.frostShield = true;
          p.frostShieldEnabled = true;
          p.frostShieldTimer = 10;
          p.frostShieldReady = false;
          break;
        case 'weaponSize':
          u.weaponSizeMultiplier = (u.weaponSizeMultiplier || 1) + 1;
          u.weaponPelletDamage =
            (u.weaponPelletDamage || CFG.WEAPON.PELLET_DAMAGE) + 0.5;
          u.shootInterval = Math.max(
            0.08,
            (u.shootInterval || CFG.PLAYER.SHOOT_CD) * 1.2
          );
          p.weaponSizeMultiplier = u.weaponSizeMultiplier;
          p.weaponPelletDamage = u.weaponPelletDamage;
          p.shootInterval = u.shootInterval;
          break;
        case 'weaponHail':
          u.shotgunCount = CFG.WEAPON.HAIL_COUNT;
          u.shotgunSpreadDeg = CFG.WEAPON.HAIL_SPREAD_DEG;
          p.shotgunCount = u.shotgunCount;
          p.shotgunSpread = u.shotgunSpreadDeg * Math.PI / 180;
          break;
        case 'weaponEnchant':
          u.weaponTrail = true;
          u.orbPierce = Math.max(1, u.orbPierce || 0);
          p.weaponTrail = true;
          p.orbPierce = u.orbPierce;
          break;
        case 'divineMeteor':
          this.divine.meteorLevel = 1;
          this.meteorCooldown = 0;
          break;
        case 'meteorSplit':
          this.divine.meteorLevel = 2;
          break;
        case 'meteorCooldown':
          this.divine.meteorLevel = 3;
          this.meteorCooldown = Math.min(this.meteorCooldown, 4);
          break;
        case 'divineShadow':
          // 首个暗影之舞同时解锁双充能与翻滚伤害。
          this.divine.shadowLevel = 2;
          p.rollMaxCharges = 2;
          p.rollCharges = 2;
          p.rollChargeTimer = 0;
          break;
        case 'shadowDamage':
          this.divine.shadowLevel = 2;
          break;
        case 'shadowTrap':
          this.divine.shadowLevel = 3;
          break;
        default:
          return null;
      }
      return choice.id;
    }

    chooseReward(index) {
      if (!this.upgradeChoiceOpen || this.state !== 'levelClear') return false;
      const choice = this.rewardChoices[index];
      if (!choice) return false;
      if (!this.applyRewardChoice(choice)) return false;

      this.upgradeChoiceOpen = false;
      this.hideUpgradeChoice();
      this.rewardChoices = [];

      if (this.pendingFinalClear) {
        this.pendingFinalClear = false;
        const finalKind = this.currentLevelId >= 8
          ? 'level8Clear'
          : (this.currentLevelId === 7
            ? 'level7Clear'
            : (this.currentLevelId === 6
              ? 'level6Clear'
              : (this.currentLevelId === 5 ? 'level5Clear' : 'level4Clear')));
        this.state = finalKind;
        this.showOverlay(finalKind);
        this.setGameState('REWARD', '最终结算');
        if (PF.UI && typeof PF.UI.switchUI === 'function') {
          PF.UI.switchUI('REWARD');
        }
        this.updateHud(true);
        return true;
      }

      const targetLevelId = this.currentLevelId + 1;
      const targetLevel = PF.LEVELS[`Level${targetLevelId}`];
      if (!targetLevel) return false;

      this.state = 'playing';
      this.setGameState('PLAYING', '奖励选择完成');
      this.levelExitPortal = {
        x: 640,
        y: 400,
        r: 56,
        label: `进入${targetLevel.layerName}`,
        sourceLevelId: this.currentLevelId,
        targetLevelId
      };
      this.portalCooldown = CFG.PORTAL.COOLDOWN;
      this.player.x = 640;
      this.player.y = 650;
      this.player.knockX = 0;
      this.player.knockY = 0;
      this.player.invuln = Math.max(this.player.invuln, 0.6);
      this.showToast(`${choice.title} · 走进中央传送阵`, 2.2);
      this.updateHud(true);
      return true;
    }

    chooseUpgrade(kind) {
      if (kind === 'hp') return this.chooseReward(0);
      if (kind === 'atk') return this.chooseReward(1);
      return false;
    }

    addShake(magnitude, duration) {
      if (magnitude >= this.shakeMagnitude || this.shakeTime <= 0) {
        this.shakeMagnitude = magnitude;
        this.shakeDuration = duration;
        this.shakeTime = duration;
      } else {
        this.shakeTime = Math.max(this.shakeTime, duration);
      }
    }

    spawnBurst(x, y, count, colors, speed, life) {
      const available = CFG.FX.MAX_PARTICLES - this.particles.length;
      const amount = Math.min(count, Math.max(0, available));
      for (let i = 0; i < amount; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = speed * (0.3 + Math.random() * 0.8);
        const particleLife = life * (0.55 + Math.random() * 0.8);
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity - 18,
          gravity: 150 + Math.random() * 120,
          drag: 1.8 + Math.random() * 2.6,
          life: particleLife,
          maxLife: particleLife,
          size: Math.random() < 0.25 ? 3 : 2,
          color: colors[Math.floor(Math.random() * colors.length)]
        });
      }
    }

    // ------------------------------------------------------------
    // 更新
    // ------------------------------------------------------------

    update(dt) {
      if (window.currentGameState === GAME_STATES.INTRO) {
        this.updateIntro(dt);
        return;
      }
      if (window.currentGameState === GAME_STATES.ENDING) {
        this.updateEnding(dt);
        return;
      }
      if (window.currentGameState !== GAME_STATES.PLAYING) return;

      this.time += dt;
      this.updateEffects(dt);
      this.updateDivineWhisper(dt);
      this.updateDivineOrb(dt);
      this.updateToast(dt);
      this.portalHintCooldown = Math.max(0, this.portalHintCooldown - dt);

      if (this.state !== 'playing') return;

      if (this.currentLevelId === 8 && this.scene === 'boss' &&
        this.boss && !this.divineIntroPlayed) {
        this.startDivineIntro();
      }
      if (this.cinematic) {
        this.updateDivineIntro(dt);
        return;
      }

      this.enemyAggroLockTimer = Math.max(0, this.enemyAggroLockTimer - dt);
      this.portalCooldown = Math.max(0, this.portalCooldown - dt);
      this.player.update(dt);
      this.updateCold(dt);
      if (this.state !== 'playing') return;
      this.updatePoisonTerrain(dt);
      this.updateLavaTerrain(dt);
      this.updateSpikeTraps(dt);
      this.updateAbyssTerrain(dt);
      this.updateQuicksand(dt);
      this.updateCurseSand(dt);
      if (this.state !== 'playing') return;

      // 场景切换后直接结束本帧，避免用旧场景的实体继续更新。
      if (this.checkPortalTrigger()) return;

      for (const tree of this.trees) tree.update(dt);
      for (const campfire of this.campfires) campfire.update(dt);

      if (this.scene === 'forest') {
        this.updateForestRoom(dt);
      } else {
        this.updateBossRoom(dt);
      }
      if (this.state !== 'playing') return;

      this.updateFireSpiritBombs(dt);
      if (this.state !== 'playing') return;
      this.updateLavaBalls(dt);
      if (this.state !== 'playing') return;
      this.updateEvilOrbs(dt);
      if (this.state !== 'playing') return;
      this.updateExecutionerHooks(dt);
      if (this.state !== 'playing') return;

      this.updateOrbs(dt);
      if (this.state !== 'playing') return;

      this.updateMeteors(dt);
      if (this.state !== 'playing') return;
      this.updateRollTraps(dt);
      if (this.state !== 'playing') return;

      this.updateCactusSpikes(dt);
      if (this.state !== 'playing') return;

      this.removeDeadEnemies();
      if (this.scene === 'forest') this.updateBossDoorState(dt);
    }

    updateForestRoom(dt) {
      for (const pod of this.pods) pod.update(dt);
      for (const cactus of this.cacti) cactus.update(dt);
      for (const enemy of this.enemies) enemy.update(dt);
      this.separateEnemies();
      this.handlePlayerEnemyContact();
    }

    startBlizzard(duration) {
      if (this.currentLevelId !== 4) return;
      this.blizzardTimer = Math.max(this.blizzardTimer, duration);
      this.blizzardActive = true;
      this.addShake(4.2, 0.4);
      this.showToast('暴风雪来袭 · 立刻寻找火堆！', 2.0);
    }

    updateCold(dt) {
      if (this.currentLevelId !== 4) {
        this.player.cold = 0;
        this.player.coldDamageTimer = 0;
        this.player.isWarming = false;
        this.blizzardActive = false;
        this.blizzardTimer = 0;
        return;
      }

      const cfg = this.currentLevel.mechanics.cold;
      if (this.blizzardTimer > 0) {
        this.blizzardTimer = Math.max(0, this.blizzardTimer - dt);
        this.blizzardActive = this.blizzardTimer > 0;
      } else {
        this.blizzardActive = false;
      }

      let warming = false;
      for (const campfire of this.campfires) {
        if (campfire.dead) continue;
        if (
          distance(
            this.player.x, this.player.y,
            campfire.x, campfire.y
          ) <= campfire.warmRadius
        ) {
          warming = true;
          break;
        }
      }

      this.player.isWarming = warming;
      let change = 0;
      if (this.blizzardActive) {
        change += CFG.SNOWMAN_BOSS.BLIZZARD_COLD_PER_SECOND * dt;
      } else if (!warming) {
        change += cfg.gainPerSecond * dt;
      }
      if (warming) change -= cfg.recoverPerSecond * dt;

      this.player.cold = Math.max(
        0,
        Math.min(cfg.max, this.player.cold + change)
      );

      if (this.player.cold >= cfg.max) {
        this.player.coldDamageTimer += dt;
        if (this.player.coldDamageTimer >= cfg.damageInterval) {
          this.player.coldDamageTimer -= cfg.damageInterval;
          this.player.takeColdDamage(cfg.damage);
          this.addShake(1.2, 0.08);
        }
      } else {
        this.player.coldDamageTimer = 0;
      }
    }


    removeDeadEnemies() {
      // 原地删除，保持 forestEnemies 引用不失效
      for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
        if (this.enemies[i].dead) this.enemies.splice(i, 1);
      }
    }

    updateEffects(dt) {
      if (this.shakeTime > 0) {
        this.shakeTime -= dt;
        if (this.shakeTime <= 0) {
          this.shakeTime = 0;
          this.shakeMagnitude = 0;
        }
      }

      for (let i = this.particles.length - 1; i >= 0; i -= 1) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.gravity * dt;
        const drag = Math.exp(-p.drag * dt);
        p.vx *= drag;
        p.vy *= drag;
      }

      for (let i = this.gasExplosions.length - 1; i >= 0; i -= 1) {
        const explosion = this.gasExplosions[i];
        explosion.age += dt;
        if (explosion.age >= explosion.duration) this.gasExplosions.splice(i, 1);
      }

      for (let i = this.rollGhosts.length - 1; i >= 0; i -= 1) {
        const ghost = this.rollGhosts[i];
        ghost.age += dt;
        if (ghost.age >= ghost.duration) this.rollGhosts.splice(i, 1);
      }
    }

    spawnRollGhost(player) {
      this.rollGhosts.push({
        x: player.x,
        y: player.y,
        angle: player.aimAngle,
        age: 0,
        duration: CFG.ROLL.GHOST_LIFETIME
      });
      if (this.rollGhosts.length > 20) this.rollGhosts.shift();
    }

    drawRollGhosts(ctx) {
      for (const ghost of this.rollGhosts) {
        const t = 1 - ghost.age / ghost.duration;
        if (t <= 0) continue;
        const x = Math.round(ghost.x);
        const y = Math.round(ghost.y);
        ctx.save();
        ctx.globalAlpha = Math.max(0, t) * 0.34;
        ctx.fillStyle = '#76c9ff';
        ctx.fillRect(x - 7, y - 14, 14, 10);
        ctx.fillRect(x - 8, y - 5, 16, 12);
        ctx.fillStyle = 'rgba(184, 234, 255, .55)';
        ctx.fillRect(x - 6, y - 13, 4, 4);
        ctx.fillRect(x - 5, y + 6, 4, 6);
        ctx.fillRect(x + 2, y + 6, 4, 6);
        ctx.restore();
      }
    }

    drawRollTraps(ctx) {
      for (const trap of this.rollTraps) {
        const x = Math.round(trap.x);
        const y = Math.round(trap.y);
        const pulse = 0.5 + Math.sin(this.time * 16 + trap.phase) * 0.25;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#ff5a22';
        for (let i = -2; i <= 2; i += 1) {
          ctx.fillRect(x + i * 12 - 3, y - 28, 6, 4);
          ctx.fillRect(x + i * 12 - 3, y + 24, 6, 4);
          ctx.fillRect(x - 28, y + i * 12 - 3, 4, 6);
          ctx.fillRect(x + 24, y + i * 12 - 3, 4, 6);
        }
        ctx.fillStyle = '#ffcf63';
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.fillStyle = '#2a0c08';
        ctx.fillRect(x - 2, y - 2, 4, 4);
        ctx.globalAlpha = 1;
      }
    }

    drawMeteors(ctx) {
      for (const meteor of this.meteors) {
        const x = Math.round(meteor.x);
        const y = Math.round(meteor.y);
        const size = meteor.small ? 6 : 13;
        for (let i = 4; i >= 1; i -= 1) {
          const tx = Math.round(x - meteor.dirX * i * (meteor.small ? 5 : 8));
          const ty = Math.round(y - meteor.dirY * i * (meteor.small ? 5 : 8));
          ctx.globalAlpha = 0.3 - i * 0.05;
          ctx.fillStyle = '#ff7a2f';
          ctx.fillRect(tx - size * 0.25, ty - size * 0.25, size * 0.5, size * 0.5);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#4b1208';
        ctx.fillRect(x - size - 2, y - size - 2, size * 2 + 4, size * 2 + 4);
        ctx.fillStyle = '#ff6a28';
        ctx.fillRect(x - size, y - size, size * 2, size * 2);
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(x - size * 0.55, y - size * 0.55, size * 1.1, size * 1.1);
        ctx.fillStyle = '#fff3c4';
        ctx.fillRect(x - size * 0.22, y - size * 0.22, size * 0.44, size * 0.44);
      }
    }

    drawLavaBalls(ctx) {
      for (const ball of this.lavaBalls) {
        ctx.save();
        ctx.globalAlpha = 0.30;
        ctx.fillStyle = '#ff5a22';
        for (let i = 3; i >= 1; i -= 1) {
          const tx = ball.x - ball.dirX * i * 10;
          const ty = ball.y - ball.dirY * i * 10;
          ctx.fillRect(tx - 5, ty - 5, 10, 10);
        }
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius + 3, 0, Math.PI * 2);
        ctx.fillStyle = '#3a0b06';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#ff5a22';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ball.x - 2, ball.y - 2, ball.radius * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd166';
        ctx.fill();
        ctx.restore();
      }
    }

    drawMeteorFlash(ctx) {
      if (this.meteorFlashTimer <= 0) return;
      const alpha = Math.min(0.34, this.meteorFlashTimer * 1.5);
      ctx.fillStyle = `rgba(255, 116, 42, ${alpha})`;
      ctx.fillRect(0, 0, CFG.WORLD.W, CFG.WORLD.H);
    }

    separateEnemies() {
      const alive = this.enemies.filter(
        (enemy) => !enemy.dead && !enemy.burrowed && !enemy.bones
      );

      for (let i = 0; i < alive.length; i += 1) {
        for (let j = i + 1; j < alive.length; j += 1) {
          const a = alive[i];
          const b = alive[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          const minDist = a.radius + b.radius + CFG.ENEMY.SEPARATION_PADDING;

          if (dist >= minDist) continue;

          if (dist < 0.001) {
            dx = 1;
            dy = 0;
            dist = 1;
          }

          const overlap = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const ny = dy / dist;

          moveBody(this, a, -nx * overlap, -ny * overlap, a.radius, a.radius);
          moveBody(this, b, nx * overlap, ny * overlap, b.radius, b.radius);
        }
      }
    }

    handlePlayerEnemyContact() {
      const player = this.player;

      for (const enemy of this.enemies) {
        if (enemy.dead || enemy.burrowed || enemy.bones || player.rolling) continue;
        // 雪怪蓄力/滞空/下砸/僵直期间不产生碰撞伤害，只在落地瞬间判定。
        if (enemy.type === 'giantYeti' && enemy.slamState) continue;

        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const dist = Math.hypot(dx, dy);
        const minDist = player.halfW + enemy.radius - 1;
        if (dist >= minDist) continue;

        if (player.invuln <= 0) {
          player.takeDamage(enemy.archetype.contactDamage, enemy.x, enemy.y);
          if (player.invuln > 0) {
            if (enemy.archetype.contactSlow) {
              player.applyTongueSlow(
                enemy.archetype.contactSlow.duration,
                enemy.archetype.contactSlow.multiplier
              );
            }
            const nx = dist > 0.001 ? dx / dist : 1;
            const ny = dist > 0.001 ? dy / dist : 0;
            enemy.knockX = -nx * CFG.ENEMY.CONTACT_PUSH;
            enemy.knockY = -ny * CFG.ENEMY.CONTACT_PUSH;
          }
          if (this.state !== 'playing') return;
        } else {
          // 无敌时只做位置分离，避免小怪一直叠在玩家身上
          const nx = dist > 0.001 ? dx / dist : 1;
          const ny = dist > 0.001 ? dy / dist : 0;
          const push = minDist - dist;
          moveBody(this, player, nx * push * 0.2, ny * push * 0.2, player.halfW, player.halfH);
          moveBody(this, enemy, -nx * push * 0.8, -ny * push * 0.8, enemy.radius, enemy.radius);
        }
      }
    }

    castMeteor() {
      if (this.state !== 'playing' || !this.divine || this.divine.meteorLevel <= 0) {
        return false;
      }
      if (this.player.silenceTimer > 0) return false;
      if (this.meteorCooldown > 0) return false;
      const player = this.player;
      const bonus = this.playerUpgrades.orbDamageBonus || 0;
      const dx = Math.cos(player.aimAngle);
      const dy = Math.sin(player.aimAngle);
      this.meteors.push({
        x: player.x + dx * 28,
        y: player.y + dy * 28,
        dirX: dx,
        dirY: dy,
        speed: 460,
        radius: 15,
        damage: 30 + bonus,
        split: this.divine.meteorLevel >= 2,
        small: false,
        life: 1.5,
        trail: 0
      });
      this.meteorCooldown = this.divine.meteorLevel >= 3 ? 4 : 8;
      this.addShake(4.2, 0.25);
      this.showToast('陨石火球！', 1.0);
      return true;
    }

    explodeMeteor(meteor) {
      const bonus = this.playerUpgrades.orbDamageBonus || 0;
      const radius = meteor.small ? 60 : 150;
      const x = meteor.x;
      const y = meteor.y;
      for (const enemy of this.enemies) {
        if (enemy.dead || enemy.burrowed) continue;
        if (distance(x, y, enemy.x, enemy.y) <= radius + enemy.radius) {
          enemy.takeDamage(meteor.damage, x, y);
        }
      }
      const boss = this.boss;
      if (
        boss &&
        boss.state === 'active' &&
        !boss.burrowed &&
        distance(x, y, boss.x, boss.y) <= radius + boss.contactHalf
      ) {
        boss.takeDamage(meteor.damage, x, y, 'orb');
      }
      this.spawnBurst(
        x, y, meteor.small ? 16 : 42,
        ['#ffe08a', '#ff9a3c', '#ff4f1f', '#5a1710'],
        meteor.small ? 130 : 240, 0.7
      );
      this.addShake(meteor.small ? 3.5 : 8.5, meteor.small ? 0.18 : 0.45);
      if (!meteor.small) {
        this.meteorFlashTimer = 0.28;
        if (meteor.split) {
          const damage = 10;
          for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
            this.meteors.push({
              x,
              y,
              dirX: Math.cos(angle),
              dirY: Math.sin(angle),
              speed: 340,
              radius: 8,
              damage,
              split: false,
              small: true,
              life: 0.8,
              trail: 0
            });
          }
        }
      }
    }

    updateMeteors(dt) {
      this.meteorCooldown = Math.max(0, this.meteorCooldown - dt);
      this.meteorFlashTimer = Math.max(0, this.meteorFlashTimer - dt);
      for (let i = this.meteors.length - 1; i >= 0; i -= 1) {
        const meteor = this.meteors[i];
        meteor.life -= dt;
        meteor.trail += dt;
        const nx = meteor.x + meteor.dirX * meteor.speed * dt;
        const ny = meteor.y + meteor.dirY * meteor.speed * dt;
        let hit = false;
        if (isCircleBlocked(this, nx, ny, meteor.radius * 0.55)) hit = true;
        for (const enemy of this.enemies) {
          if (enemy.dead || enemy.burrowed) continue;
          if (distance(nx, ny, enemy.x, enemy.y) < meteor.radius + enemy.radius) {
            hit = true;
            break;
          }
        }
        const boss = this.boss;
        if (
          boss && boss.state === 'active' && !boss.burrowed &&
          distance(nx, ny, boss.x, boss.y) < meteor.radius + boss.contactHalf
        ) hit = true;
        if (hit || meteor.life <= 0) {
          meteor.x = nx;
          meteor.y = ny;
          this.explodeMeteor(meteor);
          this.meteors.splice(i, 1);
        } else {
          meteor.x = nx;
          meteor.y = ny;
        }
      }
    }

    spawnRollTrap(x, y) {
      this.rollTraps.push({
        x, y, timer: 1, radius: 82, phase: Math.random() * Math.PI * 2
      });
    }

    updateRollTraps(dt) {
      for (let i = this.rollTraps.length - 1; i >= 0; i -= 1) {
        const trap = this.rollTraps[i];
        trap.timer -= dt;
        if (trap.timer > 0) continue;
        for (const enemy of this.enemies) {
          if (enemy.dead || enemy.burrowed) continue;
          if (distance(trap.x, trap.y, enemy.x, enemy.y) <= trap.radius + enemy.radius) {
            enemy.takeDamage(20, trap.x, trap.y);
          }
        }
        const boss = this.boss;
        if (
          boss && boss.state === 'active' && !boss.burrowed &&
          distance(trap.x, trap.y, boss.x, boss.y) <= trap.radius + boss.contactHalf
        ) {
          boss.takeDamage(20, trap.x, trap.y, 'orb');
        }
        this.spawnBurst(
          trap.x, trap.y, 28,
          ['#ffcf63', '#ff6a28', '#b72a10'], 180, 0.65
        );
        this.addShake(6.2, 0.35);
        this.rollTraps.splice(i, 1);
      }
    }

    spawnWaterRipple(x, y, scale = 1) {
      this.ripples.push({
        x, y,
        radius: 5 * scale,
        life: 0.7,
        maxLife: 0.7,
        scale,
        phase: Math.random() * Math.PI * 2
      });
    }

    updateAbyssTerrain(dt) {
      if (this.currentLevelId !== 7 || this.state !== 'playing') return;

      this.rippleTimer = Math.max(0, this.rippleTimer - dt);
      if (this.player.moving && this.rippleTimer === 0) {
        this.spawnWaterRipple(this.player.x, this.player.y + 9, 1);
        this.rippleTimer = 0.16;
      }
      for (const enemy of this.enemies) {
        if (enemy.dead || enemy.bones || !enemy.moving) continue;
        if (Math.random() < dt * 2.4) {
          this.spawnWaterRipple(enemy.x, enemy.y + 8, enemy.radius / 20);
        }
      }
      if (this.boss && this.boss.state === 'active' && this.boss.moving &&
        Math.random() < dt * 2.2) {
        this.spawnWaterRipple(this.boss.x, this.boss.y + 50, 2);
      }

      for (let i = this.ripples.length - 1; i >= 0; i -= 1) {
        const ripple = this.ripples[i];
        ripple.life -= dt;
        ripple.radius += dt * 24;
        if (ripple.life <= 0) this.ripples.splice(i, 1);
      }

      if (!this.player.rolling) {
        for (const pool of this.whirlpools || []) {
          const dx = pool.x - this.player.x;
          const dy = pool.y - this.player.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 1 && dist < pool.radius * 1.5) {
            const pull = pool.strength * (1 - dist / (pool.radius * 1.5));
            this.player.x += (dx / dist) * pull * dt;
            this.player.y += (dy / dist) * pull * dt;
          }
        }
      }

      for (let i = this.inkPools.length - 1; i >= 0; i -= 1) {
        const ink = this.inkPools[i];
        ink.life -= dt;
        if (ink.life <= 0) {
          this.inkPools.splice(i, 1);
          continue;
        }
        if (distance(ink.x, ink.y, this.player.x, this.player.y) <
          ink.radius + this.player.halfW) {
          this.player.inkBlindTimer = Math.max(
            this.player.inkBlindTimer,
            PF.ENEMY_ARCHETYPES.octopus.ink.blindTime
          );
        }
      }
    }

    spawnInk(x, y) {
      const cfg = PF.ENEMY_ARCHETYPES.octopus.ink;
      for (let i = 0; i < cfg.blobCount; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 18 + Math.random() * 87;
        this.inkPools.push({
          x: x + Math.cos(angle) * dist,
          y: y + Math.sin(angle) * dist,
          radius: 20 + Math.random() * 22,
          life: cfg.poolLife,
          maxLife: cfg.poolLife,
          phase: Math.random() * Math.PI * 2
        });
      }
    }

    drawWaterRipples(ctx) {
      for (const ripple of this.ripples) {
        const t = 1 - ripple.life / ripple.maxLife;
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.55;
        ctx.strokeStyle = '#d9f7ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha *= 0.55;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ripple.radius * 0.62, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    drawWhirlpools(ctx) {
      for (const pool of this.whirlpools || []) {
        ctx.save();
        ctx.translate(pool.x, pool.y);
        for (let i = 0; i < 4; i += 1) {
          ctx.strokeStyle = `rgba(116, 201, 230, ${0.18 - i * 0.025})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, pool.radius * (0.35 + i * 0.17),
            pool.phase + this.time * (0.5 + i * 0.12),
            pool.phase + this.time * (0.5 + i * 0.12) + Math.PI * 1.35);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(2, 12, 24, .34)';
        ctx.beginPath();
        ctx.arc(0, 0, pool.radius * 0.26, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    drawInkPools(ctx) {
      for (const ink of this.inkPools) {
        const alpha = Math.min(1, ink.life / 1.2) * 0.72;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#0c0812';
        ctx.beginPath();
        ctx.arc(ink.x, ink.y, ink.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = '#24162e';
        ctx.beginPath();
        ctx.arc(
          ink.x + Math.sin(ink.phase) * ink.radius * 0.22,
          ink.y + Math.cos(ink.phase) * ink.radius * 0.18,
          ink.radius * 0.56, 0, Math.PI * 2
        );
        ctx.fill();
        ctx.restore();
      }
    }

    drawInkOverlay(ctx) {
      if (!this.player || this.player.inkBlindTimer <= 0) return;
      const t = this.player.inkBlindTimer;
      ctx.save();
      ctx.globalAlpha = Math.min(0.82, 0.22 + t * 0.25);
      ctx.fillStyle = '#07040b';
      for (let i = 0; i < 24; i += 1) {
        const x = ((i * 173 + Math.sin(this.time * 0.7 + i) * 30) %
          CFG.WORLD.W + CFG.WORLD.W) % CFG.WORLD.W;
        const y = ((i * 97 + Math.cos(this.time * 0.6 + i * 1.7) * 26) %
          CFG.WORLD.H + CFG.WORLD.H) % CFG.WORLD.H;
        const r = 34 + (i % 5) * 14;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    updateSpikeTraps(dt) {
      if (this.currentLevelId !== 6 || this.state !== 'playing') {
        this.spikeTrapCooldown = 0;
        return;
      }
      this.spikeTrapCooldown = Math.max(0, this.spikeTrapCooldown - dt);
      if (this.spikeTrapCooldown > 0) return;
      const p = this.player;
      for (const trap of this.spikeTraps || []) {
        if (
          p.x + p.halfW > trap.x &&
          p.x - p.halfW < trap.x + trap.w &&
          p.y + p.halfH > trap.y &&
          p.y - p.halfH < trap.y + trap.h
        ) {
          const before = p.hp;
          p.takeDamage(3, trap.x + trap.w / 2, trap.y + trap.h / 2);
          if (p.hp < before) {
            const dx = p.x - (trap.x + trap.w / 2);
            const dy = p.y - (trap.y + trap.h / 2);
            const len = Math.max(1, Math.hypot(dx, dy));
            p.knockX += (dx / len) * 260;
            p.knockY += (dy / len) * 260;
          }
          this.spikeTrapCooldown = 1;
          if (this.state !== 'playing') return;
          break;
        }
      }
    }

    isSafeMagePosition(x, y, half) {
      const margin = CFG.WORLD.WALL + half + 8;
      if (x < margin || x > CFG.WORLD.W - margin) return false;
      if (y < margin || y > CFG.WORLD.H - margin) return false;
      if (isCircleBlocked(this, x, y, half)) return false;
      for (const trap of this.spikeTraps || []) {
        const closestX = clamp(x, trap.x, trap.x + trap.w);
        const closestY = clamp(y, trap.y, trap.y + trap.h);
        if (distance(x, y, closestX, closestY) < half + 10) return false;
      }
      return true;
    }

    spawnEvilOrb(x, y, targetX, targetY) {
      const cfg = CFG.EVIL_MAGE_BOSS;
      const angle = Math.atan2(targetY - y, targetX - x);
      this.evilOrbs.push({
        x: x + Math.cos(angle) * 32,
        y: y + Math.sin(angle) * 32,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
        speed: cfg.ORB_SPEED,
        radius: 10,
        damage: cfg.ORB_DAMAGE,
        life: cfg.ORB_LIFE,
        age: 0,
        homing: true
      });
    }

    spawnShadowScatter(x, y, targetX, targetY) {
      const cfg = CFG.EVIL_MAGE_BOSS;
      const base = Math.atan2(targetY - y, targetX - x);
      for (let i = 0; i < cfg.SCATTER_COUNT; i += 1) {
        const angle = base + (i - (cfg.SCATTER_COUNT - 1) / 2) * cfg.SCATTER_SPREAD;
        this.evilOrbs.push({
          x: x + Math.cos(angle) * 36,
          y: y + Math.sin(angle) * 36,
          dirX: Math.cos(angle),
          dirY: Math.sin(angle),
          speed: cfg.SCATTER_SPEED,
          radius: cfg.SCATTER_RADIUS,
          damage: cfg.SCATTER_DAMAGE,
          life: cfg.SCATTER_LIFE,
          age: 0,
          homing: false
        });
      }
    }

    updateEvilOrbs(dt) {
      for (let i = this.evilOrbs.length - 1; i >= 0; i -= 1) {
        const orb = this.evilOrbs[i];
        orb.age += dt;
        orb.life -= dt;
        if (orb.life <= 0) {
          this.evilOrbs.splice(i, 1);
          continue;
        }
        const player = this.player;
        if (orb.homing !== false) {
          const angle = Math.atan2(player.y - orb.y, player.x - orb.x);
          orb.dirX = Math.cos(angle);
          orb.dirY = Math.sin(angle);
        }
        const nx = orb.x + orb.dirX * orb.speed * dt;
        const ny = orb.y + orb.dirY * orb.speed * dt;

        if (isCircleBlocked(this, nx, ny, orb.radius)) {
          this.spawnBurst(
            nx, ny, 10,
            ['#b26cff', '#6b3e9b', '#24112e'], 80, 0.35
          );
          this.evilOrbs.splice(i, 1);
          continue;
        }
        if (
          distance(nx, ny, player.x, player.y) <=
          orb.radius + player.halfW
        ) {
          player.takeDamage(orb.damage, orb.x, orb.y);
          this.spawnBurst(
            nx, ny, 12,
            ['#b26cff', '#e5d8ff', '#6b3e9b'], 110, 0.4
          );
          this.evilOrbs.splice(i, 1);
          if (this.state !== 'playing') return;
          continue;
        }
        orb.x = nx;
        orb.y = ny;
      }
    }

    spawnExecutionerHook(owner, targetX, targetY, cfg) {
      const angle = Math.atan2(targetY - owner.y, targetX - owner.x);
      this.executionerHooks.push({
        owner,
        x: owner.x + Math.cos(angle) * 34,
        y: owner.y + Math.sin(angle) * 34,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
        speed: cfg.speed,
        damage: cfg.damage,
        radius: 8,
        maxDistance: cfg.maxDistance,
        traveled: 0
      });
    }

    updateExecutionerHooks(dt) {
      for (let i = this.executionerHooks.length - 1; i >= 0; i -= 1) {
        const hook = this.executionerHooks[i];
        if (!hook.owner || hook.owner.dead) {
          this.executionerHooks.splice(i, 1);
          continue;
        }
        const nx = hook.x + hook.dirX * hook.speed * dt;
        const ny = hook.y + hook.dirY * hook.speed * dt;
        hook.traveled += hook.speed * dt;
        if (
          isCircleBlocked(this, nx, ny, hook.radius) ||
          hook.traveled >= hook.maxDistance
        ) {
          this.spawnBurst(nx, ny, 5, ['#6e1712', '#1c1b22'], 60, 0.25);
          this.executionerHooks.splice(i, 1);
          continue;
        }
        if (
          distance(nx, ny, this.player.x, this.player.y) <=
          hook.radius + this.player.halfW
        ) {
          const hit = this.player.takeDamage(
            hook.damage, hook.x, hook.y
          );
          if (hit) hook.owner.pullTimer = hook.owner.archetype.hook.pullTime;
          this.spawnBurst(nx, ny, 8, ['#8e8a94', '#6e1712'], 80, 0.3);
          this.executionerHooks.splice(i, 1);
          if (this.state !== 'playing') return;
          continue;
        }
        hook.x = nx;
        hook.y = ny;
      }
    }

    drawExecutionerHooks(ctx) {
      for (const hook of this.executionerHooks) {
        if (!hook.owner) continue;
        const dx = hook.x - hook.owner.x;
        const dy = hook.y - hook.owner.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const steps = Math.ceil(dist / 12);
        ctx.save();
        for (let i = 0; i < steps; i += 1) {
          const t = i / steps;
          const x = hook.owner.x + dx * t;
          const y = hook.owner.y + dy * t;
          ctx.fillStyle = i % 2 === 0 ? '#6e1712' : '#8e8a94';
          ctx.fillRect(x - 2, y - 2, 4, 4);
        }
        ctx.fillStyle = '#3a3942';
        ctx.fillRect(hook.x - 7, hook.y - 7, 14, 14);
        ctx.fillStyle = '#6e1712';
        ctx.fillRect(hook.x - 4, hook.y - 4, 8, 8);
        ctx.restore();
      }
    }

    drawEvilOrbs(ctx) {
      for (const orb of this.evilOrbs) {
        const alpha = orb.life < 1 ? Math.max(0.2, orb.life) : 1;
        ctx.save();
        ctx.globalAlpha = 0.20 * alpha;
        ctx.fillStyle = '#b26cff';
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius + 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#24112e';
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6b3e9b';
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d8c8ff';
        ctx.beginPath();
        ctx.arc(orb.x - 2, orb.y - 2, orb.radius * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    isLineBlockedByObsidian(x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      for (const wall of this.obsidianWalls || []) {
        const t = rayAABB(x1, y1, dx, dy, wall);
        if (t !== null) return true;
      }
      return false;
    }

    spawnFireSpiritBomb(x, y, settings = {}) {
      this.fireSpiritBombs.push({
        x, y,
        radius: settings.radius || 72,
        damage: settings.damage || 4,
        duration: settings.warnTime || 0.6,
        timer: settings.warnTime || 0.6,
        phase: Math.random() * Math.PI * 2
      });
    }

    updateFireSpiritBombs(dt) {
      for (let i = this.fireSpiritBombs.length - 1; i >= 0; i -= 1) {
        const bomb = this.fireSpiritBombs[i];
        bomb.timer -= dt;
        if (bomb.timer > 0) continue;
        const player = this.player;
        if (
          distance(bomb.x, bomb.y, player.x, player.y) <=
            bomb.radius + player.halfW &&
          !this.isLineBlockedByObsidian(bomb.x, bomb.y, player.x, player.y)
        ) {
          player.takeDamage(bomb.damage, bomb.x, bomb.y);
        }
        this.spawnBurst(
          bomb.x, bomb.y, 22,
          ['#ff4f1f', '#ff9a3c', '#ffd166', '#5a1710'],
          150, 0.55
        );
        this.addShake(4.5, 0.22);
        this.fireSpiritBombs.splice(i, 1);
        if (this.state !== 'playing') return;
      }
    }

    spawnLavaBall(x, y, targetX, targetY, settings = {}) {
      const angle = Math.atan2(targetY - y, targetX - x);
      this.lavaBalls.push({
        x: x + Math.cos(angle) * 24,
        y: y + Math.sin(angle) * 24,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
        speed: settings.speed || 175,
        radius: settings.radius || 9,
        damage: settings.damage || 4,
        maxDistance: settings.maxDistance || 540,
        poolRadius: settings.poolRadius || 28,
        poolDuration: settings.poolDuration || 5,
        traveled: 0,
        phase: Math.random() * Math.PI * 2
      });
    }

    spawnLavaPool(x, y, radius, duration) {
      const room = this.getCurrentRoom();
      if (!room || !room.lavaPools) return;
      room.lavaPools.push({
        x, y, radius,
        phase: Math.random() * Math.PI * 2,
        temporary: true,
        age: 0,
        duration
      });
      this.lavaPools = room.lavaPools;
    }

    shatterLavaBall(ball, leavePool = true) {
      this.spawnBurst(
        ball.x, ball.y, 18,
        ['#ff4f1f', '#ff8a3c', '#5a1710', '#ffd166'],
        130, 0.55
      );
      this.addShake(2.4, 0.12);
      if (leavePool) {
        this.spawnLavaPool(
          ball.x, ball.y,
          ball.poolRadius, ball.poolDuration
        );
      }
    }

    updateLavaBalls(dt) {
      for (let i = this.lavaBalls.length - 1; i >= 0; i -= 1) {
        const ball = this.lavaBalls[i];
        const nx = ball.x + ball.dirX * ball.speed * dt;
        const ny = ball.y + ball.dirY * ball.speed * dt;
        ball.traveled += ball.speed * dt;

        const player = this.player;
        if (
          distance(nx, ny, player.x, player.y) <=
            ball.radius + player.halfW
        ) {
          player.takeDamage(ball.damage, ball.x, ball.y);
          this.spawnBurst(
            nx, ny, 12,
            ['#ff4f1f', '#ff9a3c', '#ffd166'],
            110, 0.4
          );
          this.lavaBalls.splice(i, 1);
          if (this.state !== 'playing') return;
          continue;
        }

        if (
          isCircleBlocked(this, nx, ny, ball.radius) ||
          ball.traveled >= ball.maxDistance
        ) {
          this.shatterLavaBall(ball, true);
          this.lavaBalls.splice(i, 1);
          continue;
        }

        ball.x = nx;
        ball.y = ny;
      }
    }

    updateOrbs(dt) {
      for (const orb of this.orbs.orbs) {
        if (!orb.active) continue;

        orb.age += dt;
        const dx = orb.dirX * orb.speed * dt;
        const dy = orb.dirY * orb.speed * dt;
        const hit = this.findOrbHit(orb, dx, dy);

        if (!hit) {
          orb.x += dx;
          orb.y += dy;
          continue;
        }

        const hitX = orb.x + dx * hit.t;
        const hitY = orb.y + dy * hit.t;
        orb.x = hitX;
        orb.y = hitY;
        orb.active = false;

        if (hit.kind === 'wall') {
          const colors = orb.team === 'enemy' ? PALETTE.enemyOrbSpark : PALETTE.sparkColors;
          this.spawnBurst(hitX, hitY, 4, colors, 95, 0.28);
        } else if (hit.kind === 'tree') {
          // 玩家法球和敌方法球都会被树挡下，并各扣树 1 点 HP。
          hit.target.hit(orb.treeDamage, hitX, hitY);
        } else if (hit.kind === 'pod') {
          // 毒囊阻挡所有法球；只有玩家法球会削减毒囊 HP。
          if (orb.team === 'player') {
            hit.target.takeDamage(orb.damage);
          } else {
            this.spawnBurst(hitX, hitY, 4, ['#9b64ff', '#59d06d'], 65, 0.25);
          }
          if (this.state !== 'playing') return;
        } else if (hit.kind === 'cactus') {
          // 仙人掌同样阻挡法球，但只被玩家法球削减 HP。
          if (orb.team === 'player') {
            hit.target.takeDamage(orb.damage);
          } else {
            this.spawnBurst(hitX, hitY, 4, ['#6f8e3f', '#d8b268'], 65, 0.25);
          }
          if (this.state !== 'playing') return;
        } else if (hit.kind === 'campfire') {
          if (orb.team === 'player') {
            hit.target.takeDamage(orb.damage);
          }
          this.spawnBurst(
            hitX, hitY, 5,
            ['#ffd36a', '#f08a4b', '#dfe8ef'], 70, 0.3
          );
        } else if (hit.kind === 'enemy') {
          hit.target.takeDamage(orb.damage, orb.x - orb.dirX, orb.y - orb.dirY);
          this.spawnBurst(hitX, hitY, 5, PALETTE.sparkColors, 80, 0.3);
          if (orb.team === 'player' && orb.pierce > 0) {
            orb.pierce -= 1;
            orb.hitEnemies.push(hit.target);
            orb.active = true;
            orb.x = hitX + orb.dirX * (hit.target.radius + orb.radius + 2);
            orb.y = hitY + orb.dirY * (hit.target.radius + orb.radius + 2);
          }
        } else if (hit.kind === 'boss') {
          hit.target.takeDamage(orb.damage, hitX, hitY, 'orb');
          this.spawnBurst(hitX, hitY, 7, PALETTE.leafColors, 95, 0.35);
        } else if (hit.kind === 'player') {
          const damaged = hit.target.takeDamage(orb.damage, orb.x, orb.y);
          if (damaged && orb.cold > 0) hit.target.addCold(orb.cold);
          this.spawnBurst(hitX, hitY, 5, PALETTE.enemyOrbSpark, 80, 0.3);
          if (this.state !== 'playing') return;
        }
      }
    }

    /** 沼气毒囊爆炸：150px 内敌我不分，造成 15 点伤害。 */
    explodeGasPod(pod) {
      const cfg = this.currentLevel &&
        this.currentLevel.mechanics &&
        this.currentLevel.mechanics.gasPod;
      if (!cfg) return;

      const idx = this.pods.indexOf(pod);
      if (idx !== -1) this.pods.splice(idx, 1);

      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (distance(enemy.x, enemy.y, pod.x, pod.y) <= cfg.explosionRadius) {
          enemy.takeDamage(cfg.explosionDamage, pod.x, pod.y);
        }
      }

      if (
        this.boss && this.boss.type === 'swampFrog' &&
        this.boss.state === 'active' &&
        distance(this.boss.x, this.boss.y, pod.x, pod.y) <= cfg.explosionRadius
      ) {
        this.boss.takeDamage(cfg.explosionDamage, pod.x, pod.y, 'pod');
      }

      if (distance(this.player.x, this.player.y, pod.x, pod.y) <= cfg.explosionRadius) {
        this.player.takeDamage(cfg.explosionDamage, pod.x, pod.y);
      }

      this.gasExplosions.push({
        x: pod.x,
        y: pod.y,
        radius: cfg.explosionRadius,
        age: 0,
        duration: 0.7
      });
      this.spawnBurst(
        pod.x, pod.y, 32,
        ['#a866ff', '#66e07b', '#d5ffac', '#6b3f8f'],
        220, 0.85
      );
      this.addShake(6.5, 0.36);
    }

    onCampfireExtinguished(campfire) {
      this.spawnBurst(
        campfire.x, campfire.y - 8, 20,
        ['#ffd36a', '#f08a4b', '#8a4a2a', '#dfe8ef'],
        135, 0.6
      );
      this.addShake(3.0, 0.2);
      this.showToast('火堆熄灭 · 这里不能再取暖了', 1.8);
    }

    onCactusDestroyed(cactus) {
      const cfg = this.currentLevel &&
        this.currentLevel.mechanics &&
        this.currentLevel.mechanics.cactus;
      if (!cfg) return;

      this.spawnBurst(
        cactus.x, cactus.y - 4, 18,
        ['#5e8a3a', '#8fb85a', '#d8c27a', '#7a4d28'],
        125, 0.6
      );
      this.addShake(3.6, 0.24);

      for (let i = 0; i < cfg.spikeCount; i += 1) {
        const angle = (i / cfg.spikeCount) * Math.PI * 2;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        this.spikes.push({
          x: cactus.x + dx * (cactus.radius + 2),
          y: cactus.y + dy * (cactus.radius + 2),
          dirX: dx,
          dirY: dy,
          speed: cfg.spikeSpeed,
          damage: cfg.spikeDamage,
          radius: cfg.spikeRadius,
          age: 0,
          life: cfg.spikeLife,
          dead: false
        });
      }
    }

    updateCactusSpikes(dt) {
      if (!this.spikes || this.spikes.length === 0) return;

      const wall = CFG.WORLD.WALL;
      for (const spike of this.spikes) {
        if (spike.dead) continue;
        spike.age += dt;
        if (spike.age >= spike.life) {
          spike.dead = true;
          continue;
        }

        spike.x += spike.dirX * spike.speed * dt;
        spike.y += spike.dirY * spike.speed * dt;

        if (
          spike.x < wall + spike.radius ||
          spike.x > CFG.WORLD.W - wall - spike.radius ||
          spike.y < wall + spike.radius ||
          spike.y > CFG.WORLD.H - wall - spike.radius
        ) {
          spike.dead = true;
          continue;
        }

        if (
          this.state === 'playing' &&
          distance(spike.x, spike.y, this.player.x, this.player.y) <=
            spike.radius + this.player.halfW &&
          this.player.invuln <= 0
        ) {
          this.player.takeDamage(spike.damage, spike.x, spike.y);
          spike.dead = true;
          if (this.state !== 'playing') return;
          continue;
        }

        for (const enemy of this.enemies) {
          if (enemy.dead || enemy.burrowed) continue;
          if (distance(spike.x, spike.y, enemy.x, enemy.y) <=
            spike.radius + enemy.radius) {
            enemy.takeDamage(spike.damage, spike.x, spike.y);
            spike.dead = true;
            break;
          }
        }

        // 仙人掌陷阱：每根尖刺对深渊沙虫造成 2 点伤害。
        if (
          !spike.dead &&
          this.scene === 'boss' &&
          this.boss &&
          this.boss.type === 'sandworm' &&
          this.boss.state === 'active' &&
          !this.boss.burrowed &&
          distance(spike.x, spike.y, this.boss.x, this.boss.y) <=
            this.boss.contactHalf + spike.radius
        ) {
          this.boss.takeDamage(2, spike.x, spike.y, 'cactus');
          spike.dead = true;
        }
      }

      for (let i = this.spikes.length - 1; i >= 0; i -= 1) {
        if (this.spikes[i].dead) this.spikes.splice(i, 1);
      }
    }

    /**
     * 用扫掠线段寻找法球最先命中的物体。
     * 树、墙、怪物、玩家都会让法球立即消失；返回 kind/target/t。
     * 玩家法球与敌方法球使用同一套碰撞逻辑，仅命中目标阵营不同。
     */
    findOrbHit(orb, dx, dy) {
      let best = null;

      const consider = (t, kind, target) => {
        if (t === null || t < 0 || t > 1) return;
        if (!best || t < best.t) best = { t, kind, target };
      };

      // 墙体
      for (const wallRect of WALL_RECTS) {
        const expanded = expandRect(wallRect, orb.radius);
        const t = rayAABB(orb.x, orb.y, dx, dy, expanded);
        consider(t, 'wall', null);
      }
      for (const obsidian of this.obsidianWalls || []) {
        const t = rayAABB(orb.x, orb.y, dx, dy, expandRect(obsidian, orb.radius));
        consider(t, 'wall', null);
      }

      // 树：无论玩家法球还是敌方法球，都会被树干挡下
      for (const tree of this.trees) {
        if (!tree.blocksMovement()) continue;
        const expanded = expandRect(tree.getBody(), orb.radius);
        const t = rayAABB(orb.x, orb.y, dx, dy, expanded);
        consider(t, 'tree', tree);
      }

      // 毒囊阻挡所有法球，但不阻挡角色移动。
      for (const pod of this.pods) {
        if (pod.dead) continue;
        const expanded = expandRect(pod.getBody(), orb.radius);
        const t = rayAABB(orb.x, orb.y, dx, dy, expanded);
        consider(t, 'pod', pod);
      }

      // 仙人掌阻挡法球，但不阻挡移动。
      for (const cactus of this.cacti) {
        if (cactus.dead) continue;
        const expanded = expandRect(cactus.getBody(), orb.radius);
        const t = rayAABB(orb.x, orb.y, dx, dy, expanded);
        consider(t, 'cactus', cactus);
      }

      // 火堆只阻挡并承受玩家法球，不阻挡角色移动。
      if (orb.team === 'player') {
        for (const campfire of this.campfires) {
          if (campfire.dead) continue;
          const expanded = expandRect(campfire.getOrbBody(), orb.radius);
          const t = rayAABB(orb.x, orb.y, dx, dy, expanded);
          consider(t, 'campfire', campfire);
        }
      }

      // 玩家法球优先命中怪物；敌方法球只命中玩家
      if (orb.team === 'player') {
        for (const enemy of this.enemies) {
          if (enemy.dead || enemy.burrowed || enemy.bones) continue;
          if (orb.hitEnemies && orb.hitEnemies.includes(enemy)) continue;
          const rect = {
            x: enemy.x - enemy.radius,
            y: enemy.y - enemy.radius,
            w: enemy.radius * 2,
            h: enemy.radius * 2
          };
          const expanded = expandRect(rect, orb.radius);
          const t = rayAABB(orb.x, orb.y, dx, dy, expanded);
          consider(t, 'enemy', enemy);
        }
      } else if (orb.team === 'enemy' && this.state === 'playing') {
        const rect = {
          x: this.player.x - this.player.halfW,
          y: this.player.y - this.player.halfH,
          w: this.player.halfW * 2,
          h: this.player.halfH * 2
        };
        const expanded = expandRect(rect, orb.radius);
        const t = rayAABB(orb.x, orb.y, dx, dy, expanded);
        consider(t, 'player', this.player);
      }

      // Boss 房：玩家法球命中 Boss
      if (
        orb.team === 'player' &&
        this.scene === 'boss' &&
        this.boss &&
        this.boss.state === 'active' &&
        !this.boss.burrowed
      ) {
        const expanded = expandRect(this.boss.getOrbBody(), orb.radius);
        const t = rayAABB(orb.x, orb.y, dx, dy, expanded);
        consider(t, 'boss', this.boss);
      }

      return best;
    }

    // ------------------------------------------------------------
    // 渲染
    // ------------------------------------------------------------

    render() {
      if (window.currentGameState === GAME_STATES.INTRO) {
        this.renderIntro();
        return;
      }
      if (window.currentGameState === GAME_STATES.ENDING) {
        this.renderEnding();
        return;
      }
      const ctx = this.ctx;
      const w = CFG.WORLD.W;
      const h = CFG.WORLD.H;

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      const levelTheme = this.currentLevel ? this.currentLevel.theme : null;
      ctx.fillStyle = levelTheme ? levelTheme.outside : PALETTE.outside;
      ctx.fillRect(0, 0, w, h);

      // 世界抖动（UI / 准星不抖）
      ctx.save();
      if (this.shakeTime > 0 && this.state === 'playing') {
        const strength = this.shakeMagnitude * (this.shakeTime / Math.max(0.001, this.shakeDuration));
        const sx = Math.round((Math.random() * 2 - 1) * strength);
        const sy = Math.round((Math.random() * 2 - 1) * strength);
        ctx.translate(sx, sy);
      }

      this.drawFloor(ctx);
      this.drawWalls(ctx);
      this.drawQuicksand(ctx);
      this.drawCurseSand(ctx);
      this.drawPoisonPuddles(ctx);
      this.drawLavaPools(ctx);
      this.drawObsidianWalls(ctx);
      this.drawSpikeTraps(ctx);
      this.drawWhirlpools(ctx);
      this.drawWaterRipples(ctx);
      this.drawInkPools(ctx);
      this.drawFireSpiritBombs(ctx);
      this.drawPortals(ctx);
      this.drawCampfires(ctx);
      this.drawRollTraps(ctx);
      this.drawBossCheckpoint(ctx);
      this.drawEnemyWarnings(ctx);
      this.drawBossPlaceholder(ctx);
      this.drawFireflies(ctx);
      this.drawTreeShadows(ctx);
      this.drawSortedEntities(ctx);
      // Boss 预警与吐舌必须压在200×200贴图之上，避免被图片遮挡。
      this.drawBossTelegraphs(ctx);
      this.drawRollGhosts(ctx);
      this.drawOrbs(ctx);
      this.drawLavaBalls(ctx);
      this.drawEvilOrbs(ctx);
      this.drawExecutionerHooks(ctx);
      this.drawMeteors(ctx);
      this.drawCactusSpikes(ctx);
      this.drawDivineOrb(ctx);
      this.drawSilenceMark(ctx);
      this.drawParticles(ctx);
      this.drawGasExplosions(ctx);
      this.drawBlizzard(ctx);
      this.drawMeteorFlash(ctx);
      if (this.debug) this.drawDebugOverlay(ctx);
      ctx.restore();

      // 第六层黑暗视野：遮住外围，只保留玩家周围250px光圈。
      this.drawDarkness(ctx);
      this.drawInkOverlay(ctx);
      this.drawDeityOverlays(ctx);
      this.drawDivineWhisper(ctx);

      // 受伤红边
      if (this.player && this.player.hurtFlash > 0) {
        const alpha = (this.player.hurtFlash / 0.18) * 0.32;
        ctx.fillStyle = `rgba(170, 25, 20, ${alpha})`;
        ctx.fillRect(0, 0, w, CFG.WORLD.WALL);
        ctx.fillRect(0, h - CFG.WORLD.WALL, w, CFG.WORLD.WALL);
        ctx.fillRect(0, 0, CFG.WORLD.WALL, h);
        ctx.fillRect(w - CFG.WORLD.WALL, 0, CFG.WORLD.WALL, h);
      }

      this.drawCrosshair(ctx);
    }

    drawFloor(ctx) {
      const wall = CFG.WORLD.WALL;
      const innerW = CFG.WORLD.W - wall * 2;
      const innerH = CFG.WORLD.H - wall * 2;
      const tile = CFG.WORLD.TILE;
      const bossRoom = this.scene === 'boss';
      const treeBossRoom = bossRoom && this.currentLevelId === 1;
      const frogBossRoom = bossRoom && this.currentLevelId === 2;
      const desertBossRoom = bossRoom && this.currentLevelId === 3;
      const theme = (this.currentLevel && this.currentLevel.theme) ||
        PF.LEVELS.Level1.theme;
      const levelFloor = theme.floor;

      ctx.save();
      ctx.beginPath();
      ctx.rect(wall, wall, innerW, innerH);
      ctx.clip();

      // 普通房间跟随当前层主题；树妖房暗红，巨蛙房使用沼泽主题。
      const floorA = treeBossRoom ? PALETTE.bossFloorA : levelFloor.a;
      const floorB = treeBossRoom ? PALETTE.bossFloorB : levelFloor.b;
      const floorLine = treeBossRoom ? PALETTE.bossFloorLine : levelFloor.line;
      for (let ty = 0; ty * tile < innerH; ty += 1) {
        for (let tx = 0; tx * tile < innerW; tx += 1) {
          ctx.fillStyle = (tx + ty) % 2 === 0 ? floorA : floorB;
          ctx.fillRect(wall + tx * tile, wall + ty * tile, tile, tile);
        }
      }

      // 格子缝
      ctx.fillStyle = floorLine;
      for (let x = wall; x <= CFG.WORLD.W - wall; x += tile) {
        ctx.fillRect(x, wall, 1, innerH);
      }
      for (let y = wall; y <= CFG.WORLD.H - wall; y += tile) {
        ctx.fillRect(wall, y, innerW, 1);
      }

      // 地面小装饰
      for (const item of this.decor) {
        if (item.type === 'grass') {
          const color = treeBossRoom
            ? (item.variant === 1 ? '#5a4326' : '#4b3821')
            : levelFloor.grass[item.variant === 1 ? 1 : 0];
          ctx.fillStyle = color;
          ctx.fillRect(item.x, item.y, 1, 4);
          ctx.fillRect(item.x + 2, item.y + 1, 1, 3);
          ctx.fillRect(item.x - 2, item.y + 2, 1, 2);
          if (item.variant === 2) {
            ctx.fillStyle = treeBossRoom ? '#7a5a2e' : levelFloor.grass[2];
            ctx.fillRect(item.x + 1, item.y, 1, 2);
          }
        } else if (item.type === 'flower') {
          ctx.fillStyle = treeBossRoom ? '#9c5b3d' : levelFloor.flower;
          ctx.fillRect(item.x, item.y, 2, 2);
          ctx.fillStyle = treeBossRoom ? '#5d3022' : levelFloor.flowerCenter;
          ctx.fillRect(item.x - 1, item.y - 1, 1, 1);
          ctx.fillRect(item.x + 2, item.y + 1, 1, 1);
        } else if (item.type === 'stone') {
          ctx.fillStyle = treeBossRoom ? '#4c5a45' : levelFloor.stone;
          ctx.fillRect(item.x - 2, item.y, 5, 2);
          ctx.fillStyle = treeBossRoom ? '#647257' : levelFloor.stoneLight;
          ctx.fillRect(item.x - 1, item.y - 1, 3, 1);
        } else {
          ctx.fillStyle = treeBossRoom ? '#7b3b25' : levelFloor.leaf;
          ctx.fillRect(item.x, item.y, 3, 1);
          ctx.fillRect(item.x + 1, item.y + 1, 2, 1);
        }
      }

      if (treeBossRoom) {
        // 树妖 Boss 房：地面裂纹、树根和暗红氛围
        ctx.fillStyle = 'rgba(74, 15, 10, .20)';
        ctx.fillRect(wall, wall, innerW, innerH);
        ctx.fillStyle = PALETTE.bossFloorRoot;
        const rootPaths = [
          [wall + 4, 470, 210, 4], [wall + 4, 474, 150, 3],
          [CFG.WORLD.W - wall - 214, 140, 210, 4], [CFG.WORLD.W - wall - 154, 144, 150, 3],
          [180, wall + 4, 4, 170], [184, wall + 4, 3, 110],
          [700, CFG.WORLD.H - wall - 170, 4, 166], [704, CFG.WORLD.H - wall - 110, 3, 106]
        ];
        for (const [rx, ry, rw, rh] of rootPaths) {
          ctx.fillRect(rx, ry, rw, rh);
        }

        // 中央危险法阵的像素刻度
        const cx = CFG.WORLD.W / 2;
        const cy = CFG.WORLD.H / 2;
        for (let i = 0; i < 24; i += 1) {
          if (i % 3 === 0) continue;
          const angle = (i / 24) * Math.PI * 2;
          const px = Math.round(cx + Math.cos(angle) * 208);
          const py = Math.round(cy + Math.sin(angle) * 148);
          ctx.fillStyle = i % 2 === 0 ? 'rgba(190, 78, 45, .28)' : 'rgba(111, 49, 31, .24)';
          ctx.fillRect(px - 2, py - 2, 4, 4);
        }
      } else if (desertBossRoom) {
        // 沙虫 Boss 房：沙丘裂口与干枯石纹
        ctx.fillStyle = 'rgba(255, 210, 130, .10)';
        ctx.fillRect(wall, wall, innerW, innerH);
        ctx.fillStyle = 'rgba(104, 68, 31, .20)';
        for (let i = 0; i < 11; i += 1) {
          const px = 150 + (i * 149) % 940;
          const py = 140 + (i * 173) % 520;
          ctx.beginPath();
          ctx.ellipse(px, py, 58, 18, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(126, 88, 42, .28)';
        ctx.lineWidth = 3;
        for (let i = 0; i < 5; i += 1) {
          const px = 190 + i * 210;
          const py = 220 + (i % 2) * 260;
          ctx.beginPath();
          ctx.moveTo(px - 70, py + 16);
          ctx.lineTo(px, py - 8);
          ctx.lineTo(px + 76, py + 12);
          ctx.stroke();
        }
      } else if (frogBossRoom) {
        // 巨蛙 Boss 房：毒沼绿、淤泥和紫绿色蛙鸣法阵
        ctx.fillStyle = 'rgba(31, 71, 42, .18)';
        ctx.fillRect(wall, wall, innerW, innerH);
        ctx.fillStyle = 'rgba(65, 44, 83, .18)';
        for (let i = 0; i < 9; i += 1) {
          const px = 200 + (i * 137) % 880;
          const py = 170 + (i * 173) % 470;
          ctx.beginPath();
          ctx.ellipse(px, py, 54, 20, 0, 0, Math.PI * 2);
          ctx.fill();
        }

      } else {
        // 普通房间中央出生地痕迹
        ctx.fillStyle = levelFloor.spawnMark;
        const cx = CFG.PLAYER.SPAWN_X;
        const cy = CFG.PLAYER.SPAWN_Y;
        ctx.fillRect(cx - 58, cy + 20, 116, 10);
        ctx.fillRect(cx - 42, cy + 30, 84, 5);
        ctx.fillRect(cx - 30, cy - 28, 60, 4);
      }

      ctx.restore();
    }

    drawWalls(ctx) {
      const w = CFG.WORLD.W;
      const h = CFG.WORLD.H;
      const wall = CFG.WORLD.WALL;
      const theme = (this.currentLevel && this.currentLevel.theme) ||
        PF.LEVELS.Level1.theme;
      const levelWall = theme.wall;

      // 基础墙体
      ctx.fillStyle = levelWall.dark;
      ctx.fillRect(0, 0, w, wall);
      ctx.fillRect(0, h - wall, w, wall);
      ctx.fillRect(0, 0, wall, h);
      ctx.fillRect(w - wall, 0, wall, h);

      // 上墙：横向石块
      for (let x = 0; x < w; x += 32) {
        ctx.fillStyle = (x / 32) % 2 === 0 ? levelWall.topA : levelWall.topB;
        ctx.fillRect(x, 0, 32, wall);
        ctx.fillStyle = levelWall.topLight;
        ctx.fillRect(x + 2, 2, 28, 2);
        ctx.fillStyle = levelWall.seam;
        ctx.fillRect(x + 30, 0, 2, wall);
        if ((x / 32) % 3 === 1) {
          ctx.fillStyle = levelWall.moss;
          ctx.fillRect(x + 6, 7, 7, 3);
          ctx.fillRect(x + 10, 10, 4, 4);
        }
      }

      // 下墙
      for (let x = 0; x < w; x += 32) {
        ctx.fillStyle = (x / 32) % 2 === 0 ? levelWall.bottomA : levelWall.bottomB;
        ctx.fillRect(x, h - wall, 32, wall);
        ctx.fillStyle = levelWall.bottomLight;
        ctx.fillRect(x + 2, h - wall + 2, 28, 2);
        ctx.fillStyle = levelWall.seam;
        ctx.fillRect(x + 30, h - wall, 2, wall);
        if ((x / 32) % 4 === 0) {
          ctx.fillStyle = levelWall.moss;
          ctx.fillRect(x + 12, h - 8, 8, 3);
        }
      }

      // 左右墙
      for (let y = 0; y < h; y += 32) {
        const odd = (y / 32) % 2 === 0;
        ctx.fillStyle = odd ? levelWall.leftA : levelWall.leftB;
        ctx.fillRect(0, y, wall, 32);
        ctx.fillRect(w - wall, y, wall, 32);
        ctx.fillStyle = levelWall.leftLight;
        ctx.fillRect(2, y + 2, 2, 28);
        ctx.fillRect(w - 4, y + 2, 2, 28);
        ctx.fillStyle = levelWall.seam;
        ctx.fillRect(0, y + 30, wall, 2);
        ctx.fillRect(w - wall, y + 30, wall, 2);
        if ((y / 32) % 3 === 0) {
          ctx.fillStyle = levelWall.moss;
          ctx.fillRect(5, y + 7, 5, 7);
          ctx.fillRect(w - 9, y + 9, 4, 6);
        }
      }

      // 内圈阴影 + 亮边，让 16px 墙更清楚
      ctx.fillStyle = levelWall.innerShadow;
      ctx.fillRect(wall, wall, w - wall * 2, 3);
      ctx.fillRect(wall, wall, 3, h - wall * 2);
      ctx.fillStyle = levelWall.innerEdge;
      ctx.fillRect(wall, wall + 3, w - wall * 2, 1);
      ctx.fillRect(wall + 3, wall, 1, h - wall * 2);
    }

    drawQuicksand(ctx) {
      if (this.currentLevelId !== 3 || !this.quicksandZones) return;
      const time = this.time;

      for (const zone of this.quicksandZones) {
        const x = Math.round(zone.x);
        const y = Math.round(zone.y);
        const r = zone.radius;

        ctx.save();
        ctx.fillStyle = 'rgba(59, 35, 19, .78)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(78, 47, 26, .82)';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.84, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(119, 77, 39, .62)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, r - 2, 0, Math.PI * 2);
        ctx.stroke();

        // 缓慢旋转的沙纹
        for (let i = 0; i < 4; i += 1) {
          const start = time * 0.35 + zone.phase + i * Math.PI / 2;
          const radius = r * (0.30 + i * 0.16);
          ctx.strokeStyle = i % 2 === 0
            ? 'rgba(146, 96, 48, .55)'
            : 'rgba(183, 128, 66, .30)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, radius, start, start + 1.35);
          ctx.stroke();
        }

        ctx.fillStyle = 'rgba(26, 15, 9, .55)';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.16, 0, Math.PI * 2);
        ctx.fill();

        for (let i = 0; i < 10; i += 1) {
          const a = time * 0.18 + zone.phase + i * 0.63;
          const rr = r * (0.24 + ((i * 37) % 60) / 100);
          ctx.fillStyle = i % 2 === 0 ? '#9b6835' : '#c29352';
          ctx.fillRect(
            Math.round(x + Math.cos(a) * rr),
            Math.round(y + Math.sin(a) * rr),
            2,
            2
          );
        }
        ctx.restore();
      }
    }

    drawCurseSand(ctx) {
      if (this.currentLevelId !== 3 || !this.curseSandZones) return;
      for (const zone of this.curseSandZones) {
        const x = Math.round(zone.x);
        const y = Math.round(zone.y);
        const fade = Math.min(1, (zone.duration - zone.age) / 0.5 + 0.25);
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.fillStyle = 'rgba(73, 70, 46, .55)';
        ctx.beginPath();
        ctx.arc(x, y, zone.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(111, 101, 67, .45)';
        ctx.beginPath();
        ctx.arc(x, y, zone.radius * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(139, 129, 87, .45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, zone.radius - 2, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 9; i += 1) {
          const angle = zone.phase + this.time * 0.5 + i * 0.7;
          const r = zone.radius * (0.2 + ((i * 29) % 55) / 100);
          ctx.fillStyle = i % 2 === 0 ? '#9a8f60' : '#687f54';
          ctx.fillRect(
            Math.round(x + Math.cos(angle) * r),
            Math.round(y + Math.sin(angle) * r),
            2, 2
          );
        }
        ctx.restore();
      }
    }

    drawLavaPools(ctx) {
      if (!this.lavaPools || this.lavaPools.length === 0) return;
      for (const pool of this.lavaPools) {
        const x = Math.round(pool.x);
        const y = Math.round(pool.y);
        const r = pool.radius;
        const t = this.time;
        this.drawPixelEllipse(
          ctx, x, y, r, r * 0.62,
          '#5c130b', '#160404', 4
        );
        this.drawPixelEllipse(
          ctx, x, y, Math.max(4, r - 10), Math.max(4, r * 0.62 - 7),
          '#b72a10', '#5c130b', 3
        );
        this.drawPixelEllipse(
          ctx, x, y - 2, Math.max(3, r - 22), Math.max(3, r * 0.45 - 6),
          '#ff6a28', '#b72a10', 2
        );
        ctx.fillStyle = 'rgba(255, 205, 92, .85)';
        for (let i = 0; i < 5; i += 1) {
          const bx = x + Math.sin(t * 1.4 + i * 2.1 + pool.phase) * (r * 0.55);
          const by = y - 3 + Math.cos(t * 1.1 + i * 1.7 + pool.phase) * (r * 0.25);
          ctx.fillRect(Math.round(bx), Math.round(by), 3, 3);
        }
        ctx.fillStyle = 'rgba(255, 80, 30, .16)';
        ctx.fillRect(x - r, y - r * 0.6, r * 2, 4);
      }
    }

    drawObsidianWalls(ctx) {
      if (!this.obsidianWalls || this.obsidianWalls.length === 0) return;
      for (const wall of this.obsidianWalls) {
        const x = Math.round(wall.x);
        const y = Math.round(wall.y);
        ctx.fillStyle = '#0a060d';
        ctx.fillRect(x - 3, y - 3, wall.w + 6, wall.h + 6);
        ctx.fillStyle = '#1c1024';
        ctx.fillRect(x, y, wall.w, wall.h);

        for (let by = 0; by < wall.h; by += 20) {
          for (let bx = 0; bx < wall.w; bx += 20) {
            const shade = ((bx / 20 + by / 20) % 2 === 0)
              ? '#241332'
              : '#170c20';
            ctx.fillStyle = shade;
            ctx.fillRect(x + bx + 2, y + by + 2, 16, 16);
          }
        }
        ctx.strokeStyle = 'rgba(255, 55, 35, .45)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 0.5, y + 0.5, wall.w - 1, wall.h - 1);
        ctx.fillStyle = 'rgba(255, 70, 40, .35)';
        ctx.fillRect(x, y, wall.w, 3);
        ctx.fillRect(x, y + wall.h - 3, wall.w, 3);
        ctx.fillStyle = 'rgba(255, 128, 64, .20)';
        ctx.fillRect(x, y, 3, wall.h);
        ctx.fillRect(x + wall.w - 3, y, 3, wall.h);
      }
    }

    drawFireSpiritBombs(ctx) {
      for (const bomb of this.fireSpiritBombs) {
        const pulse = 1 + Math.sin(this.time * 18 + bomb.phase) * 0.08;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bomb.x, bomb.y, bomb.radius * pulse, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 45, 20, .16)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 92, 42, .95)';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(bomb.x, bomb.y, bomb.radius * 0.55, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 211, 102, .65)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    drawSpikeTraps(ctx) {
      for (const trap of this.spikeTraps || []) {
        ctx.fillStyle = '#17171c';
        ctx.fillRect(trap.x - 4, trap.y - 4, trap.w + 8, trap.h + 8);
        ctx.fillStyle = '#3a3942';
        ctx.fillRect(trap.x, trap.y, trap.w, trap.h);
        ctx.strokeStyle = 'rgba(166, 160, 176, .55)';
        ctx.lineWidth = 2;
        ctx.strokeRect(trap.x + 1, trap.y + 1, trap.w - 2, trap.h - 2);
        const cols = Math.max(2, Math.floor(trap.w / 22));
        const rows = Math.max(2, Math.floor(trap.h / 22));
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            const sx = trap.x + (col + 0.5) * (trap.w / cols);
            const sy = trap.y + (row + 0.5) * (trap.h / rows);
            const h = 10 + ((row + col) % 3) * 2;
            ctx.fillStyle = '#8d8994';
            ctx.beginPath();
            ctx.moveTo(sx, sy - h / 2);
            ctx.lineTo(sx - 6, sy + h / 2);
            ctx.lineTo(sx + 6, sy + h / 2);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#d0ccd6';
            ctx.fillRect(sx - 1, sy - 2, 2, 5);
          }
        }
      }
    }

    drawDarkness(ctx) {
      if (this.currentLevelId !== 6 || !this.player || this.state !== 'playing') {
        return;
      }
      const cfg = this.currentLevel && this.currentLevel.mechanics &&
        this.currentLevel.mechanics.darkness;
      if (!cfg) return;
      const px = this.player.x;
      const py = this.player.y;
      const radius = cfg.radius || 250;
      const gradient = ctx.createRadialGradient(
        px, py, cfg.innerRadius || 90,
        px, py, radius
      );
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(0.58, 'rgba(0, 0, 0, .18)');
      gradient.addColorStop(0.82, 'rgba(0, 0, 0, .55)');
      gradient.addColorStop(1, `rgba(0, 0, 0, ${cfg.alpha || 0.82})`);
      ctx.save();
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CFG.WORLD.W, CFG.WORLD.H);
      ctx.restore();
    }

    drawPoisonPuddles(ctx) {
      const room = this.getCurrentRoom();
      if (!room || !room.poisonPuddles || room.poisonPuddles.length === 0) return;

      const t = this.time;
      for (const puddle of room.poisonPuddles) {
        const points = [];
        for (let i = 0; i < 28; i += 1) {
          const angle = (i / 28) * Math.PI * 2;
          const wobble = 1 +
            Math.sin(angle * 3 + t * 0.75 + puddle.phase) * 0.055 +
            Math.sin(angle * 5 - t * 0.55 + puddle.phase * 1.7) * 0.025;
          points.push({
            x: puddle.x + Math.cos(angle) * puddle.r * wobble,
            y: puddle.y + Math.sin(angle) * puddle.r * wobble
          });
        }

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i += 1) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();

        const grad = ctx.createRadialGradient(
          puddle.x, puddle.y, puddle.r * 0.08,
          puddle.x, puddle.y, puddle.r
        );
        grad.addColorStop(0, 'rgba(132, 226, 115, .20)');
        grad.addColorStop(0.58, 'rgba(94, 115, 70, .28)');
        grad.addColorStop(0.84, 'rgba(111, 60, 160, .30)');
        grad.addColorStop(1, 'rgba(60, 30, 86, .16)');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = 'rgba(145, 244, 117, .32)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(178, 100, 255, .25)';
        ctx.lineWidth = 4;
        ctx.stroke();

        // 波纹和毒泡
        for (let i = 0; i < 3; i += 1) {
          const ripple = ((t * 0.32 + puddle.phase + i * 0.31) % 1);
          ctx.globalAlpha = (1 - ripple) * 0.38;
          ctx.strokeStyle = i % 2 === 0
            ? 'rgba(190, 255, 158, .75)'
            : 'rgba(190, 120, 255, .65)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.ellipse(
            puddle.x,
            puddle.y,
            puddle.r * (0.25 + ripple * 0.65),
            puddle.r * (0.14 + ripple * 0.42),
            puddle.phase + i,
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }

        for (let i = 0; i < 7; i += 1) {
          const angle = puddle.phase + i * 1.7 + t * 0.16;
          const dist = puddle.r * (0.18 + (i % 5) * 0.14);
          const bx = puddle.x + Math.cos(angle) * dist;
          const by = puddle.y + Math.sin(angle) * dist * 0.62;
          ctx.globalAlpha = 0.35 + (i % 3) * 0.16;
          ctx.fillStyle = i % 2 === 0 ? '#b6ff9b' : '#b07bff';
          ctx.fillRect(Math.round(bx), Math.round(by), i % 3 === 0 ? 3 : 2, 2);
        }
        ctx.restore();
      }
    }

    drawGasPod(ctx, pod) {
      const x = Math.round(pod.x);
      const y = Math.round(pod.y);
      const pulse = 1 + Math.sin(this.time * 2.6 + pod.phase) * 0.05;
      const flash = pod.hitFlash > 0;
      const dark = flash ? '#fff8df' : '#2b163c';
      const shell = flash ? '#ffffff' : '#6b3e8d';
      const flesh = flash ? '#f4ffe7' : '#78b866';
      const glow = flash ? '#ffffff' : '#b488ff';

      // 影子
      ctx.fillStyle = 'rgba(3, 8, 4, .34)';
      ctx.fillRect(x - 23, y + 13, 46, 7);
      ctx.fillRect(x - 14, y + 20, 28, 3);

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pulse, 2 - pulse);

      // 根须
      ctx.fillStyle = dark;
      ctx.fillRect(-11, 9, 4, 10);
      ctx.fillRect(7, 9, 4, 10);
      ctx.fillRect(-18, 15, 9, 3);
      ctx.fillRect(9, 15, 9, 3);

      // 毒囊主体：2px像素横条堆出的椭圆。
      this.drawPixelEllipse(ctx, 0, -4, 19, 23, dark, '#1a0e24', 3);
      this.drawPixelEllipse(ctx, 0, -4, 15, 19, shell, shell, 2);
      this.drawPixelEllipse(ctx, -3, -7, 9, 13, flesh, flesh, 2);
      ctx.fillStyle = glow;
      ctx.fillRect(-10, -14, 5, 8);
      ctx.fillRect(-6, -17, 4, 4);

      // 气泡和裂口
      ctx.fillStyle = flash ? '#ffffff' : '#3b1f54';
      ctx.fillRect(9, -1, 5, 5);
      ctx.fillRect(5, 6, 3, 3);
      ctx.fillRect(-13, 5, 3, 3);
      ctx.fillStyle = flash ? '#ffffff' : '#a7ff9b';
      ctx.fillRect(7, -11, 3, 3);

      // 顶部气孔
      ctx.fillStyle = dark;
      ctx.fillRect(-4, -29, 8, 8);
      ctx.fillStyle = flash ? '#ffffff' : '#52c96d';
      ctx.fillRect(-2, -27, 4, 4);

      // 受损后显示 3 格血条
      if (pod.hp < pod.maxHp || pod.hitFlash > 0) {
        const pipW = 8;
        const totalW = pod.maxHp * pipW + (pod.maxHp - 1) * 2;
        const startX = -Math.round(totalW / 2);
        for (let i = 0; i < pod.maxHp; i += 1) {
          ctx.fillStyle = i < pod.hp ? '#b8f06c' : '#39284a';
          ctx.fillRect(startX + i * (pipW + 2), -43, pipW, 3);
        }
      }

      ctx.restore();
    }

    drawCactus(ctx, cactus) {
      const x = Math.round(cactus.x);
      const y = Math.round(cactus.y);
      const flash = cactus.hitFlash > 0;

      if (cactus.dead) {
        // 被摧毁后只留无害沙土与断茎
        ctx.fillStyle = 'rgba(78, 49, 25, .42)';
        ctx.beginPath();
        ctx.ellipse(x, y + 13, 26, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a7793e';
        ctx.fillRect(x - 17, y + 9, 34, 5);
        ctx.fillStyle = '#80602f';
        ctx.fillRect(x - 7, y + 3, 14, 7);
        ctx.fillStyle = '#5e8a3a';
        ctx.fillRect(x - 4, y - 2, 8, 6);
        return;
      }

      ctx.fillStyle = 'rgba(49, 36, 18, .28)';
      ctx.fillRect(x - 22, y + 18, 44, 6);
      ctx.fillRect(x - 14, y + 24, 28, 3);

      ctx.save();
      ctx.translate(x, y);
      const outline = '#29451f';
      const dark = flash ? '#f2f2f2' : '#3f6a2c';
      const body = flash ? '#ffffff' : '#5f8f3c';
      const light = flash ? '#ffffff' : '#8fbd58';

      // 主干
      ctx.fillStyle = outline;
      ctx.fillRect(-10, -32, 20, 54);
      ctx.fillStyle = dark;
      ctx.fillRect(-7, -30, 14, 50);
      ctx.fillStyle = body;
      ctx.fillRect(-5, -28, 10, 46);
      ctx.fillStyle = light;
      ctx.fillRect(-3, -27, 3, 38);

      // 左右手臂
      ctx.fillStyle = outline;
      ctx.fillRect(-25, -15, 15, 9);
      ctx.fillRect(-25, -28, 9, 16);
      ctx.fillRect(10, -7, 15, 9);
      ctx.fillRect(16, -21, 9, 17);
      ctx.fillStyle = body;
      ctx.fillRect(-21, -22, 6, 9);
      ctx.fillRect(-21, -12, 10, 5);
      ctx.fillRect(13, -15, 6, 10);
      ctx.fillRect(13, -5, 10, 5);
      ctx.fillStyle = light;
      ctx.fillRect(-21, -21, 2, 6);
      ctx.fillRect(13, -14, 2, 7);

      // 尖刺
      ctx.fillStyle = '#e6d68f';
      ctx.fillRect(-12, -26, 3, 5);
      ctx.fillRect(9, -18, 3, 5);
      ctx.fillRect(-12, -5, 3, 5);
      ctx.fillRect(9, 6, 3, 5);
      ctx.fillRect(-20, -24, 3, 5);
      ctx.fillRect(17, -18, 3, 5);
      ctx.fillRect(-4, -38, 3, 6);
      ctx.fillRect(3, -39, 3, 6);

      // 顶部小花
      ctx.fillStyle = '#e8be57';
      ctx.fillRect(-3, -42, 6, 4);
      ctx.fillStyle = '#f7e3a0';
      ctx.fillRect(-1, -44, 2, 2);

      // 5 格血条
      if (cactus.hp < cactus.maxHp || cactus.hitFlash > 0) {
        const pipW = 7;
        const totalW = cactus.maxHp * pipW + (cactus.maxHp - 1) * 2;
        const startX = -Math.round(totalW / 2);
        for (let i = 0; i < cactus.maxHp; i += 1) {
          ctx.fillStyle = i < cactus.hp ? '#d9e88b' : '#40351d';
          ctx.fillRect(startX + i * (pipW + 2), -52, pipW, 3);
        }
      }

      ctx.restore();
    }

    drawGasExplosions(ctx) {
      for (const explosion of this.gasExplosions) {
        const t = clamp(explosion.age / explosion.duration, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const radius = explosion.radius * (0.25 + eased * 0.75);
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.72;
        ctx.strokeStyle = '#b66cff';
        ctx.lineWidth = 7 * (1 - t) + 1;
        ctx.beginPath();
        ctx.arc(explosion.x, explosion.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#8dff91';
        ctx.lineWidth = 3 * (1 - t) + 1;
        ctx.beginPath();
        ctx.arc(explosion.x, explosion.y, radius * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = (1 - t) * 0.16;
        ctx.fillStyle = '#9b5cff';
        ctx.beginPath();
        ctx.arc(explosion.x, explosion.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    /** 当前普通房间的上/下门；Boss 房沿用原有单向门。 */
    drawBlizzard(ctx) {
      if (!this.blizzardActive) return;
      const w = CFG.WORLD.W;
      const h = CFG.WORLD.H;
      ctx.save();
      ctx.fillStyle = 'rgba(12, 30, 46, .30)';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 74; i += 1) {
        const x = (i * 97 + this.time * (105 + (i % 5) * 13)) % w;
        const y = (i * 61 + this.time * (170 + (i % 7) * 17)) % h;
        ctx.fillStyle = i % 3 === 0
          ? 'rgba(232, 249, 255, .82)'
          : 'rgba(163, 214, 238, .58)';
        const length = i % 4 === 0 ? 5 : 3;
        ctx.fillRect(Math.round(x), Math.round(y), 2, length);
      }
      ctx.fillStyle = 'rgba(205, 238, 252, .05)';
      for (let x = 0; x < w; x += 96) {
        ctx.fillRect(x + ((this.time * 40) % 96), 0, 28, h);
      }
      ctx.restore();
    }

    drawCampfires(ctx) {
      if (!this.campfires || this.campfires.length === 0) return;

      for (const fire of this.campfires) {
        if (fire.dead) {
          if (!fire.destroyedByBoss || fire.respawnTimer <= 0) continue;
          const ex = Math.round(fire.x);
          const ey = Math.round(fire.y);
          const ember = 0.45 + Math.sin(this.time * 8 + fire.phase) * 0.22;
          ctx.save();
          ctx.translate(ex, ey);
          ctx.fillStyle = 'rgba(22, 39, 50, .28)';
          ctx.beginPath();
          ctx.ellipse(0, 8, 26, 9, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#3b4147';
          ctx.fillRect(-20, 3, 40, 5);
          ctx.fillRect(-13, -2, 26, 4);
          ctx.globalAlpha = ember;
          ctx.fillStyle = '#d96a39';
          ctx.fillRect(-11, 1, 4, 3);
          ctx.fillRect(4, 2, 3, 3);
          ctx.fillStyle = '#ffcb63';
          ctx.fillRect(-2, -1, 2, 2);
          ctx.fillRect(11, 0, 2, 2);
          ctx.globalAlpha = 1;
          ctx.restore();
          continue;
        }
        const x = Math.round(fire.x);
        const y = Math.round(fire.y);
        const pulse = 1 + Math.sin(this.time * 7 + fire.phase) * 0.13;
        const flash = fire.hitFlash > 0;

        ctx.save();
        ctx.translate(x, y);

        // 石圈与柴堆
        ctx.fillStyle = 'rgba(23, 43, 54, .30)';
        ctx.beginPath();
        ctx.ellipse(0, 8, 28, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#50636e';
        ctx.fillRect(-24, 2, 10, 6);
        ctx.fillRect(14, 2, 10, 6);
        ctx.fillRect(-16, 7, 32, 5);
        ctx.fillStyle = '#708690';
        ctx.fillRect(-20, 1, 8, 4);
        ctx.fillRect(12, 1, 8, 4);

        ctx.fillStyle = '#5a3724';
        ctx.fillRect(-16, 3, 32, 3);
        ctx.fillRect(-12, 6, 24, 3);
        ctx.fillRect(-9, 1, 18, 3);
        ctx.fillStyle = '#8d5631';
        ctx.fillRect(-4, 2, 12, 3);

        // 像素火焰
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = flash ? '#ffffff' : '#e88538';
        ctx.fillRect(-8, Math.round(-12 * pulse), 16, 15);
        ctx.fillStyle = flash ? '#ffffff' : '#ffc84d';
        ctx.fillRect(-5, Math.round(-20 * pulse), 10, 17);
        ctx.fillStyle = flash ? '#ffffff' : '#fff1a8';
        ctx.fillRect(-2, Math.round(-27 * pulse), 4, 13);
        ctx.fillStyle = '#fff4b8';
        ctx.fillRect(1, Math.round(-22 * pulse), 2, 8);

        // 火星
        ctx.globalAlpha = 0.65;
        ctx.fillStyle = '#ffd36a';
        ctx.fillRect(Math.round(Math.sin(this.time * 3 + fire.phase) * 9), -30, 2, 2);
        ctx.fillRect(9, Math.round(-24 + Math.cos(this.time * 4) * 4), 2, 2);
        ctx.globalAlpha = 1;

        ctx.restore();
      }
    }

    drawBossCheckpoint(ctx) {
      if (this.scene !== 'boss') return;
      const point = CFG.BOSS_CHECKPOINT;
      const active = Boolean(
        this.bossCheckpoint &&
        this.bossCheckpoint.levelId === this.currentLevelId
      );
      const pulse = 0.55 + Math.sin(this.time * 3.2) * 0.18;
      const x = Math.round(point.X);
      const y = Math.round(point.Y);

      ctx.save();
      ctx.translate(x, y);

      ctx.fillStyle = 'rgba(22, 26, 29, .55)';
      ctx.beginPath();
      ctx.ellipse(0, 2, 24, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      // 像素符文光点
      if (active) {
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#a8d8d0';
        ctx.fillRect(-26, -25, 4, 4);
        ctx.fillRect(22, -20, 4, 4);
        ctx.fillRect(-20, -49, 3, 3);
        ctx.fillRect(18, -45, 3, 3);
        ctx.globalAlpha = 1;
      }

      // 石柱基座
      ctx.fillStyle = '#20242a';
      ctx.fillRect(-14, -2, 28, 6);
      ctx.fillStyle = '#4a5058';
      ctx.fillRect(-12, -5, 24, 4);
      ctx.fillStyle = '#2e333a';
      ctx.fillRect(-9, -42, 18, 38);
      ctx.fillStyle = '#555c63';
      ctx.fillRect(-6, -40, 12, 32);
      ctx.fillStyle = '#1b1f24';
      ctx.fillRect(-12, -47, 24, 6);
      ctx.fillStyle = '#5e656b';
      ctx.fillRect(-9, -46, 18, 3);

      // 中央存档符文
      ctx.fillStyle = active ? '#b9e4dc' : '#555b61';
      ctx.fillRect(-3, -31, 6, 6);
      ctx.fillRect(-1, -33, 2, 10);
      ctx.fillRect(-5, -29, 10, 2);
      ctx.fillStyle = active ? '#6f9f98' : '#3c4045';
      ctx.fillRect(-1, -39, 2, 2);
      ctx.fillRect(-1, -20, 2, 2);

      // 顶部悬浮像素
      if (active) {
        ctx.globalAlpha = 0.65 + Math.sin(this.time * 4.2) * 0.25;
        ctx.fillStyle = '#cceee8';
        ctx.fillRect(-1, -57 - (this.time * 7 % 8), 2, 2);
        ctx.fillRect(5, -52 - (this.time * 5 % 7), 2, 2);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    drawPortals(ctx) {
      if (
        this.levelExitPortal &&
        this.levelExitPortal.sourceLevelId === this.currentLevelId
      ) {
        this.drawTeleportArray(
          ctx,
          this.levelExitPortal,
          '#9cf5c3',
          'rgba(90, 255, 180, .18)',
          this.levelExitPortal.label
        );
        return;
      }

      if (this.scene === 'forest') {
        const room = this.getCurrentRoom();
        if (!room) return;

        const locked = !room.unlocked;
        for (const door of room.doors) {
          const isTop = door.side === 'top';
          const label = locked
            ? (isTop ? '下一间 · 锁定' : '返回 · 锁定')
            : (isTop ? '下一间' : '返回');
          const color = locked
            ? '#8a5a63'
            : (isTop ? PALETTE.portalPurple : PALETTE.portalGreen);

          this.drawPortal(
            ctx,
            door.rect,
            color,
            label,
            locked,
            room.openProgress,
            isTop
          );
        }
      } else {
        const unlocked = this.bossRoomExitUnlocked;
        this.drawPortal(
          ctx,
          CFG.PORTAL.BOSS,
          unlocked ? PALETTE.portalGreen : '#8a5a63',
          unlocked ? '返回' : '封锁中',
          !unlocked,
          unlocked ? 1 : 0
        );
      }
    }

    drawBossPlaceholder(ctx) {
      if (this.currentLevelId !== 2 && this.currentLevelId !== 3) return;
      const room = this.getCurrentRoom();
      if (!room || room.kind !== 'bossPlaceholder') return;

      const desert = this.currentLevelId === 3;
      const cx = CFG.WORLD.W / 2;
      const cy = CFG.WORLD.H / 2;
      const t = this.time;

      ctx.save();
      ctx.fillStyle = desert ? 'rgba(52, 33, 14, .42)' : 'rgba(8, 12, 8, .42)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 18, 132, 64, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = desert
        ? 'rgba(214, 170, 88, .42)'
        : 'rgba(151, 100, 195, .42)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 10, 104, 48, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = desert
        ? 'rgba(147, 104, 52, .38)'
        : 'rgba(110, 180, 92, .32)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 10, 82, 36, 0, 0, Math.PI * 2);
      ctx.stroke();

      for (let i = 0; i < 12; i += 1) {
        const angle = (i / 12) * Math.PI * 2 + t * 0.08;
        const px = Math.round(cx + Math.cos(angle) * 93);
        const py = Math.round(cy + 10 + Math.sin(angle) * 42);
        ctx.fillStyle = desert
          ? (i % 2 === 0 ? '#d5a95e' : '#8e6a36')
          : (i % 2 === 0 ? '#698f5d' : '#8a5da8');
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }

      // 中央石台
      if (desert) {
        ctx.fillStyle = '#3e2b16';
        ctx.fillRect(cx - 38, cy - 42, 76, 64);
        ctx.fillStyle = '#8a6838';
        ctx.fillRect(cx - 33, cy - 38, 66, 54);
        ctx.fillStyle = '#b48a4c';
        ctx.fillRect(cx - 27, cy - 33, 54, 6);
        ctx.fillStyle = '#241609';
        ctx.fillRect(cx - 25, cy - 22, 50, 30);
        ctx.fillStyle = '#d2a75d';
        ctx.fillRect(cx - 5, cy - 17, 10, 20);
        ctx.fillStyle = '#ffe3a1';
        ctx.fillRect(cx - 3, cy - 14, 6, 13);
      } else {
        ctx.fillStyle = '#202b29';
        ctx.fillRect(cx - 38, cy - 42, 76, 64);
        ctx.fillStyle = '#3e5148';
        ctx.fillRect(cx - 33, cy - 38, 66, 54);
        ctx.fillStyle = '#556f5d';
        ctx.fillRect(cx - 27, cy - 33, 54, 6);
        ctx.fillStyle = '#14221c';
        ctx.fillRect(cx - 25, cy - 22, 50, 30);
        ctx.fillStyle = '#9c6bcd';
        ctx.fillRect(cx - 5, cy - 17, 10, 20);
        ctx.fillStyle = '#b9f28d';
        ctx.fillRect(cx - 3, cy - 14, 6, 13);
      }

      ctx.font = '12px "Microsoft YaHei", "Consolas", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = desert ? 'rgba(41, 26, 10, .90)' : 'rgba(7, 13, 8, .88)';
      ctx.fillRect(cx - 90, cy + 52, 180, 34);
      ctx.fillStyle = desert ? '#f1dba8' : '#d9c7a4';
      ctx.fillText(desert ? '荒漠 BOSS 房' : '沼泽 BOSS 房', cx, cy + 56);
      ctx.fillStyle = desert ? '#c69b5e' : '#9cbc79';
      ctx.fillText('占位中 · 暂未开放', cx, cy + 71);
      ctx.restore();
    }

    /** 中央传送阵：像素法阵 + 旋转符文 + 地面光柱。 */
    drawTeleportArray(ctx, portal, color, glow, label) {
      const x = Math.round(portal.x);
      const y = Math.round(portal.y);
      const r = portal.r;
      const t = this.time;

      ctx.save();

      // 地面光晕
      const grad = ctx.createRadialGradient(x, y, 4, x, y, r);
      grad.addColorStop(0, glow);
      grad.addColorStop(0.65, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);

      // 光柱
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = color;
      ctx.fillRect(x - 9, y - r - 28, 18, r + 20);
      ctx.globalAlpha = 0.16;
      ctx.fillRect(x - 2, y - r - 40, 4, r + 30);
      ctx.globalAlpha = 1;

      // 双环
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(x, y, r - 4, t * 0.55, t * 0.55 + Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.38;
      ctx.beginPath();
      ctx.arc(x, y, r - 19, -t * 0.4, -t * 0.4 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 环上符文
      const runeCount = 16;
      for (let i = 0; i < runeCount; i += 1) {
        const angle = (i / runeCount) * Math.PI * 2 + t * 0.18;
        const px = Math.round(x + Math.cos(angle) * (r - 11));
        const py = Math.round(y + Math.sin(angle) * (r - 11));
        ctx.globalAlpha = 0.42 + (i % 3) * 0.18;
        ctx.fillStyle = i % 4 === 0 ? '#ffffff' : color;
        ctx.fillRect(px - 1, py - 3, 2, 6);
      }

      // 中心菱形符文
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 16);
      ctx.lineTo(x + 16, y);
      ctx.lineTo(x, y + 16);
      ctx.lineTo(x - 16, y);
      ctx.closePath();
      ctx.stroke();

      // 中心脉冲
      const pulse = 0.10 + (Math.sin(t * 4) + 1) * 0.06;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = color;
      ctx.fillRect(x - r * 0.45, y - r * 0.45, r * 0.9, r * 0.9);
      ctx.globalAlpha = 1;

      // 标签
      ctx.font = '9px "Microsoft YaHei", "Consolas", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const labelW = Math.max(76, label.length * 10 + 18);
      const labelY = y + r + 8;
      ctx.fillStyle = 'rgba(4, 9, 6, .88)';
      ctx.fillRect(x - labelW / 2, labelY, labelW, 14);
      ctx.fillStyle = color;
      ctx.fillText(label, x, labelY + 3);

      ctx.restore();
    }

    drawPortal(ctx, rect, glowColor, label, locked = false, openProgress = 1, labelBelow = false) {
      const x = Math.round(rect.x);
      const y = Math.round(rect.y);
      const w = Math.round(rect.w);
      const h = Math.round(rect.h);
      const opened = locked ? 0 : openProgress;

      // 地面阴影
      ctx.fillStyle = 'rgba(0, 0, 0, .38)';
      ctx.fillRect(x - 5, y + h - 5, w + 10, 9);
      ctx.fillRect(x - 2, y + h + 4, w + 4, 3);

      // 深色石质门框
      ctx.fillStyle = PALETTE.portalFrame;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = PALETTE.portalFrameLight;
      ctx.fillRect(x + 2, y + 2, w - 4, 3);
      ctx.fillRect(x + 2, y + 2, 3, h - 4);
      ctx.fillStyle = '#130f0c';
      ctx.fillRect(x + 6, y + 8, w - 12, h - 14);

      // 门洞内的像素漩涡
      const innerX = x + 9;
      const innerY = y + 13;
      const innerW = w - 18;
      const innerH = h - 22;
      const t = this.time;
      ctx.fillStyle = '#0b0610';
      ctx.fillRect(innerX, innerY, innerW, innerH);
      ctx.globalAlpha = locked ? 0.10 : 0.22 + opened * 0.12;
      ctx.fillStyle = glowColor;
      ctx.fillRect(innerX + 2, innerY + 2, innerW - 4, innerH - 4);
      ctx.globalAlpha = 1;

      if (!locked) {
        for (let i = 0; i < 9; i += 1) {
          const px = innerX + 3 + ((i * 13 + Math.floor(t * 18)) % Math.max(1, innerW - 6));
          const py = innerY + innerH - 4 - ((i * 17 + Math.floor(t * 30)) % Math.max(1, innerH - 8));
          ctx.fillStyle = i % 3 === 0 ? '#e5c8ff' : glowColor;
          ctx.globalAlpha = (0.45 + (i % 3) * 0.18) * (0.55 + opened * 0.45);
          ctx.fillRect(px, py, 2, 3);
        }
        ctx.globalAlpha = 1;
      }

      // 锁住时显示横闩与锁头；解锁后横闩淡出，形成简单开门动画
      if (locked || opened < 1) {
        const barAlpha = locked ? 1 : Math.max(0, 1 - opened * 2.2);
        const spread = locked ? 0 : Math.round(opened * 18);
        ctx.globalAlpha = barAlpha;
        ctx.fillStyle = '#4d4642';
        ctx.fillRect(innerX - spread, innerY + Math.round(innerH * 0.28), innerW + spread * 2, 4);
        ctx.fillRect(innerX - spread, innerY + Math.round(innerH * 0.62), innerW + spread * 2, 4);
        ctx.fillStyle = '#7c7064';
        ctx.fillRect(innerX + 2 - spread, innerY + Math.round(innerH * 0.28), innerW - 4 + spread * 2, 1);
        ctx.fillRect(innerX + 2 - spread, innerY + Math.round(innerH * 0.62), innerW - 4 + spread * 2, 1);

        const lockAlpha = locked ? 1 : Math.max(0, 1 - opened * 2.8);
        ctx.globalAlpha = lockAlpha;
        ctx.fillStyle = '#211a17';
        ctx.fillRect(innerX + innerW / 2 - 8, innerY + innerH / 2 - 5, 16, 13);
        ctx.fillStyle = '#d6b45b';
        ctx.fillRect(innerX + innerW / 2 - 6, innerY + innerH / 2 - 3, 12, 9);
        ctx.fillStyle = '#211a17';
        ctx.fillRect(innerX + innerW / 2 - 4, innerY + innerH / 2 - 8, 8, 4);
        ctx.fillRect(innerX + innerW / 2 - 2, innerY + innerH / 2, 4, 5);
        ctx.globalAlpha = 1;
      }

      // 门槛与门框铆钉
      ctx.fillStyle = PALETTE.portalFrameLight;
      ctx.fillRect(x + 3, y + h - 8, w - 6, 3);
      ctx.fillStyle = '#090705';
      ctx.fillRect(x + 10, y + h - 5, w - 20, 2);
      ctx.fillStyle = glowColor;
      ctx.fillRect(x + 3, y + 22, 2, 2);
      ctx.fillRect(x + w - 5, y + 22, 2, 2);

      // 门牌：锁定时用暗红提示，解锁后恢复传送门颜色
      ctx.save();
      ctx.font = '9px "Microsoft YaHei", "Consolas", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const labelW = locked ? 96 : 58;
      const labelY = labelBelow ? y + h + 4 : y - 17;
      ctx.fillStyle = 'rgba(4, 9, 6, .86)';
      ctx.fillRect(x + w / 2 - labelW / 2, labelY, labelW, 13);
      ctx.fillStyle = locked ? '#ff8b7a' : glowColor;
      ctx.fillText(label, x + w / 2, labelY + 2);
      ctx.restore();

      // 解锁瞬间的门前光点
      if (!locked && opened < 1) {
        ctx.fillStyle = PALETTE.portalPurpleLight;
        ctx.globalAlpha = 0.5 * (1 - opened);
        ctx.fillRect(x + 4, y + h - 22, w - 8, 2);
        ctx.fillRect(x + 10, y + h - 16, w - 20, 1);
        ctx.globalAlpha = 1;
      }
    }

    drawFireflies(ctx) {
      const time = this.time;
      const bossRoom = this.scene === 'boss';
      const treeBossRoom = bossRoom && this.currentLevelId === 1;
      const theme = (this.currentLevel && this.currentLevel.theme) ||
        PF.LEVELS.Level1.theme;
      const flyColor = treeBossRoom ? '255, 132, 76' : theme.firefly.rgb;
      const glowColor = treeBossRoom ? 'rgba(255, 120, 70, .10)' : theme.firefly.glow;
      for (const fly of this.fireflies) {
        const x = fly.x + Math.sin(time * fly.speed + fly.phase) * fly.radius;
        const y = fly.y + Math.cos(time * fly.speed * 0.8 + fly.phase * 1.7) * fly.radius * 0.5;
        const pulse = 0.35 + Math.sin(time * 2.4 + fly.phase) * 0.25;
        ctx.fillStyle = `rgba(${flyColor}, ${Math.max(0.08, pulse)})`;
        ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
        ctx.fillStyle = glowColor;
        ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 6, 6);
      }
    }

    drawTreeShadows(ctx) {
      for (const tree of this.trees) {
        const x = Math.round(tree.x);
        const y = Math.round(tree.y);
        if (tree.state === 'stump') {
          ctx.fillStyle = PALETTE.treeShadow;
          ctx.fillRect(x - 12, y - 1, 24, 5);
          ctx.fillRect(x - 8, y + 4, 16, 2);
        } else if (tree.state === 'warning') {
          ctx.fillStyle = PALETTE.treeShadow;
          ctx.fillRect(x - 12, y - 1, 24, 5);
          ctx.fillRect(x - 7, y + 4, 14, 2);
        } else {
          ctx.fillStyle = PALETTE.treeShadow;
          ctx.fillRect(x - 19, y - 2, 38, 7);
          ctx.fillRect(x - 13, y + 5, 26, 3);
          ctx.fillRect(x - 6, y - 5, 13, 2);
        }
      }
    }

    drawSortedEntities(ctx) {
      const items = [];

      for (const tree of this.trees) {
        items.push({ y: tree.y + (tree.state === 'falling' ? 1 : 0), type: 'tree', ref: tree });
      }
      for (const pod of this.pods) {
        if (!pod.dead) items.push({ y: pod.y + pod.radius, type: 'pod', ref: pod });
      }
      for (const cactus of this.cacti) {
        items.push({ y: cactus.y + cactus.radius, type: 'cactus', ref: cactus });
      }
      for (const enemy of this.enemies) {
        if (!enemy.dead) items.push({ y: enemy.y + enemy.radius, type: 'enemy', ref: enemy });
      }
      if (this.scene === 'boss' && this.boss && this.boss.state !== 'dead') {
        items.push({ y: this.boss.y + 42, type: 'boss', ref: this.boss });
      }
      if (this.player) {
        items.push({ y: this.player.y + this.player.halfH, type: 'player', ref: this.player });
      }

      items.sort((a, b) => a.y - b.y);

      for (const item of items) {
        if (item.type === 'tree') this.drawTree(ctx, item.ref);
        else if (item.type === 'pod') this.drawGasPod(ctx, item.ref);
        else if (item.type === 'cactus') this.drawCactus(ctx, item.ref);
        else if (item.type === 'enemy') this.drawEnemy(ctx, item.ref);
        else if (item.type === 'boss') this.drawBoss(ctx, item.ref);
        else this.drawPlayer(ctx, item.ref);
      }
    }

    drawTree(ctx, tree) {
      const x = Math.round(tree.x);
      const y = Math.round(tree.y);
      const fallProgress = tree.state === 'falling'
        ? clamp(tree.fallTimer / CFG.TREE.FALL_TIME, 0, 1)
        : 0;

      // Boss 生成树的预警阶段：红色像素光圈，不算正式树
      if (tree.state === 'warning') {
        this.drawBossTreeWarning(ctx, tree);
        return;
      }

      if (tree.state === 'stump') {
        this.drawStump(ctx, x, y);
        if (tree.landTimer > 0) {
          this.drawLandingDust(ctx, tree);
        }
        return;
      }

      if (tree.state === 'falling') {
        const eased = easeOutCubic(fallProgress);

        if (tree.fallDir === 'left' || tree.fallDir === 'right') {
          const sign = tree.fallDir === 'right' ? 1 : -1;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(sign * (Math.PI / 2) * eased);
          this.drawTreeSprite(ctx, tree, 0, 0, true);
          ctx.restore();
        } else {
          const sign = tree.fallDir === 'down' ? 1 : -1;
          ctx.save();
          ctx.translate(x, y + sign * eased * 28);
          ctx.scale(1 + eased * 0.14, 1 - eased * 0.58);
          this.drawTreeSprite(ctx, tree, 0, 0, true);
          ctx.restore();
        }
        return;
      }

      const hitWobble = tree.hitFlash > 0
        ? Math.sin(tree.hitFlash * 120) * 1.5
        : 0;
      this.drawTreeSprite(ctx, tree, x + Math.round(hitWobble), y, false);

      // 树木血条：受损后才显示
      if (tree.hp < tree.maxHp) {
        const barW = CFG.DRAW.TREE_HP_BAR_W;
        const barX = x - barW / 2;
        const barY = y - 72;
        ctx.fillStyle = PALETTE.treeHpBack;
        ctx.fillRect(barX - 1, barY - 1, barW + 2, 6);
        ctx.fillStyle = '#3a2a16';
        ctx.fillRect(barX, barY, barW, 4);
        ctx.fillStyle = PALETTE.treeHpFill;
        ctx.fillRect(barX, barY, Math.round(barW * (tree.hp / tree.maxHp)), 4);
        ctx.fillStyle = 'rgba(255,255,255,.22)';
        ctx.fillRect(barX, barY, Math.round(barW * (tree.hp / tree.maxHp)), 1);
      }
    }

    drawTreeSprite(ctx, tree, x, y, falling) {
      // 树干
      ctx.fillStyle = PALETTE.treeLine;
      ctx.fillRect(x - 8, y - 27, 16, 28);
      ctx.fillRect(x - 11, y - 4, 22, 5);
      ctx.fillStyle = PALETTE.treeTrunkDark;
      ctx.fillRect(x - 5, y - 26, 10, 26);
      ctx.fillStyle = PALETTE.treeTrunk;
      ctx.fillRect(x - 3, y - 25, 6, 24);
      ctx.fillStyle = PALETTE.treeTrunkLight;
      ctx.fillRect(x - 2, y - 23, 2, 15);
      ctx.fillRect(x + 2, y - 18, 1, 7);
      ctx.fillStyle = PALETTE.treeTrunkDark;
      ctx.fillRect(x - 8, y - 4, 5, 3);
      ctx.fillRect(x + 3, y - 4, 5, 3);

      // 树冠：分层像素色块
      ctx.fillStyle = PALETTE.treeLine;
      ctx.fillRect(x - 20, y - 51, 40, 23);
      ctx.fillRect(x - 16, y - 61, 32, 14);
      ctx.fillRect(x - 10, y - 67, 20, 9);
      ctx.fillRect(x - 23, y - 45, 6, 12);
      ctx.fillRect(x + 17, y - 44, 6, 10);

      ctx.fillStyle = PALETTE.treeCanopyDark;
      ctx.fillRect(x - 19, y - 50, 38, 20);
      ctx.fillRect(x - 14, y - 59, 28, 11);
      ctx.fillRect(x - 8, y - 64, 16, 7);
      ctx.fillRect(x - 22, y - 44, 5, 9);
      ctx.fillRect(x + 17, y - 43, 5, 8);

      ctx.fillStyle = PALETTE.treeCanopyMid;
      ctx.fillRect(x - 17, y - 48, 34, 16);
      ctx.fillRect(x - 12, y - 57, 24, 10);
      ctx.fillRect(x - 6, y - 62, 12, 6);
      ctx.fillRect(x - 20, y - 42, 7, 7);
      ctx.fillRect(x + 14, y - 41, 6, 5);
      ctx.fillRect(x - 9, y - 33, 18, 6);

      ctx.fillStyle = PALETTE.treeCanopyLight;
      ctx.fillRect(x - 14, y - 47, 11, 6);
      ctx.fillRect(x - 4, y - 55, 9, 5);
      ctx.fillRect(x + 7, y - 46, 8, 7);
      ctx.fillRect(x - 16, y - 39, 8, 5);
      ctx.fillRect(x - 9, y - 58, 5, 3);
      ctx.fillRect(x + 12, y - 50, 4, 4);

      ctx.fillStyle = PALETTE.treeCanopyHi;
      ctx.fillRect(x - 13, y - 46, 5, 3);
      ctx.fillRect(x - 2, y - 54, 4, 2);
      ctx.fillRect(x + 9, y - 44, 4, 3);
      ctx.fillRect(x - 15, y - 38, 3, 2);
      ctx.fillRect(x + 4, y - 59, 2, 2);

      // 树冠上的暗洞和零碎叶片
      ctx.fillStyle = PALETTE.treeCanopyDark;
      ctx.fillRect(x - 5, y - 45, 4, 3);
      ctx.fillRect(x + 3, y - 38, 3, 3);
      ctx.fillRect(x - 10, y - 51, 3, 2);
      ctx.fillRect(x + 10, y - 56, 2, 3);

      ctx.fillStyle = PALETTE.treeLeaf;
      ctx.fillRect(x - 18, y - 34, 2, 2);
      ctx.fillRect(x + 15, y - 37, 2, 2);
      ctx.fillRect(x - 7, y - 64, 2, 2);
      ctx.fillRect(x + 6, y - 61, 2, 2);

      // 被击中时闪一下白色叶块
      if (tree.hitFlash > 0 && !falling) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#e8f2cf';
        ctx.fillRect(x - 14, y - 47, 12, 4);
        ctx.fillRect(x + 5, y - 56, 7, 3);
        ctx.fillRect(x - 2, y - 62, 5, 2);
        ctx.globalAlpha = 1;
      }
    }

    drawStump(ctx, x, y) {
      ctx.fillStyle = PALETTE.treeLine;
      ctx.fillRect(x - 10, y - 7, 20, 9);
      ctx.fillStyle = PALETTE.treeTrunkDark;
      ctx.fillRect(x - 8, y - 8, 16, 8);
      ctx.fillStyle = PALETTE.treeTrunk;
      ctx.fillRect(x - 7, y - 9, 14, 5);
      ctx.fillStyle = '#a97946';
      ctx.fillRect(x - 5, y - 8, 10, 3);
      ctx.fillStyle = PALETTE.treeTrunkDark;
      ctx.fillRect(x - 2, y - 8, 2, 2);
      ctx.fillRect(x + 3, y - 6, 1, 1);
      ctx.fillStyle = PALETTE.treeCanopyDark;
      ctx.fillRect(x - 11, y - 1, 4, 2);
      ctx.fillRect(x + 8, y, 4, 2);
    }

    drawLandingDust(ctx, tree) {
      if (!tree.fallRect) return;
      const alpha = tree.landTimer / 0.36;
      const rect = tree.fallRect;
      ctx.globalAlpha = alpha * 0.16;
      ctx.fillStyle = '#d0c596';
      ctx.fillRect(Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h));
      ctx.globalAlpha = alpha * 0.26;
      ctx.fillStyle = '#0d2717';
      ctx.fillRect(Math.round(rect.x + 4), Math.round(rect.y + 6), Math.round(rect.w - 8), Math.round(rect.h - 12));
      ctx.globalAlpha = 1;
    }

    drawEntityShadow(ctx, x, y, rx, ry, alpha = 0.32) {
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    /** 用 2px 像素横条拼出椭圆，禁止 arc/bezier。 */
    drawPixelEllipse(ctx, cx, cy, rx, ry, fill, outline, border = 2) {
      const step = 2;
      for (let y = -ry; y < ry; y += step) {
        const t = y / ry;
        const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - t * t)));
        if (half <= 0) continue;
        ctx.fillStyle = outline;
        ctx.fillRect(cx - half, cy + y, half * 2, step);
      }
      for (let y = -ry + border; y < ry - border; y += step) {
        const t = y / Math.max(1, ry - border);
        const half = Math.round((rx - border) * Math.sqrt(Math.max(0, 1 - t * t)));
        if (half <= 0) continue;
        ctx.fillStyle = fill;
        ctx.fillRect(cx - half, cy + y, half * 2, step);
      }
    }

    drawPiranha(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const flash = enemy.hitFlash > 0;
      const angle = Math.atan2(
        this.player.y - enemy.y, this.player.x - enemy.x
      );
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath();
      ctx.ellipse(x, y + 8, 13, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y);
      ctx.rotate(angle);
      if (enemy.dashWindup > 0) ctx.scale(0.82, 1.14);
      ctx.fillStyle = flash ? '#ffffff' : '#1d4e70';
      ctx.beginPath();
      ctx.moveTo(-5, 0);
      ctx.lineTo(-19, -10);
      ctx.lineTo(-16, 0);
      ctx.lineTo(-19, 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = flash ? '#ffffff' : '#3f8fb8';
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = flash ? '#ffffff' : '#8fd8ef';
      ctx.beginPath();
      ctx.ellipse(2, 3, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#071a29';
      ctx.beginPath();
      ctx.arc(8, -3, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff1a8';
      ctx.fillRect(8, -4, 2, 2);
      ctx.fillStyle = '#e8f8fd';
      ctx.beginPath();
      ctx.moveTo(2, -8);
      ctx.lineTo(8, -16);
      ctx.lineTo(10, -7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    drawOctopus(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const flash = enemy.hitFlash > 0;
      const sway = Math.sin(enemy.walkTime * 3) * 2;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath();
      ctx.ellipse(x, y + 24, 26, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y);
      const outline = '#100a18';
      const body = flash ? '#ffffff' : '#4b2b6b';
      const dark = flash ? '#ffffff' : '#28143c';
      const light = flash ? '#ffffff' : '#8b5caf';
      ctx.fillStyle = outline;
      ctx.beginPath();
      ctx.ellipse(0, -4, 28, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(0, -5, 23, 21, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = light;
      ctx.fillRect(-15, -19, 12, 7);
      ctx.fillStyle = '#1a0d25';
      ctx.fillRect(-15, 1, 9, 5);
      ctx.fillRect(6, 1, 9, 5);
      ctx.fillStyle = '#ffcf63';
      ctx.fillRect(-12, 2, 4, 3);
      ctx.fillRect(9, 2, 4, 3);
      for (let i = 0; i < 5; i += 1) {
        const bx = -22 + i * 11;
        const curve = Math.sin(enemy.walkTime * 2 + i) * 4 + sway;
        ctx.strokeStyle = outline;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(bx, 10);
        ctx.quadraticCurveTo(bx + curve, 26, bx + curve * 0.6, 34);
        ctx.stroke();
        ctx.strokeStyle = body;
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.fillStyle = flash ? '#ffffff' : '#c9a6df';
        ctx.fillRect(bx + curve * 0.6 - 1, 29, 3, 3);
      }
      ctx.fillStyle = dark;
      ctx.fillRect(-23, -33, 46, 8);
      ctx.restore();
    }

    drawExecutioner(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const flash = enemy.hitFlash > 0;
      const bob = enemy.moving ? (Math.sin(enemy.walkTime * 3) > 0 ? -1 : 1) : 0;

      if (enemy.slamTimer > 0) {
        const slam = enemy.archetype.slam;
        const progress = 1 - enemy.slamTimer / slam.warnTime;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(enemy.slamAngle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, slam.range, -slam.halfAngle, slam.halfAngle);
        ctx.closePath();
        ctx.fillStyle = `rgba(220, 40, 28, ${0.12 + progress * 0.22})`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 86, 62, .95)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.46)';
      ctx.beginPath();
      ctx.ellipse(x, y + 38, 34, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y + bob);
      if (enemy.executionerStun > 0) {
        ctx.globalAlpha = 0.82;
        ctx.rotate(Math.sin(enemy.walkTime * 30) * 0.08);
      }
      const art = enemyArt.executioner;
      const face = enemy.faceX === -1 ? -1 : 1;
      ctx.scale(face, 1);
      ctx.imageSmoothingEnabled = false;
      if (art && art.ready) {
        const sprite = flash && art.flash ? art.flash : art.source;
        // 64×64原图放大为96×96；物理半径仍保持24（即48×48）。
        ctx.drawImage(sprite, -48, -48, 96, 96);
      } else {
        ctx.fillStyle = flash ? '#ffffff' : '#3a3942';
        ctx.fillRect(-24, -24, 48, 48);
      }
      ctx.restore();
    }

    drawSkeleton(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const flash = enemy.hitFlash > 0;
      const bones = Boolean(enemy.bones);
      const blink = bones
        ? 0.22 + Math.abs(Math.sin(enemy.bonesFlash * 18)) * 0.34
        : 1;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.32)';
      ctx.beginPath();
      ctx.ellipse(x, y + (bones ? 8 : 12), bones ? 16 : 11, bones ? 3 : 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y + (bones ? 8 : 0));
      ctx.globalAlpha = blink;
      ctx.scale(enemy.faceX === -1 ? -1 : 1, bones ? 0.45 : 1);
      ctx.imageSmoothingEnabled = false;
      const art = enemyArt.skeleton;
      if (art && art.ready) {
        const sprite = flash && !bones && art.flash ? art.flash : art.source;
        ctx.drawImage(sprite, -24, -24, 48, 48);
      } else {
        ctx.fillStyle = flash && !bones ? '#ffffff' : '#d8d3c2';
        ctx.fillRect(-12, -16, 24, 32);
      }
      ctx.restore();
    }

    drawFireSpirit(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const flash = enemy.hitFlash > 0;
      const bob = Math.round(Math.sin(enemy.walkTime * 8) * 2);
      const r = 13;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.beginPath();
      ctx.ellipse(x, y + 11, 11, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y + bob);
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#ff5a22';
      ctx.beginPath();
      ctx.arc(0, 0, r + 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = flash ? '#ffffff' : '#4b1008';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = flash ? '#ffffff' : '#ff5a22';
      ctx.beginPath();
      ctx.arc(0, 0, r - 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = flash ? '#ffffff' : '#ffcf63';
      ctx.beginPath();
      ctx.arc(-2, -2, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff3c4';
      ctx.fillRect(-6, -3, 4, 5);
      ctx.fillRect(3, -3, 4, 5);
      ctx.fillStyle = '#4b1008';
      ctx.fillRect(-5, -1, 2, 3);
      ctx.fillRect(4, -1, 2, 3);
      ctx.restore();
    }

    drawLavaGolem(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const flash = enemy.hitFlash > 0;
      const bob = Math.round(Math.sin(enemy.walkTime * 2.4));
      const s = 30;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.42)';
      ctx.beginPath();
      ctx.ellipse(x, y + 28, 30, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y + bob);
      ctx.fillStyle = flash ? '#ffffff' : '#1b0707';
      ctx.fillRect(-s - 4, -s - 4, s * 2 + 8, s * 2 + 8);
      ctx.fillStyle = flash ? '#ffffff' : '#6e1712';
      ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.fillStyle = flash ? '#ffffff' : '#b92f1c';
      ctx.fillRect(-s + 5, -s + 5, s * 2 - 10, 8);
      ctx.fillRect(-s + 5, s - 15, s * 2 - 10, 6);
      ctx.fillStyle = flash ? '#ffffff' : '#3d0b0a';
      ctx.fillRect(-s + 8, -s + 20, s * 2 - 16, 8);
      ctx.fillRect(-s + 8, -s + 40, s * 2 - 16, 7);
      ctx.fillStyle = flash ? '#ffffff' : '#ff6a28';
      ctx.fillRect(-18, -22, 6, 28);
      ctx.fillRect(12, -10, 5, 27);
      ctx.fillRect(-3, 13, 22, 5);
      ctx.fillStyle = flash ? '#ffffff' : '#ffd166';
      ctx.fillRect(-14, -3, 5, 5);
      ctx.fillRect(9, -3, 5, 5);
      ctx.fillStyle = '#1b0707';
      ctx.fillRect(-12, -1, 2, 3);
      ctx.fillRect(10, -1, 2, 3);
      ctx.restore();
    }

    drawEnemy(ctx, enemy) {
      if (enemy.type === 'piranha') {
        this.drawPiranha(ctx, enemy);
        return;
      }
      if (enemy.type === 'octopus') {
        this.drawOctopus(ctx, enemy);
        return;
      }
      if (enemy.type === 'executioner') {
        this.drawExecutioner(ctx, enemy);
        return;
      }
      if (enemy.type === 'skeleton') {
        this.drawSkeleton(ctx, enemy);
        return;
      }
      if (enemy.type === 'fireSpirit') {
        this.drawFireSpirit(ctx, enemy);
        return;
      }
      if (enemy.type === 'lavaGolem') {
        this.drawLavaGolem(ctx, enemy);
        return;
      }
      if (enemy.type === 'grunt' || enemy.type === 'elite') {
        this.drawSlime(ctx, enemy);
        return;
      }
      if (enemy.type === 'swampFly') {
        this.drawSwampFly(ctx, enemy);
        return;
      }
      if (enemy.type === 'mireLurker') {
        this.drawMireLurker(ctx, enemy);
        return;
      }
      if (enemy.type === 'mummy') {
        this.drawMummy(ctx, enemy);
        return;
      }
      if (enemy.type === 'scorpion') {
        this.drawScorpion(ctx, enemy);
        return;
      }
      if (enemy.type === 'snowman') {
        this.drawSnowman(ctx, enemy);
        return;
      }
      if (enemy.type === 'giantYeti') {
        this.drawGiantYeti(ctx, enemy);
        return;
      }
      if (enemy.type === 'elite') {
        this.drawEliteEnemy(ctx, enemy);
        return;
      }

      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const colors = enemy.archetype.colors;
      const bob = Math.sin(enemy.walkTime * 11) > 0 ? 1 : 0;
      const searching = enemy.state === 'chase';
      const scale = enemy.radius / 9;

      // 影子
      ctx.fillStyle = colors.shadow;
      ctx.fillRect(x - 8, y + 7, 16, 4);
      ctx.fillRect(x - 5, y + 11, 10, 2);

      ctx.save();
      ctx.translate(x, y + bob);
      ctx.scale(scale, scale);

      // 小短腿
      const legSwing = Math.sin(enemy.walkTime * 13) > 0 ? 1 : -1;
      ctx.fillStyle = colors.outline;
      ctx.fillRect(-7 + legSwing, 6, 5, 5);
      ctx.fillRect(2 - legSwing, 6, 5, 5);
      ctx.fillStyle = colors.bodyDark;
      ctx.fillRect(-6 + legSwing, 7, 4, 3);
      ctx.fillRect(2 - legSwing, 7, 4, 3);

      // 身体轮廓
      ctx.fillStyle = colors.outline;
      ctx.fillRect(-9, -6, 18, 13);
      ctx.fillRect(-7, -8, 14, 2);
      ctx.fillRect(-10, 3, 2, 4);
      ctx.fillRect(8, 3, 2, 4);

      // 身体
      ctx.fillStyle = colors.bodyDark;
      ctx.fillRect(-7, -4, 14, 10);
      ctx.fillStyle = colors.body;
      ctx.fillRect(-6, -5, 12, 8);
      ctx.fillStyle = colors.bodyLight;
      ctx.fillRect(-4, -5, 5, 2);
      ctx.fillRect(3, -3, 3, 2);

      // 角和耳朵
      ctx.fillStyle = colors.horn;
      ctx.fillRect(-8, -11, 3, 4);
      ctx.fillRect(5, -11, 3, 4);
      ctx.fillStyle = colors.outline;
      ctx.fillRect(-8, -10, 1, 2);
      ctx.fillRect(7, -10, 1, 2);

      // 眼睛：追击时更亮，并朝玩家方向偏移
      const faceOffset = enemy.faceX;
      ctx.fillStyle = searching ? colors.eyeChase : colors.eye;
      ctx.fillRect(-4 + faceOffset, -3, 3, 2);
      ctx.fillRect(2 + faceOffset, -3, 3, 2);
      ctx.fillStyle = colors.mouth;
      ctx.fillRect(-2, 2, 5, 2);
      ctx.fillRect(-1, 2, 1, 1);

      // 追击感叹号
      if (searching) {
        ctx.fillStyle = '#ffe57b';
        ctx.fillRect(9, -17, 3, 5);
        ctx.fillRect(9, -10, 3, 2);
      }

      ctx.restore();
    }

    drawEnemyWarnings(ctx) {
      if (this.currentLevelId !== 3 && this.currentLevelId !== 4) return;
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (enemy.type === 'giantYeti') {
          const cfg = enemy.archetype.slam;
          const charging = enemy.slamState === 'charge';
          const jumping = enemy.slamState === 'jump';
          if (charging || jumping) {
            const progress = charging
              ? 1 - enemy.slamTimer / Math.max(0.001, cfg.warnTime)
              : 1;
            const r = cfg.radius;
            ctx.save();
            ctx.translate(
              Math.round(enemy.slamTargetX),
              Math.round(enemy.slamTargetY)
            );
            ctx.fillStyle = `rgba(216, 48, 46, ${0.10 + progress * 0.16})`;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 87, 72, .95)';
            ctx.lineWidth = 3;
            ctx.setLineDash([11, 7]);
            ctx.lineDashOffset = -this.time * 28;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255, 107, 82, .8)';
            ctx.fillRect(-2, -r, 4, r * 2);
            ctx.fillRect(-r, -2, r * 2, 4);
            ctx.restore();
          }
          if (enemy.slamShockwave > 0) {
            const t = 1 - enemy.slamShockwave / 0.45;
            const r = cfg.radius * (0.55 + t * 0.85);
            ctx.save();
            ctx.translate(
              Math.round(enemy.slamTargetX),
              Math.round(enemy.slamTargetY)
            );
            ctx.globalAlpha = (1 - t) * 0.9;
            ctx.strokeStyle = '#eafaff';
            ctx.lineWidth = 4 - t * 2;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = (1 - t) * 0.5;
            ctx.strokeStyle = '#8fd0e8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
          continue;
        }
        if (enemy.type !== 'scorpion') continue;
        if (enemy.burrowPhase !== 'warning') continue;
        const cfg = enemy.archetype.burrow;
        const progress = 1 - enemy.burrowTimer / Math.max(0.001, cfg.warnTime);
        const r = cfg.radius;
        ctx.save();
        ctx.translate(Math.round(enemy.x), Math.round(enemy.y));
        ctx.fillStyle = `rgba(216, 48, 46, ${0.10 + progress * 0.16})`;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 87, 72, .95)';
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 8]);
        ctx.lineDashOffset = -this.time * 30;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255, 107, 82, .8)';
        ctx.fillRect(-2, -r, 4, r * 2);
        ctx.fillRect(-r, -2, r * 2, 4);
        ctx.restore();
      }
    }

    drawSnowman(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const colors = enemy.archetype.colors;
      const flash = enemy.hitFlash > 0;
      const outline = colors.outline;
      const snow = flash ? '#ffffff' : colors.snow;
      const snowDark = flash ? '#eef8ff' : colors.snowDark;
      const snowShade = flash ? '#dfeef7' : colors.snowShade;
      const scarf = flash ? '#ffffff' : '#c94040';
      const scarfLight = flash ? '#ffffff' : '#ff6b5e';
      const arm = flash ? '#ffffff' : colors.arm;
      const face = enemy.faceX >= 0 ? 1 : -1;
      const bob = Math.sin(enemy.walkTime * 7) > 0 ? 1 : 0;

      this.drawEntityShadow(ctx, x, y + 15, 16, 4, 0.28);

      ctx.save();
      ctx.translate(x, y + bob);

      // 锯齿状树枝手臂。
      ctx.fillStyle = arm;
      ctx.fillRect(-24, -4, 8, 2);
      ctx.fillRect(-18, -8, 2, 6);
      ctx.fillRect(-21, 0, 2, 5);
      ctx.fillRect(16, -4, 8, 2);
      ctx.fillRect(16, -8, 2, 6);
      ctx.fillRect(19, 0, 2, 5);

      // 阶梯状下身雪球。
      const bodyRows = [
        [-8, -9, 16, 3],
        [-11, -6, 22, 4],
        [-13, -2, 26, 6],
        [-11, 4, 22, 4],
        [-8, 8, 16, 3]
      ];
      for (const row of bodyRows) {
        ctx.fillStyle = outline;
        ctx.fillRect(row[0], row[1], row[2], row[3]);
        ctx.fillStyle = snowDark;
        ctx.fillRect(row[0] + 2, row[1] + 1, row[2] - 4, row[3] - 1);
      }
      ctx.fillStyle = snow;
      ctx.fillRect(-8, -6, 10, 7);
      ctx.fillRect(-5, -8, 7, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-8, -7, 3, 2);
      ctx.fillStyle = snowShade;
      ctx.fillRect(4, -4, 7, 7);
      ctx.fillRect(-6, 5, 12, 2);

      // 红围巾，纯像素方块。
      ctx.fillStyle = scarf;
      ctx.fillRect(-10, -12, 20, 4);
      ctx.fillStyle = scarfLight;
      ctx.fillRect(-10, -12, 20, 1);
      ctx.fillStyle = scarf;
      ctx.fillRect(face >= 0 ? 5 : -9, -9, 4, 9);
      ctx.fillStyle = '#8f252e';
      ctx.fillRect(face >= 0 ? 5 : -9, -1, 4, 2);

      // 阶梯状头部雪球。
      const headRows = [
        [-4, -28, 8, 3],
        [-7, -25, 14, 3],
        [-9, -22, 18, 5],
        [-7, -17, 14, 3]
      ];
      for (const row of headRows) {
        ctx.fillStyle = outline;
        ctx.fillRect(row[0], row[1], row[2], row[3]);
        ctx.fillStyle = snowDark;
        ctx.fillRect(row[0] + 2, row[1] + 1, row[2] - 4, row[3] - 1);
      }
      ctx.fillStyle = snow;
      ctx.fillRect(-6, -25, 8, 7);
      ctx.fillRect(-4, -27, 5, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-6, -25, 3, 2);
      ctx.fillStyle = snowShade;
      ctx.fillRect(3, -21, 4, 5);

      // 2×2 黑眼睛、像素胡萝卜鼻与纽扣。
      ctx.fillStyle = flash ? '#ffffff' : colors.eye;
      ctx.fillRect(-5, -22, 2, 2);
      ctx.fillRect(3, -22, 2, 2);
      ctx.fillStyle = colors.nose;
      ctx.fillRect(5, -19, 4, 2);
      ctx.fillRect(9, -18, 3, 2);
      ctx.fillRect(5, -17, 4, 1);
      ctx.fillStyle = '#fff0c8';
      ctx.fillRect(9, -18, 3, 1);
      ctx.fillStyle = arm;
      ctx.fillRect(-2, -3, 2, 2);
      ctx.fillRect(-2, 2, 2, 2);

      // 头顶黑色像素雪花。
      ctx.fillStyle = flash ? '#ffffff' : '#1e2a32';
      ctx.fillRect(-1, -35, 2, 8);
      ctx.fillRect(-5, -32, 10, 2);
      ctx.fillRect(-4, -34, 2, 2);
      ctx.fillRect(2, -34, 2, 2);
      ctx.fillRect(-4, -28, 2, 2);
      ctx.fillRect(2, -28, 2, 2);
      ctx.restore();
    }

    drawGiantYeti(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const colors = enemy.archetype.colors;
      const flash = enemy.hitFlash > 0;
      const outline = colors.outline;
      const fur = flash ? '#ffffff' : colors.fur;
      const furDark = flash ? '#f0f8ff' : colors.furDark;
      const furShade = flash ? '#e4f2fa' : colors.furShade;
      const cfg = enemy.archetype.slam;
      const charging = enemy.slamState === 'charge';
      const jumping = enemy.slamState === 'jump';
      const stunned = enemy.slamState === 'stun';
      const bob = Math.sin(enemy.walkTime * 5) > 0 ? 1 : 0;
      const crouch = charging ? 5 : 0;
      const jumpOffsetY = enemy.jumpOffsetY || 0;
      const scale = jumping ? cfg.jumpScale : 1;
      const shadowScale = 1 - Math.min(0.32, jumpOffsetY / 180);

      ctx.fillStyle = colors.shadow;
      ctx.beginPath();
      ctx.ellipse(
        x, y + 20,
        27 * shadowScale, 8 * shadowScale,
        0, 0, Math.PI * 2
      );
      ctx.fill();

      ctx.save();
      ctx.translate(x, y + bob + crouch - jumpOffsetY);
      ctx.scale(scale, scale);
      ctx.translate(-x, -y);

      // 大脚
      ctx.fillStyle = outline;
      ctx.fillRect(x - 22, y + 10, 15, 10);
      ctx.fillRect(x + 7, y + 10, 15, 10);
      ctx.fillStyle = furDark;
      ctx.fillRect(x - 19, y + 11, 11, 6);
      ctx.fillRect(x + 8, y + 11, 11, 6);

      // 巨大身体
      ctx.fillStyle = outline;
      ctx.fillRect(x - 25, y - 26, 50, 40);
      ctx.fillStyle = furDark;
      ctx.fillRect(x - 22, y - 24, 44, 36);
      ctx.fillStyle = fur;
      ctx.fillRect(x - 18, y - 25, 37, 30);
      ctx.fillStyle = furShade;
      ctx.fillRect(x - 22, y + 4, 44, 7);
      ctx.fillRect(x - 14, y - 18, 5, 18);

      // 手臂与爪
      ctx.fillStyle = outline;
      ctx.fillRect(x - 38, y - 18, 14, 25);
      ctx.fillRect(x + 24, y - 18, 14, 25);
      ctx.fillStyle = fur;
      ctx.fillRect(x - 35, y - 16, 9, 19);
      ctx.fillRect(x + 26, y - 16, 9, 19);
      ctx.fillStyle = colors.claw;
      ctx.fillRect(x - 36, y + 3, 3, 6);
      ctx.fillRect(x - 31, y + 4, 3, 5);
      ctx.fillRect(x + 28, y + 3, 3, 6);
      ctx.fillRect(x + 33, y + 4, 3, 5);

      // 头与角
      ctx.fillStyle = outline;
      ctx.fillRect(x - 18, y - 42, 36, 22);
      ctx.fillStyle = furDark;
      ctx.fillRect(x - 15, y - 40, 30, 19);
      ctx.fillStyle = fur;
      ctx.fillRect(x - 12, y - 41, 25, 15);
      ctx.fillStyle = colors.horn;
      ctx.fillRect(x - 22, y - 45, 6, 10);
      ctx.fillRect(x + 16, y - 45, 6, 10);
      ctx.fillRect(x - 26, y - 48, 6, 7);
      ctx.fillRect(x + 20, y - 48, 6, 7);

      // 眼睛与獠牙
      ctx.fillStyle = flash ? '#ffffff' : colors.eye;
      ctx.fillRect(x - 9, y - 35, 4, 4);
      ctx.fillRect(x + 5, y - 35, 4, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 5, y - 23, 4, 4);
      ctx.fillRect(x + 2, y - 23, 4, 4);
      ctx.fillStyle = '#31414b';
      ctx.fillRect(x - 4, y - 22, 2, 2);
      ctx.fillRect(x + 3, y - 22, 2, 2);

      if (charging) {
        ctx.globalAlpha = 0.45 + Math.sin(this.time * 24) * 0.25;
        ctx.strokeStyle = '#ff5a4b';
        ctx.lineWidth = 3;
        ctx.strokeRect(x - 31, y - 49, 62, 77);
        ctx.fillStyle = 'rgba(255, 76, 62, .22)';
        ctx.fillRect(x - 28, y - 46, 56, 70);
        ctx.globalAlpha = 1;
      }

      if (stunned) {
        ctx.fillStyle = '#eefaff';
        for (let i = 0; i < 4; i += 1) {
          const angle = this.time * 4 + (i / 4) * Math.PI * 2;
          ctx.fillRect(
            x + Math.cos(angle) * 28 - 2,
            y - 58 + Math.sin(angle) * 10,
            4, 4
          );
        }
      }

      ctx.restore();
    }

    drawMummy(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const colors = enemy.archetype.colors;
      const chase = enemy.state === 'chase';
      const flash = enemy.hitFlash > 0;
      const bob = Math.sin(enemy.walkTime * 8) > 0 ? 1 : 0;
      const legSwing = Math.sin(enemy.walkTime * 9) > 0 ? 1 : -1;
      const outline = colors.outline;
      const bandage = flash ? '#ffffff' : colors.bandage;
      const bandageDark = flash ? '#ececec' : colors.bandageDark;
      const bandageLight = flash ? '#ffffff' : colors.bandageLight;

      this.drawEntityShadow(ctx, x, y + 12, 12, 4, 0.30);

      ctx.save();
      ctx.translate(0, bob);

      // 腿
      ctx.fillStyle = outline;
      ctx.fillRect(x - 7 + legSwing, y + 4, 5, 9);
      ctx.fillRect(x + 2 - legSwing, y + 4, 5, 9);
      ctx.fillStyle = bandageDark;
      ctx.fillRect(x - 6 + legSwing, y + 6, 3, 5);
      ctx.fillRect(x + 3 - legSwing, y + 6, 3, 5);

      // 躯干与绷带
      ctx.fillStyle = outline;
      ctx.fillRect(x - 10, y - 8, 20, 16);
      ctx.fillStyle = bandageDark;
      ctx.fillRect(x - 8, y - 7, 16, 14);
      ctx.fillStyle = bandage;
      ctx.fillRect(x - 6, y - 8, 12, 5);
      ctx.fillRect(x - 7, y - 2, 14, 4);
      ctx.fillRect(x - 5, y + 4, 10, 3);
      ctx.fillStyle = bandageLight;
      ctx.fillRect(x - 4, y - 7, 4, 2);
      ctx.fillRect(x - 6, y - 1, 3, 2);

      // 黑色绷带横线。
      ctx.fillStyle = flash ? '#5a5147' : '#3f3a32';
      ctx.fillRect(x - 8, y - 4, 16, 2);
      ctx.fillRect(x - 7, y + 1, 14, 2);
      ctx.fillRect(x - 5, y + 5, 10, 2);

      // 手臂
      ctx.fillStyle = outline;
      ctx.fillRect(x - 15, y - 6, 6, 12);
      ctx.fillRect(x + 9, y - 6, 6, 12);
      ctx.fillStyle = bandage;
      ctx.fillRect(x - 14, y - 4, 4, 7);
      ctx.fillRect(x + 10, y - 4, 4, 7);
      ctx.fillStyle = bandageDark;
      ctx.fillRect(x - 14, y + 4, 4, 3);
      ctx.fillRect(x + 10, y + 4, 4, 3);

      // 头与绷带
      ctx.fillStyle = outline;
      ctx.fillRect(x - 9, y - 22, 18, 15);
      ctx.fillStyle = bandageDark;
      ctx.fillRect(x - 7, y - 20, 14, 12);
      ctx.fillStyle = bandage;
      ctx.fillRect(x - 6, y - 21, 12, 4);
      ctx.fillRect(x - 7, y - 15, 14, 3);
      ctx.fillStyle = bandageLight;
      ctx.fillRect(x - 4, y - 20, 5, 2);

      // 发光绿眼：外层半透明绿光 + 深色眼眶。
      ctx.fillStyle = 'rgba(82, 255, 116, .20)';
      ctx.fillRect(x - 8, y - 18, 16, 9);
      ctx.fillStyle = colors.outline;
      ctx.fillRect(x - 6, y - 16, 5, 5);
      ctx.fillRect(x + 2, y - 16, 5, 5);
      ctx.fillStyle = flash ? '#e8ffd0' : colors.eye;
      ctx.fillRect(x - 5, y - 15, 3, 3);
      ctx.fillRect(x + 3, y - 15, 3, 3);
      ctx.fillStyle = colors.eyeChase;
      ctx.fillRect(x - 4, y - 14, 1, 1);
      ctx.fillRect(x + 4, y - 14, 1, 1);

      // 2 格血条
      if (enemy.hp < enemy.maxHp || enemy.hitFlash > 0) {
        for (let i = 0; i < enemy.maxHp; i += 1) {
          ctx.fillStyle = i < enemy.hp ? '#8eff9f' : '#3b3325';
          ctx.fillRect(x - 9 + i * 10, y - 29, 7, 3);
        }
      }

      ctx.restore();
    }

    drawScorpion(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const colors = enemy.archetype.colors;

      if (enemy.burrowPhase) {
        // 地下只留沙尘/鼓包。
        ctx.save();
        ctx.fillStyle = 'rgba(92, 60, 31, .48)';
        ctx.beginPath();
        ctx.ellipse(x, y + 11, 28, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a7793e';
        ctx.fillRect(x - 15, y + 8, 30, 4);
        ctx.fillStyle = '#6b442e';
        ctx.fillRect(x - 4, y + 4, 8, 4);
        ctx.restore();
        return;
      }

      const flash = enemy.hitFlash > 0;
      const chase = enemy.state === 'chase';
      const legSwing = Math.sin(enemy.walkTime * 9) > 0 ? 2 : -2;
      const outline = colors.outline;
      const body = flash ? '#ffffff' : colors.body;
      const dark = flash ? '#f0f0f0' : colors.bodyDark;
      const light = flash ? '#ffffff' : colors.bodyLight;
      const claw = flash ? '#ffffff' : colors.claw;
      const clawLight = flash ? '#ffffff' : colors.clawLight;

      ctx.fillStyle = colors.shadow;
      ctx.beginPath();
      ctx.ellipse(x, y + 18, 27, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(x, y);

      // 八足
      ctx.fillStyle = outline;
      for (let i = -1; i <= 1; i += 1) {
        ctx.fillRect(-22 + i * 7 + legSwing, 8, 5, 11);
        ctx.fillRect(13 + i * 7 - legSwing, 8, 5, 11);
      }
      ctx.fillStyle = dark;
      for (let i = -1; i <= 1; i += 1) {
        ctx.fillRect(-20 + i * 7 + legSwing, 10, 3, 6);
        ctx.fillRect(15 + i * 7 - legSwing, 10, 3, 6);
      }

      // 双钳
      ctx.fillStyle = outline;
      ctx.fillRect(-34, -2, 14, 10);
      ctx.fillRect(20, -2, 14, 10);
      ctx.fillRect(-40, 2, 9, 6);
      ctx.fillRect(31, 2, 9, 6);
      ctx.fillStyle = claw;
      ctx.fillRect(-32, 0, 10, 7);
      ctx.fillRect(22, 0, 10, 7);
      ctx.fillStyle = clawLight;
      ctx.fillRect(-39, 3, 5, 3);
      ctx.fillRect(34, 3, 5, 3);

      // 身体
      ctx.fillStyle = outline;
      ctx.fillRect(-17, -10, 34, 24);
      ctx.fillRect(-13, -17, 26, 10);
      ctx.fillStyle = dark;
      ctx.fillRect(-15, -8, 30, 20);
      ctx.fillStyle = body;
      ctx.fillRect(-12, -13, 24, 19);
      ctx.fillStyle = light;
      ctx.fillRect(-9, -11, 11, 5);
      ctx.fillRect(5, -5, 6, 4);

      // 红色尾巴
      ctx.fillStyle = outline;
      ctx.fillRect(8, -26, 6, 18);
      ctx.fillRect(12, -31, 13, 6);
      ctx.fillRect(22, -28, 6, 8);
      ctx.fillStyle = colors.tail;
      ctx.fillRect(10, -26, 3, 15);
      ctx.fillRect(14, -29, 10, 3);
      ctx.fillStyle = colors.tailLight;
      ctx.fillRect(22, -27, 3, 4);

      // 眼睛
      ctx.fillStyle = chase ? colors.eyeChase : colors.eye;
      ctx.fillRect(-8, -8, 4, 3);
      ctx.fillRect(4, -8, 4, 3);

      // 8 格血条
      if (enemy.hp < enemy.maxHp || enemy.hitFlash > 0) {
        const pipW = 5;
        const totalW = enemy.maxHp * pipW + (enemy.maxHp - 1) * 1;
        const startX = -Math.round(totalW / 2);
        for (let i = 0; i < enemy.maxHp; i += 1) {
          ctx.fillStyle = i < enemy.hp ? '#f0bf72' : '#3c2517';
          ctx.fillRect(startX + i * (pipW + 1), -38, pipW, 3);
        }
      }

      ctx.restore();
    }

    drawSwampFly(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const colors = enemy.archetype.colors;
      const searching = enemy.state === 'chase';
      const flash = enemy.hitFlash > 0;
      const bob = Math.round(Math.sin(enemy.walkTime * 22) * 2);

      this.drawEntityShadow(ctx, x, y + 10, 10, 3.5, 0.28);

      ctx.save();
      ctx.translate(x, y + bob);

      // 半透明像素双翼，高频扇动。
      const wingLift = Math.sin(enemy.walkTime * 38) > 0 ? -2 : 2;
      ctx.globalAlpha = 0.58;
      ctx.fillStyle = flash ? '#e8ffe0' : colors.wing;
      ctx.fillRect(-18, -7 + wingLift, 8, 4);
      ctx.fillRect(-23, -4 + wingLift, 12, 3);
      ctx.fillRect(-20, 0 + wingLift, 7, 3);
      ctx.fillRect(10, -7 - wingLift, 8, 4);
      ctx.fillRect(11, -4 - wingLift, 12, 3);
      ctx.fillRect(13, 0 - wingLift, 7, 3);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.outline;
      ctx.fillRect(-19, -8 + wingLift, 2, 2);
      ctx.fillRect(-25, -5 + wingLift, 3, 2);
      ctx.fillRect(17, -8 - wingLift, 2, 2);
      ctx.fillRect(22, -5 - wingLift, 3, 2);

      // 腹部与胸节
      ctx.fillStyle = colors.outline;
      ctx.fillRect(-8, -5, 16, 11);
      ctx.fillRect(-5, -8, 10, 4);
      ctx.fillStyle = flash ? '#ffffff' : colors.body;
      ctx.fillRect(-6, -5, 12, 8);
      ctx.fillStyle = flash ? '#ffffff' : colors.bodyLight;
      ctx.fillRect(-4, -4, 6, 3);
      ctx.fillStyle = flash ? '#ffffff' : colors.bodyDark;
      ctx.fillRect(4, 0, 5, 5);

      // 毒针
      ctx.fillStyle = flash ? '#ffffff' : colors.stinger;
      ctx.fillRect(7, 4, 6, 3);
      ctx.fillRect(11, 6, 4, 2);

      // 复眼
      ctx.fillStyle = searching ? colors.eyeChase : colors.eye;
      ctx.fillRect(-5, -7, 3, 2);
      ctx.fillRect(1, -7, 3, 2);
      ctx.fillStyle = colors.outline;
      ctx.fillRect(-4, -3, 6, 2);

      if (searching) {
        ctx.fillStyle = '#e9ff9e';
        ctx.fillRect(12, -15, 2, 4);
        ctx.fillRect(12, -9, 2, 2);
      }
      ctx.restore();
    }

    drawMireLurker(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const colors = enemy.archetype.colors;
      const searching = enemy.state === 'chase';
      const flash = enemy.hitFlash > 0;
      const bob = Math.sin(enemy.walkTime * 5) > 0 ? 1 : 0;
      const legSwing = Math.sin(enemy.walkTime * 7) > 0 ? 2 : -2;

      // 泥潭阴影
      ctx.fillStyle = colors.shadow;
      ctx.beginPath();
      ctx.ellipse(x, y + 19, 27, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(x, y + bob);

      // 触须与泥浆
      ctx.fillStyle = colors.outline;
      ctx.fillRect(-23, 8, 8, 5);
      ctx.fillRect(15, 8, 8, 5);
      ctx.fillRect(-27, 12, 6, 4);
      ctx.fillRect(21, 12, 6, 4);
      ctx.fillStyle = flash ? '#ffffff' : colors.muck;
      ctx.fillRect(-18, 15, 36, 5);
      ctx.fillRect(-12, 20, 24, 3);

      // 四肢
      ctx.fillStyle = colors.outline;
      ctx.fillRect(-19 + legSwing, 8, 8, 10);
      ctx.fillRect(11 - legSwing, 8, 8, 10);
      ctx.fillStyle = colors.bodyDark;
      ctx.fillRect(-17 + legSwing, 10, 5, 6);
      ctx.fillRect(12 - legSwing, 10, 5, 6);

      // 泥沼躯体
      ctx.fillStyle = colors.outline;
      ctx.fillRect(-20, -10, 40, 22);
      ctx.fillRect(-16, -16, 32, 8);
      ctx.fillStyle = flash ? '#ffffff' : colors.bodyDark;
      ctx.fillRect(-17, -8, 34, 18);
      ctx.fillStyle = flash ? '#ffffff' : colors.body;
      ctx.fillRect(-14, -10, 28, 13);
      ctx.fillStyle = flash ? '#ffffff' : colors.bodyLight;
      ctx.fillRect(-11, -9, 12, 4);
      ctx.fillRect(7, -5, 7, 3);

      // 背部的沼气囊
      ctx.fillStyle = flash ? '#ffffff' : colors.muck;
      ctx.fillRect(-11, -19, 9, 7);
      ctx.fillRect(3, -20, 8, 8);
      ctx.fillStyle = colors.muckLight;
      ctx.fillRect(-9, -18, 4, 3);
      ctx.fillRect(5, -19, 4, 3);

      // 双眼与泥口
      ctx.fillStyle = searching ? colors.eyeChase : colors.eye;
      ctx.fillRect(-9, -3, 5, 3);
      ctx.fillRect(5, -3, 5, 3);
      ctx.fillStyle = flash ? '#ffffff' : colors.mouth;
      ctx.fillRect(-7, 3, 14, 4);
      ctx.fillRect(-4, 3, 2, 2);

      // 蓄力时口中的毒光
      if (enemy.archetype.ranged && enemy.muzzleTimer > 0) {
        ctx.fillStyle = '#b788ff';
        ctx.fillRect(-9, 3, 18, 4);
        ctx.fillStyle = '#e8ffad';
        ctx.fillRect(-3, 4, 6, 3);
      }

      // 8 HP 精英血条
      if (enemy.hp < enemy.maxHp || enemy.hitFlash > 0) {
        const barW = 34;
        const ratio = Math.max(0, enemy.hp / enemy.maxHp);
        ctx.fillStyle = colors.hpBack;
        ctx.fillRect(-barW / 2 - 1, -30, barW + 2, 5);
        ctx.fillStyle = colors.hpFill;
        ctx.fillRect(-barW / 2, -29, Math.round(barW * ratio), 3);
      }

      ctx.restore();
    }

    /** 32×32 左右的紫色精英怪。 */
    drawSlime(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const colors = enemy.archetype.colors;
      const elite = Boolean(enemy.archetype.isElite);
      const flash = enemy.hitFlash > 0;
      const searching = enemy.state === 'chase';
      const rowH = 3;
      const rows = elite ? 8 : 6;
      const w = elite ? 22 : 13;
      const h = rows * rowH;
      const profile = elite
        ? [0.34, 0.60, 0.80, 0.94, 1, 0.93, 0.78, 0.56]
        : [0.46, 0.72, 0.90, 1, 0.92, 0.66];
      const squish = Math.sin(enemy.walkTime * 7) * (elite ? 1 : 0.5);
      const body = flash ? '#ffffff' : colors.body;
      const base = flash ? '#f4f4f4' : colors.bodyDark;
      const light = flash ? '#ffffff' : colors.bodyLight;

      this.drawEntityShadow(ctx, x, y + 9, w * 0.9, 4, 0.30);

      ctx.save();
      ctx.translate(x, y + squish);

      // 阶梯状半圆：外轮廓全部用像素横条堆成。
      for (let i = 0; i < rows; i += 1) {
        const rw = Math.round(w * profile[i]);
        const top = -h + i * rowH;
        ctx.fillStyle = colors.outline;
        ctx.fillRect(-rw, top, rw * 2, rowH + 1);
        ctx.fillStyle = base;
        ctx.fillRect(-rw + 2, top + 1, rw * 2 - 4, rowH);
        ctx.fillStyle = body;
        ctx.fillRect(-rw + 4, top + 1, rw * 2 - 7, rowH - 1);
      }
      // 顶部亮红高光与左侧亮面。
      ctx.fillStyle = light;
      ctx.fillRect(-Math.round(w * 0.44), -h + 4, Math.round(w * 0.42), 3);
      ctx.fillRect(-w + 5, -h + 9, 5, Math.max(3, h - 15));
      // 右下暗面。
      ctx.fillStyle = base;
      ctx.fillRect(Math.round(w * 0.42), -h + 12, Math.max(3, Math.round(w * 0.42)), Math.max(3, h - 15));

      // 2×2 黑色像素眼睛，精英加一点凶光。
      const eyeY = -h + Math.round(h * 0.48);
      const face = enemy.faceX >= 0 ? 1 : -1;
      ctx.fillStyle = '#160f12';
      ctx.fillRect(-Math.round(w * 0.44) + face * 1, eyeY, 3, 3);
      ctx.fillRect(Math.round(w * 0.24) + face * 1, eyeY, 3, 3);
      if (searching) {
        ctx.fillStyle = colors.eye;
        ctx.fillRect(-Math.round(w * 0.44) + 1, eyeY, 1, 1);
        ctx.fillRect(Math.round(w * 0.24) + 1, eyeY, 1, 1);
      }
      ctx.fillStyle = '#2a1114';
      ctx.fillRect(-3, eyeY + 6, 6, 2);
      if (elite) {
        ctx.fillStyle = colors.horn;
        ctx.fillRect(-w + 5, -h + 3, 3, 4);
        ctx.fillRect(w - 8, -h + 3, 3, 4);
      }
      ctx.restore();

      if (elite) {
        const barW = 40;
        const barX = x - barW / 2;
        const barY = y - h - 8;
        ctx.fillStyle = colors.hpBack;
        ctx.fillRect(barX - 1, barY - 1, barW + 2, 6);
        for (let i = 0; i < enemy.maxHp; i += 1) {
          const segmentW = (barW - (enemy.maxHp - 1)) / enemy.maxHp;
          ctx.fillStyle = i < enemy.hp ? colors.hpFill : '#342442';
          ctx.fillRect(
            Math.round(barX + i * (segmentW + 1)),
            barY,
            Math.ceil(segmentW),
            4
          );
        }
      }
    }

    drawEliteEnemy(ctx, enemy) {
      const x = Math.round(enemy.x);
      const y = Math.round(enemy.y);
      const colors = enemy.archetype.colors;
      const searching = enemy.state === 'chase';
      const bob = Math.sin(enemy.walkTime * 9) > 0 ? 1 : 0;
      const legSwing = Math.sin(enemy.walkTime * 10) > 0 ? 1 : -1;
      const flash = enemy.hitFlash > 0;

      // 地面阴影
      ctx.fillStyle = colors.shadow;
      ctx.fillRect(x - 14, y + 10, 28, 5);
      ctx.fillRect(x - 9, y + 15, 18, 2);

      ctx.save();
      ctx.translate(0, bob);

      // 腿与脚
      ctx.fillStyle = colors.outline;
      ctx.fillRect(x - 9 + legSwing, y + 5, 7, 9);
      ctx.fillRect(x + 2 - legSwing, y + 5, 7, 9);
      ctx.fillStyle = colors.bodyDark;
      ctx.fillRect(x - 8 + legSwing, y + 7, 5, 6);
      ctx.fillRect(x + 3 - legSwing, y + 7, 5, 6);

      // 身体与肩甲
      ctx.fillStyle = colors.outline;
      ctx.fillRect(x - 14, y - 6, 28, 14);
      ctx.fillRect(x - 17, y - 1, 6, 9);
      ctx.fillRect(x + 11, y - 1, 6, 9);
      ctx.fillStyle = colors.cloth;
      ctx.fillRect(x - 12, y - 5, 24, 11);
      ctx.fillStyle = colors.bodyDark;
      ctx.fillRect(x - 10, y - 4, 20, 9);
      ctx.fillStyle = colors.body;
      ctx.fillRect(x - 8, y - 4, 16, 6);
      ctx.fillStyle = colors.bodyLight;
      ctx.fillRect(x - 6, y - 4, 7, 2);
      ctx.fillStyle = colors.cloth;
      ctx.fillRect(x - 12, y + 3, 24, 3);

      // 腰甲 / 尖刺
      ctx.fillStyle = colors.horn;
      ctx.fillRect(x - 15, y + 1, 4, 3);
      ctx.fillRect(x + 11, y + 1, 4, 3);
      ctx.fillStyle = colors.outline;
      ctx.fillRect(x - 14, y + 2, 2, 1);
      ctx.fillRect(x + 12, y + 2, 2, 1);

      // 头部与兜帽
      ctx.fillStyle = colors.outline;
      ctx.fillRect(x - 10, y - 16, 20, 13);
      ctx.fillRect(x - 8, y - 19, 16, 4);
      ctx.fillStyle = flash ? '#e9d5ff' : colors.bodyDark;
      ctx.fillRect(x - 8, y - 15, 16, 10);
      ctx.fillStyle = flash ? '#ffffff' : colors.body;
      ctx.fillRect(x - 6, y - 14, 12, 8);
      ctx.fillStyle = colors.bodyLight;
      ctx.fillRect(x - 5, y - 14, 4, 3);

      // 角
      ctx.fillStyle = colors.outline;
      ctx.fillRect(x - 13, y - 21, 5, 7);
      ctx.fillRect(x + 8, y - 21, 5, 7);
      ctx.fillStyle = colors.horn;
      ctx.fillRect(x - 12, y - 20, 3, 6);
      ctx.fillRect(x + 9, y - 20, 3, 6);
      ctx.fillStyle = colors.outline;
      ctx.fillRect(x - 10, y - 17, 1, 2);
      ctx.fillRect(x + 9, y - 17, 1, 2);

      // 眼睛与嘴
      const eyeOffset = enemy.faceX;
      ctx.fillStyle = searching ? colors.eyeChase : colors.eye;
      ctx.fillRect(x - 5 + eyeOffset, y - 11, 3, 2);
      ctx.fillRect(x + 2 + eyeOffset, y - 11, 3, 2);
      ctx.fillStyle = flash ? '#ffffff' : '#2a103a';
      ctx.fillRect(x - 4, y - 7, 8, 2);
      ctx.fillRect(x - 2, y - 7, 1, 1);

      // 正在蓄力 / 刚发射时，手中出现紫光
      const charge = enemy.archetype.ranged &&
        (enemy.muzzleTimer > 0 || enemy.rangedCooldown < 0.35);
      if (charge) {
        const hx = x + enemy.faceX * 16;
        const hy = y - 1;
        ctx.fillStyle = 'rgba(155, 77, 224, .22)';
        ctx.fillRect(hx - 5, hy - 5, 10, 10);
        ctx.fillStyle = PALETTE.orbEnemy.mid;
        ctx.fillRect(hx - 3, hy - 3, 6, 6);
        ctx.fillStyle = PALETTE.orbEnemy.light;
        ctx.fillRect(hx - 1, hy - 1, 2, 2);
      }

      // 追击感叹号
      if (searching) {
        ctx.fillStyle = '#ffd76e';
        ctx.fillRect(x + 20, y - 25, 3, 7);
        ctx.fillRect(x + 20, y - 17, 3, 3);
      }

      ctx.restore();

      // 精英怪常驻血条（5 格）
      const barW = 40;
      const barX = x - barW / 2;
      const barY = y - 29;
      const gap = 1;
      const segmentW = (barW - gap * (enemy.maxHp - 1)) / enemy.maxHp;
      ctx.fillStyle = colors.hpBack;
      ctx.fillRect(barX - 1, barY - 1, barW + 2, 6);
      for (let i = 0; i < enemy.maxHp; i += 1) {
        ctx.fillStyle = i < enemy.hp ? colors.hpFill : '#342442';
        ctx.fillRect(
          Math.round(barX + i * (segmentW + gap)),
          barY,
          Math.ceil(segmentW),
          4
        );
      }
    }

    drawPlayer(ctx, player) {
      // 无敌闪烁：每 0.1 秒切换一次显隐
      if (
        !player.rolling &&
        player.invuln > 0 &&
        Math.floor(player.invuln * 20) % 2 === 0
      ) return;

      // 独立贴图渲染器；若图片尚未加载完成，回退到旧像素精灵。
      const renderer = PF.PlayerRenderer;
      if (renderer && renderer.ready && renderer.draw(ctx, player, this.time)) {
        return;
      }
      this.drawPlayerPixelFallback(ctx, player);
    }

    drawPlayerPixelFallback(ctx, player) {
      if (
        !player.rolling &&
        player.invuln > 0 &&
        Math.floor(player.invuln * 20) % 2 === 0
      ) return;

      const x = Math.round(player.x);
      const y = Math.round(player.y);
      const moving = player.moving;
      const bob = moving
        ? (Math.sin(player.walkTime * 14) > 0 ? 0 : -1)
        : (Math.sin(this.time * 2.8) > 0 ? 0 : -1);
      const legSwing = moving
        ? (Math.sin(player.walkTime * 16) > 0 ? 1 : -1)
        : 0;
      const face = Math.cos(player.aimAngle) >= 0 ? 1 : -1;
      const hurtTint = player.hurtFlash > 0;
      const outline = PALETTE.playerOutline;
      const robeDark = hurtTint ? '#ffffff' : PALETTE.playerDark;
      const robe = hurtTint ? '#ffffff' : PALETTE.playerBlue;
      const hood = hurtTint ? '#ffffff' : PALETTE.playerLight;
      const staffX = x + face * 11;
      const staffBottom = y + 10;
      const staffTop = y - 18 + bob;
      const charged = player.muzzleTimer > 0 || player.shootCd <= 0.1;

      // 脚下的椭圆阴影，和碰撞框完全无关。
      this.drawEntityShadow(ctx, x, y + 10, 11, 4.5, 0.34);

      // 双腿与靴子。
      ctx.fillStyle = outline;
      ctx.fillRect(x - 6 + legSwing, y + 4, 5, 8);
      ctx.fillRect(x + 1 - legSwing, y + 4, 5, 8);
      ctx.fillStyle = PALETTE.playerBoot;
      ctx.fillRect(x - 6 + legSwing, y + 8, 5, 4);
      ctx.fillRect(x + 1 - legSwing, y + 8, 5, 4);

      // 2×2 像素木杖，顶端用像素方块拼出黄色法球。
      const tipX = staffX - face * 2;
      for (let sy = staffTop + 4; sy < staffBottom; sy += 4) {
        ctx.fillStyle = outline;
        ctx.fillRect(staffX - 2, sy, 4, 4);
        ctx.fillStyle = hurtTint ? '#b87b51' : '#8a5a34';
        ctx.fillRect(staffX, sy + 1, 2, 2);
      }
      ctx.fillStyle = 'rgba(255, 222, 91, .20)';
      ctx.fillRect(tipX - 8, staffTop - 8, 16, 16);
      ctx.fillStyle = outline;
      ctx.fillRect(tipX - 5, staffTop - 5, 10, 10);
      ctx.fillStyle = charged ? '#ffe45c' : '#b9963b';
      ctx.fillRect(tipX - 3, staffTop - 3, 6, 6);
      ctx.fillStyle = charged ? '#fff6b0' : '#d7b85a';
      ctx.fillRect(tipX - 1, staffTop - 1, 2, 2);

      // 深蓝长袍：阶梯状像素块 + 锯齿破布下摆。
      const robeY = y - 5 + bob;
      ctx.fillStyle = outline;
      ctx.fillRect(x - 7, robeY, 14, 3);
      ctx.fillRect(x - 9, robeY + 3, 18, 5);
      ctx.fillRect(x - 11, robeY + 8, 22, 4);
      ctx.fillStyle = robeDark;
      ctx.fillRect(x - 5, robeY + 2, 10, 3);
      ctx.fillRect(x - 7, robeY + 5, 14, 5);
      ctx.fillRect(x - 9, robeY + 8, 18, 2);
      ctx.fillStyle = robe;
      ctx.fillRect(x - 4, robeY + 2, 8, 3);
      ctx.fillRect(x - 6, robeY + 5, 12, 4);
      ctx.fillStyle = PALETTE.playerLight;
      ctx.fillRect(x - 5, robeY + 3, 2, 7);
      ctx.fillRect(x - 4, robeY + 2, 3, 2);
      ctx.fillStyle = PALETTE.playerDark;
      ctx.fillRect(x + 3, robeY + 5, 3, 5);
      // 锯齿边缘。
      ctx.fillStyle = outline;
      for (let i = -10; i <= 8; i += 6) {
        ctx.fillRect(x + i, robeY + 12, 4, 3);
      }
      ctx.fillStyle = robeDark;
      for (let i = -8; i <= 8; i += 6) {
        ctx.fillRect(x + i, robeY + 12, 2, 1);
      }

      // 浅蓝宽兜帽：全部由横竖像素块堆叠。
      ctx.fillStyle = outline;
      ctx.fillRect(x - 8, y - 15 + bob, 16, 9);
      ctx.fillRect(x - 5, y - 19 + bob, 10, 5);
      ctx.fillRect(x - 2, y - 22 + bob, 4, 5);
      ctx.fillRect(x - 10, y - 8 + bob, 20, 3);
      ctx.fillStyle = hood;
      ctx.fillRect(x - 6, y - 14 + bob, 12, 7);
      ctx.fillRect(x - 3, y - 18 + bob, 6, 5);
      ctx.fillRect(x - 1, y - 21 + bob, 2, 4);
      ctx.fillStyle = PALETTE.playerBlue;
      ctx.fillRect(x - 8, y - 9 + bob, 16, 2);
      ctx.fillRect(x + 2, y - 15 + bob, 3, 6);
      ctx.fillStyle = PALETTE.playerLight;
      ctx.fillRect(x - 7, y - 15 + bob, 2, 5);
      ctx.fillRect(x - 4, y - 19 + bob, 2, 2);

      // 兜帽深处只露两个白色像素眼。
      ctx.fillStyle = outline;
      ctx.fillRect(x - 6, y - 12 + bob, 12, 5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 3, y - 11 + bob, 2, 2);
      ctx.fillRect(x + 2, y - 11 + bob, 2, 2);

      // 持杖的手。
      ctx.fillStyle = PALETTE.playerSkinShade;
      ctx.fillRect(staffX - 2, y - 1 + bob, 4, 3);

      // 枪口闪光。
      if (player.muzzleTimer > 0) {
        const mx = x + Math.cos(player.aimAngle) * (CFG.ORB.SPAWN_OFFSET + 4);
        const my = y + Math.sin(player.aimAngle) * (CFG.ORB.SPAWN_OFFSET + 4);
        ctx.fillStyle = PALETTE.muzzle;
        ctx.fillRect(Math.round(mx) - 3, Math.round(my) - 3, 6, 6);
        ctx.fillStyle = '#e2b63a';
        ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 5, 2, 10);
        ctx.fillRect(Math.round(mx) - 5, Math.round(my) - 1, 10, 2);
      }

      // 长舌毒液减速反馈
      if (player.tongueSlowTimer > 0) {
        const pulse = 0.45 + Math.sin(this.time * 12) * 0.2;
        ctx.fillStyle = `rgba(139, 91, 184, ${pulse})`;
        ctx.fillRect(x - 12, y + 10, 4, 3);
        ctx.fillRect(x + 8, y + 13, 3, 2);
        ctx.fillStyle = `rgba(126, 203, 108, ${pulse})`;
        ctx.fillRect(x - 5, y + 14, 3, 2);
        ctx.fillRect(x + 12, y + 7, 2, 2);
      }

      // 流沙掩埋脚踝
      if (this.currentLevelId === 3 && this.isPointInQuicksand(player.x, player.y)) {
        const sink = player.rootTimer > 0 ? 1.2 : 1;
        const swirl = this.time * 1.8;
        ctx.fillStyle = 'rgba(83, 50, 25, .82)';
        ctx.beginPath();
        ctx.ellipse(x, y + 10, 13 * sink, 6 * sink, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b38548';
        ctx.fillRect(x - 10, y + 8, 4, 2);
        ctx.fillRect(x + 6, y + 11, 3, 2);
        ctx.fillStyle = '#d6ad68';
        for (let i = 0; i < 4; i += 1) {
          const a = swirl + i * Math.PI / 2;
          ctx.fillRect(
            Math.round(x + Math.cos(a) * 11),
            Math.round(y + 10 + Math.sin(a) * 4),
            2, 2
          );
        }
      }
    }

    drawOrbs(ctx) {
      for (const orb of this.orbs.orbs) {
        if (!orb.active) continue;
        const coldOrb = orb.team === 'enemy' && orb.cold > 0;
        const fireOrb = orb.team === 'enemy' && orb.fire;
        const colors = coldOrb
          ? {
            dark: '#3d6375',
            mid: '#9ed4ea',
            light: '#dff6ff',
            core: '#ffffff',
            glow: 'rgba(155, 215, 240, .20)'
          }
          : fireOrb
            ? {
              dark: '#5c1408',
              mid: '#ff6a28',
              light: '#ffcb63',
              core: '#fff3c4',
              glow: 'rgba(255, 90, 30, .22)'
            }
            : orb.team === 'enemy'
              ? PALETTE.orbEnemy
              : PALETTE.orbPlayer;
        const x = Math.round(orb.x);
        const y = Math.round(orb.y);
        // 只读取生成时冻结的视觉倍率；敌方弹丸永远不使用玩家半径/倍率。
        const scale = Math.max(0.6, orb.visualScale || 1);
        const glow = Math.max(4, Math.round(6 * scale));
        const dark = Math.max(3, Math.round(4 * scale));
        const mid = Math.max(2, Math.round(3 * scale));
        const light = Math.max(2, Math.round(2 * scale));
        const core = Math.max(1, Math.round(scale));

        // 像素拖尾：武器流附魔会增加拖尾长度。
        const trailLength = CFG.ORB.TRAIL_LENGTH + (orb.weaponTrail ? 4 : 0);
        const trailStep = (orb.team === 'enemy' ? 5 : 6) *
          (orb.weaponTrail ? 1.35 : 1);
        for (let i = trailLength; i >= 1; i -= 1) {
          const distanceBehind = i * trailStep;
          const tx = Math.round(x - orb.dirX * distanceBehind);
          const ty = Math.round(y - orb.dirY * distanceBehind);
          ctx.globalAlpha = Math.max(0.03, 0.38 - i * 0.055);
          ctx.fillStyle = colors.mid;
          ctx.fillRect(
            tx - Math.round(scale), ty - Math.round(scale),
            Math.max(2, Math.round(2 * scale)),
            Math.max(2, Math.round(2 * scale))
          );
        }
        ctx.globalAlpha = 1;

        // 光晕 + 核心
        ctx.fillStyle = colors.glow;
        ctx.fillRect(x - glow, y - glow, glow * 2, glow * 2);
        ctx.fillStyle = colors.dark;
        ctx.fillRect(x - dark, y - dark, dark * 2, dark * 2);
        ctx.fillStyle = colors.mid;
        ctx.fillRect(x - mid, y - mid, mid * 2, mid * 2);
        ctx.fillStyle = colors.light;
        ctx.fillRect(x - light, y - light, light * 2, light * 2);
        ctx.fillStyle = colors.core;
        ctx.fillRect(x - core, y - core, core * 2, core * 2);
      }
      ctx.globalAlpha = 1;
    }

    drawCactusSpikes(ctx) {
      if (!this.spikes || this.spikes.length === 0) return;
      for (const spike of this.spikes) {
        const x = Math.round(spike.x);
        const y = Math.round(spike.y);
        const angle = Math.atan2(spike.dirY, spike.dirX);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = 'rgba(72, 97, 42, .42)';
        ctx.fillRect(-11, -4, 22, 8);
        ctx.fillStyle = '#5e8a3a';
        ctx.fillRect(-8, -3, 16, 6);
        ctx.fillStyle = '#d8c27a';
        ctx.fillRect(-5, -2, 13, 4);
        ctx.fillStyle = '#f4e6b0';
        ctx.fillRect(6, -1, 6, 2);
        ctx.restore();
      }
    }

    drawParticles(ctx) {
      for (const p of this.particles) {
        const alpha = clamp(p.life / p.maxLife, 0, 1);
        ctx.globalAlpha = Math.min(1, alpha * 1.6);
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }

    /** F1 调试视图：碰撞框、追击状态与追击连线。只在 Canvas 上绘制，不刷控制台。 */
    drawDebugOverlay(ctx) {
      const player = this.player;
      const W = CFG.WORLD.W;
      const H = CFG.WORLD.H;
      const wall = CFG.WORLD.WALL;

      ctx.save();
      ctx.lineWidth = 1;
      ctx.textBaseline = 'top';
      ctx.font = '9px "Microsoft YaHei", "Consolas", monospace';

      // 墙体碰撞框
      ctx.strokeStyle = 'rgba(255, 92, 92, .85)';
      ctx.setLineDash([4, 3]);
      for (const rect of WALL_RECTS) {
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      }

      // 房间门触发框
      ctx.setLineDash([3, 3]);
      if (this.scene === 'forest') {
        const room = this.getCurrentRoom();
        if (room) {
          const locked = !room.unlocked;
          for (const door of room.doors) {
            ctx.strokeStyle = locked
              ? 'rgba(255, 110, 100, .95)'
              : 'rgba(205, 151, 255, .95)';
            ctx.strokeRect(
              door.rect.x + 0.5,
              door.rect.y + 0.5,
              door.rect.w - 1,
              door.rect.h - 1
            );
            ctx.fillStyle = locked
              ? 'rgba(255, 130, 118, .95)'
              : 'rgba(205, 151, 255, .95)';
            const label = `${door.side === 'top' ? 'TOP' : 'BOTTOM'} ${locked ? 'LOCKED' : 'OPEN'}`;
            ctx.fillText(label, door.rect.x + door.rect.w + 6, door.rect.y + 8);
            if (!locked && room.openProgress < 1) {
              ctx.fillText(
                `OPEN ${Math.round(room.openProgress * 100)}%`,
                door.rect.x + door.rect.w + 6,
                door.rect.y + 20
              );
            }
          }
        }
      } else {
        const portal = CFG.PORTAL.BOSS;
        const portalLocked = !this.bossRoomExitUnlocked;
        ctx.strokeStyle = portalLocked
          ? 'rgba(255, 110, 100, .95)'
          : 'rgba(205, 151, 255, .95)';
        ctx.strokeRect(portal.x + 0.5, portal.y + 0.5, portal.w - 1, portal.h - 1);
        ctx.fillStyle = portalLocked
          ? 'rgba(255, 130, 118, .95)'
          : 'rgba(205, 151, 255, .95)';
        ctx.fillText(
          portalLocked ? 'BOSS GATE LOCKED' : 'BOSS GATE OPEN',
          portal.x,
          portal.y - 26
        );
      }
      ctx.setLineDash([]);

      // 树木、预警区和倒树伤害区域
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255, 218, 94, .9)';
      for (const tree of this.trees) {
        if (tree.state === 'alive') {
          const body = tree.getBody();
          ctx.strokeRect(body.x + 0.5, body.y + 0.5, body.w - 1, body.h - 1);
        }
        if (tree.state === 'warning') {
          ctx.strokeStyle = 'rgba(255, 92, 80, .98)';
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.arc(tree.x, tree.y, CFG.BOSS.TREE_WARN_RADIUS, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#ff9c8d';
          ctx.fillText(`预警 ${Math.max(0, tree.warnTimer).toFixed(1)}s`, tree.x + 20, tree.y - 46);
          ctx.strokeStyle = 'rgba(255, 218, 94, .9)';
        }
        if (tree.state === 'falling' && tree.fallRect) {
          const r = tree.fallRect;
          ctx.strokeStyle = 'rgba(255, 140, 62, .95)';
          ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
          ctx.fillStyle = 'rgba(255, 140, 62, .12)';
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.fillStyle = '#ffb35e';
          ctx.fillText('FALL', r.x + 3, r.y + 3);
          ctx.strokeStyle = 'rgba(255, 218, 94, .9)';
        }
      }

      // 法球碰撞范围
      ctx.setLineDash([]);
      for (const orb of this.orbs.orbs) {
        if (!orb.active) continue;
        const color = orb.team === 'enemy'
          ? 'rgba(199, 132, 255, .95)'
          : 'rgba(255, 232, 112, .95)';
        ctx.strokeStyle = color;
        ctx.strokeRect(orb.x - orb.radius + 0.5, orb.y - orb.radius + 0.5, orb.radius * 2 - 1, orb.radius * 2 - 1);
      }

      // 怪物碰撞框、类型、巡逻/追击状态
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        const chasing = enemy.state === 'chase';
        const isElite = Boolean(enemy.archetype.isElite);
        const color = chasing
          ? 'rgba(255, 102, 102, .98)'
          : (isElite ? 'rgba(203, 140, 255, .95)' : 'rgba(122, 238, 156, .9)');

        ctx.strokeStyle = color;
        ctx.setLineDash(isElite ? [] : [3, 2]);
        ctx.strokeRect(
          enemy.x - enemy.radius + 0.5,
          enemy.y - enemy.radius + 0.5,
          enemy.radius * 2 - 1,
          enemy.radius * 2 - 1
        );

        // 追击者到玩家画一条连线
        if (chasing) {
          ctx.strokeStyle = 'rgba(255, 100, 100, .45)';
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(enemy.x, enemy.y);
          ctx.lineTo(player.x, player.y);
          ctx.stroke();
        }

        ctx.setLineDash([]);
        ctx.fillStyle = color;
        const label = `${isElite ? '精英' : '小怪'} · ${chasing ? '追击' : '巡逻'}`;
        ctx.fillText(label, enemy.x + enemy.radius + 4, enemy.y - 7);
      }

      // Boss 碰撞框 / 法球命中框 / 伤害冷却
      if (this.scene === 'boss' && this.boss) {
        const boss = this.boss;
        const contact = boss.getContactBody();
        const orbBody = boss.getOrbBody();
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255, 88, 74, .98)';
        ctx.strokeRect(contact.x + 0.5, contact.y + 0.5, contact.w - 1, contact.h - 1);
        ctx.strokeStyle = 'rgba(255, 196, 92, .9)';
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(orbBody.x + 0.5, orbBody.y + 0.5, orbBody.w - 1, orbBody.h - 1);
        ctx.setLineDash([]);
        ctx.fillStyle = '#ff8a7a';
        ctx.fillText(
          `BOSS 接触伤害 ${CFG.BOSS.CONTACT_DAMAGE} · 冷却 ${boss.contactCooldown.toFixed(2)}s`,
          contact.x,
          contact.y - 14
        );
        ctx.fillStyle = boss.stunTimer > 0 ? '#ffe16d' : '#c9b18d';
        ctx.fillText(
          `硬直 ${boss.stunTimer.toFixed(2)}s · 状态 ${boss.state}`,
          contact.x,
          contact.y + contact.h + 4
        );
      }

      // 玩家碰撞框
      ctx.strokeStyle = 'rgba(103, 217, 255, .95)';
      ctx.strokeRect(
        player.x - player.halfW + 0.5,
        player.y - player.halfH + 0.5,
        player.halfW * 2 - 1,
        player.halfH * 2 - 1
      );
      ctx.fillStyle = 'rgba(103, 217, 255, .95)';
      ctx.fillText('PLAYER', player.x + player.halfW + 4, player.y - 7);

      // 调试面板
      const alive = this.enemies.filter((enemy) => !enemy.dead);
      const elites = alive.filter((enemy) => enemy.archetype.isElite).length;
      const inBossRoom = this.scene === 'boss' && Boolean(this.boss);
      const warningCount = this.trees.filter(
        (tree) => tree instanceof BossTree && tree.state === 'warning'
      ).length;
      const bossTreeCount = this.countBossTrees();
      const boxW = inBossRoom ? 276 : 252;
      const boxH = inBossRoom ? 68 : 55;
      const boxX = W - wall - boxW - 8;
      const boxY = wall + 8;

      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(4, 12, 7, .82)';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = inBossRoom ? 'rgba(208, 126, 92, .9)' : 'rgba(141, 181, 106, .9)';
      ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);
      ctx.fillStyle = '#e8f2cf';
      ctx.fillText(inBossRoom ? 'F1 DEBUG · BOSS' : 'F1 DEBUG', boxX + 7, boxY + 6);

      if (inBossRoom) {
        const boss = this.boss;
        ctx.fillStyle = '#f0d878';
        ctx.fillText(
          `Boss HP ${boss.hp}/${boss.maxHp} · 移速 ${boss.getSpeedPercent()}%（${boss.getPhaseName()}）· ${boss.state}`,
          boxX + 7,
          boxY + 19
        );
        ctx.fillStyle = '#ff8f80';
        ctx.fillText(`接触伤害 CD ${boss.contactCooldown.toFixed(2)}s · 硬直 ${boss.stunTimer.toFixed(2)}s`, boxX + 7, boxY + 31);
        ctx.fillStyle = '#9fd0ff';
        ctx.fillText(`生成树 ${bossTreeCount}/${CFG.BOSS.MAX_TREES} · 预警 ${warningCount}`, boxX + 7, boxY + 43);
        ctx.fillStyle = '#c9b18d';
        ctx.fillText(`下次生成尝试 ${Math.max(0, boss.spawnTimer).toFixed(1)}s`, boxX + 7, boxY + 55);
      } else {
        const room = this.getCurrentRoom();
        ctx.fillStyle = '#f0d878';
        ctx.fillText(`追击者 ${this.activeChasers.size} / ${CFG.ENEMY.MAX_CHASERS}`, boxX + 7, boxY + 20);
        ctx.fillStyle = '#9fd0ff';
        ctx.fillText(`怪物 ${alive.length}（精英 ${elites}）`, boxX + 7, boxY + 33);
        ctx.fillStyle = '#8fa879';
        ctx.fillText(
          room
            ? `房间 ${this.currentRoomIndex + 1}/${this.levelRooms.length} · 模板 ${room.templateId} · ${room.unlocked ? '门已解锁' : '门已锁定'}`
            : '房间数据未初始化',
          boxX + 7,
          boxY + 44
        );
      }

      ctx.restore();
    }

    drawCrosshair(ctx) {
      if (!Input.mouse.inside) return;
      if (!this.player || this.state !== 'playing') return;

      const x = Math.round(Input.mouse.x);
      const y = Math.round(Input.mouse.y);
      const ready = this.player.shootCd <= 0;
      const color = ready ? '#f6e98b' : '#8b8356';
      const dark = '#1a2311';

      // 十字准星
      ctx.fillStyle = dark;
      ctx.fillRect(x - 11, y - 2, 7, 4);
      ctx.fillRect(x + 4, y - 2, 7, 4);
      ctx.fillRect(x - 2, y - 11, 4, 7);
      ctx.fillRect(x - 2, y + 4, 4, 7);
      ctx.fillStyle = color;
      ctx.fillRect(x - 10, y - 1, 6, 2);
      ctx.fillRect(x + 4, y - 1, 6, 2);
      ctx.fillRect(x - 1, y - 10, 2, 6);
      ctx.fillRect(x - 1, y + 4, 2, 6);
      ctx.fillRect(x - 1, y - 1, 2, 2);

      // 四角像素点
      ctx.fillStyle = ready ? '#f0d878' : '#625d42';
      ctx.fillRect(x - 8, y - 8, 2, 2);
      ctx.fillRect(x + 6, y - 8, 2, 2);
      ctx.fillRect(x - 8, y + 6, 2, 2);
      ctx.fillRect(x + 6, y + 6, 2, 2);
    }

    // ------------------------------------------------------------
    // HUD
    // ------------------------------------------------------------

    updateHud(force = false) {
      if (!this.player) return;
      const hp = Math.max(0, this.player.hp);
      const hpRatio = hp / this.player.maxHp;
      const cd = this.player.shootCd;
      const cdRatio = 1 - clamp(cd / CFG.PLAYER.SHOOT_CD, 0, 1);
      const alive = this.enemies.reduce((sum, enemy) => sum + (enemy.dead ? 0 : 1), 0);
      const chasing = this.activeChasers.size;

      this.hud.hpFill.style.width = `${Math.round(hpRatio * 100)}%`;
      this.hud.hpFill.parentElement.classList.toggle('is-low', hpRatio <= 0.3);
      this.hud.hpText.textContent = `${hp} / ${this.player.maxHp}`;
      this.hud.orbFill.style.width = `${Math.round(cdRatio * 100)}%`;
      this.hud.orbText.textContent = cd <= 0 ? '就绪' : `冷却 ${cd.toFixed(1)}s`;
      this.hud.monsterText.textContent = `${alive} 只`;
      const total = Math.max(1, this.initialEnemyCount);
      this.hud.monsterFill.style.width = `${Math.round((alive / total) * 100)}%`;
      this.hud.chaseText.textContent = `${chasing} / ${CFG.ENEMY.MAX_CHASERS}`;
      if (this.hud.levelLabel && this.currentLevel) {
        this.hud.levelLabel.textContent = `${this.currentLevel.layerName} · ${this.currentLevel.name}`;
      }
      if (this.controlsHint) {
        this.controlsHint.textContent = this.currentLevelId === 2
          ? '　|　毒水减速 · 打爆毒囊会爆炸'
          : this.currentLevelId === 3
            ? '　|　流沙会吸人下陷 · 仙人掌爆射8根尖刺'
            : '　|　清空当前房间后，上方门解锁；下方门可返回';
      }

      // Boss 房 HUD
      const inBossRoom = this.scene === 'boss' && Boolean(this.boss);
      this.hud.bossHud.hidden = !inBossRoom;
      if (inBossRoom) {
        const boss = this.boss;
        const bossHp = Math.max(0, boss.hp);
        this.hud.bossFill.style.width = `${Math.round((bossHp / boss.maxHp) * 100)}%`;
        this.hud.bossHpText.textContent = `${bossHp} / ${boss.maxHp}`;

        let stateText;
        let stunned = false;

        if (boss.type === 'deity') {
          this.hud.bossNameText.textContent = 'BOSS · 神明';
          this.hud.bossRoomText.textContent = 'FINAL BOSS';
          this.hud.bossMetaLabelA.textContent = '阶段';
          this.hud.bossTreeText.textContent = boss.getPhaseName();
          this.hud.bossMetaLabelB.textContent = '技能';
          this.hud.bossSpeedText.textContent = boss.getSkillLabel();
          stateText = boss.getActionLabel();
          stunned = false;
          if (boss.state === 'dead') stateText = '已击败';
          else if (boss.state === 'dying') stateText = '崩解中';
        } else if (boss.type === 'abyssWhale') {
          this.hud.bossNameText.textContent = 'BOSS · 深渊巨鲸';
          this.hud.bossRoomText.textContent = 'ABYSS BOSS';
          this.hud.bossMetaLabelA.textContent = '阶段';
          this.hud.bossTreeText.textContent = boss.getPhaseName();
          this.hud.bossMetaLabelB.textContent = '技能';
          this.hud.bossSpeedText.textContent = boss.getSkillLabel();
          stateText = boss.getActionLabel();
          stunned = false;
          if (boss.state === 'dead') stateText = '已击败';
          else if (boss.state === 'dying') stateText = '沉没中';
        } else if (boss.type === 'evilMage') {
          this.hud.bossNameText.textContent = 'BOSS · 邪恶法师';
          this.hud.bossRoomText.textContent = 'DARK BOSS';
          this.hud.bossMetaLabelA.textContent = '阶段';
          this.hud.bossTreeText.textContent = boss.getPhaseName();
          this.hud.bossMetaLabelB.textContent = '技能';
          this.hud.bossSpeedText.textContent = boss.getSkillLabel();
          stateText = boss.getActionLabel();
          stunned = false;
          if (boss.state === 'dead') stateText = '已击败';
          else if (boss.state === 'dying') stateText = '湮灭中';
        } else if (boss.type === 'lavaDragon') {
          this.hud.bossNameText.textContent = 'BOSS · 熔岩巨龙';
          this.hud.bossRoomText.textContent = 'DRAGON BOSS';
          this.hud.bossMetaLabelA.textContent = '阶段';
          this.hud.bossTreeText.textContent = boss.getPhaseName();
          this.hud.bossMetaLabelB.textContent = '技能';
          this.hud.bossSpeedText.textContent = boss.getSkillLabel();
          stateText = boss.getActionLabel();
          stunned = false;
          if (boss.state === 'dead') stateText = '已击败';
          else if (boss.state === 'dying') stateText = '崩塌中';
        } else if (boss.type === 'snowmanChief') {
          this.hud.bossNameText.textContent = 'BOSS · 雪人头目';
          this.hud.bossRoomText.textContent = 'FROST BOSS';
          this.hud.bossMetaLabelA.textContent = '阶段';
          this.hud.bossTreeText.textContent = boss.enraged ? '狂暴' : '常态';
          this.hud.bossMetaLabelB.textContent = '技能';
          this.hud.bossSpeedText.textContent = boss.getSkillLabel();
          stateText = boss.getActionLabel();
          stunned = boss.action === 'slamStun';
          if (boss.state === 'dead') stateText = '已击败';
          else if (boss.state === 'dying') stateText = '击败中';
        } else if (boss.type === 'sandworm') {
          this.hud.bossNameText.textContent = 'BOSS · 深渊沙虫';
          this.hud.bossRoomText.textContent = 'ABYSS BOSS';
          this.hud.bossMetaLabelA.textContent = '状态';
          this.hud.bossTreeText.textContent = boss.burrowed ? '地下无敌' : '地面暴露';
          this.hud.bossMetaLabelB.textContent = '阶段';
          this.hud.bossSpeedText.textContent = boss.enraged ? '狂暴' : '常态';
          stateText = boss.getActionLabel();
          stunned = boss.phase === 'exposed';
          if (boss.state === 'dead') stateText = '已击败';
          else if (boss.state === 'dying') stateText = '击败中';
        } else if (boss.type === 'swampFrog') {
          this.hud.bossNameText.textContent = 'BOSS · 沼泽巨蛙';
          this.hud.bossRoomText.textContent = 'SWAMP BOSS';
          this.hud.bossMetaLabelA.textContent = '阶段';
          this.hud.bossTreeText.textContent = boss.enraged ? '狂暴' : '常态';
          this.hud.bossMetaLabelB.textContent = '技能';
          this.hud.bossSpeedText.textContent = boss.getHudSkillText();

          stateText = boss.getActionLabel();
          stunned = boss.action === 'tongueRecover' || boss.action === 'slamRecover';
          if (boss.state === 'dead') stateText = '已击败';
          else if (boss.state === 'dying') stateText = '击败中';
        } else {
          this.hud.bossNameText.textContent = 'BOSS · 树妖';
          this.hud.bossRoomText.textContent = 'BOSS ROOM';
          this.hud.bossMetaLabelA.textContent = '生成树';
          this.hud.bossMetaLabelB.textContent = '移速';
          this.hud.bossTreeText.textContent = `${this.countBossTrees()} / ${CFG.BOSS.MAX_TREES}`;
          this.hud.bossSpeedText.textContent = `${boss.getPhaseName()} · ${boss.getSpeedPercent()}%`;

          stateText = boss.getPhaseName();
          if (boss.state === 'dead') stateText = '已击败';
          else if (boss.state === 'dying') stateText = '击败中';
          else if (boss.stunTimer > 0) {
            stateText = `硬直 ${boss.stunTimer.toFixed(1)}s`;
            stunned = true;
          }
        }

        this.hud.bossStateText.textContent = stateText;
        this.hud.bossHud.classList.toggle('is-stunned', stunned);
      } else {
        this.hud.bossHud.classList.remove('is-stunned');
      }
    }
  }

  // 启动游戏
  const game = new Game();
  window.ForestGame = game;
  PF.Game = Game;

  let lastTime = performance.now();

  function frame(now) {
    let dt = (now - lastTime) / 1000;
    lastTime = now;

    // 页面切回时避免大跳帧；同时给 delta time 设置上限
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05);

    try {
      game.update(dt);
      game.render();
      game.updateHud();
    } catch (error) {
      // 渲染/结算异常不得终止主循环，否则R键重置后也无法继续渲染。
      console.error('[GameLoop]', error);
    }

    requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    // 重新可见时重置计时，防止后台恢复出现瞬移
    lastTime = performance.now();
  });

  requestAnimationFrame(frame);
})(window);
