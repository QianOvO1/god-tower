/* ============================================================
 * ui.js — HTML/CSS UI 状态切换与 HUD 刷新
 * 只控制 DOM 覆盖层，不参与战斗和移动。
 * ============================================================ */
(function (global) {
  'use strict';

  const PF = global.PF;
  const STATES = ['MENU', 'INTRO', 'ENDING', 'PLAYING', 'LOADING', 'DEAD', 'REWARD'];

  const refs = {
    stage: document.getElementById('stage'),
    hudLayer: document.getElementById('hudLayer'),
    mainMenu: document.getElementById('main-menu'),
    loadingScreen: document.getElementById('loading-screen'),
    loadingText: document.getElementById('loadingText'),
    loadingDiaryWrap: document.getElementById('loadingDiaryWrap'),
    loadingDiary: document.getElementById('loadingDiary'),
    deathScreen: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlayTitle'),
    overlayHint: document.getElementById('overlayHint'),
    rewardScreen: document.getElementById('upgradeOverlay'),
    upgradeKicker: document.getElementById('upgradeKicker'),
    upgradeTitle: document.getElementById('upgradeTitle'),
    upgradeDesc: document.getElementById('upgradeDesc'),
    rewardOptions: document.getElementById('rewardOptions'),
    rewardRestart: document.getElementById('rewardRestart'),
    hpText: document.getElementById('hpText'),
    rollStatus: document.getElementById('rollStatus'),
    meteorHud: document.getElementById('meteorHud'),
    meteorStatus: document.getElementById('meteorStatus'),
    hudPotion: document.getElementById('hudPotion'),
    potionCount: document.getElementById('potionCount'),
    coldHud: document.getElementById('coldHud'),
    coldFill: document.getElementById('coldFill'),
    coldText: document.getElementById('coldText'),
    frostOverlay: document.getElementById('frostOverlay'),
    floorLabel: document.getElementById('floorLabel'),
    roomProgress: document.getElementById('roomProgress'),
    startGameBtn: document.getElementById('startGameBtn'),
    retryBtn: document.getElementById('retryBtn')
  };

  let loadingTimer = 0;
  let fadeTimer = 0;
  let loadingDone = null;
  let loadingLevelId = 0;

  function setHidden(element, hidden) {
    if (!element) return;
    element.hidden = Boolean(hidden);
  }

  function cancelLoading() {
    if (loadingTimer) {
      clearTimeout(loadingTimer);
      loadingTimer = 0;
    }
    if (fadeTimer) {
      clearTimeout(fadeTimer);
      fadeTimer = 0;
    }
    if (refs.loadingScreen) {
      refs.loadingScreen.classList.remove('is-fading');
      refs.loadingScreen.hidden = true;
    }
    loadingDone = null;
  }

  function loadingLayerText(levelId) {
    return `正在踏入第 ${levelId} 层...`;
  }

  const LOADING_DIARIES = {
    1: '听说塔顶能实现愿望，我变卖了所有家当才来到这里。前面好像有人……',
    2: '森林的尽头全是毒瘴。我看到几个人倒在了泥里，他们好像在慢慢干瘪……',
    3: '水已经喝光了。那些木乃伊到底是在攻击我，还是想逃出去？',
    4: '好冷。但我不能冻死在这里，她在等我。如果神明真的存在，为什么不回应我的祈祷？',
    5: '我感觉到一股巨大的能量在头顶汇聚。这里没有怪物，只有无穷无尽的火海……',
    6: '我找到了一具穿长袍的白骨，死前在地上刻着一行字：不要相信光……',
    7: '我听到了巨大的心跳声。那座塔顶，呼吸着的到底是什么东西？'
  };

  function setLoadingDiary(levelId) {
    const text = LOADING_DIARIES[levelId] || '';
    if (refs.loadingDiaryWrap) refs.loadingDiaryWrap.hidden = !text;
    if (refs.loadingDiary) refs.loadingDiary.textContent = text;
  }

  function configureReward() {
    const game = global.ForestGame;
    const hasChoice = Boolean(game && game.upgradeChoiceOpen);

    setHidden(refs.rewardOptions, !hasChoice);
    setHidden(refs.rewardRestart, hasChoice);

    if (!hasChoice) {
      if (game && game.currentLevelId >= 8) {
        refs.upgradeKicker.textContent = '最终层 · 通关';
        refs.upgradeTitle.textContent = '神明已陨落';
        refs.upgradeDesc.textContent = '八层高塔的轮回终结，神明之巅重归寂静。';
        if (refs.rewardRestart) refs.rewardRestart.textContent = '重新挑战最终层';
      } else if (game && game.currentLevelId === 7) {
        refs.upgradeKicker.textContent = '第七层 · 通关';
        refs.upgradeTitle.textContent = '深渊巨鲸已击败';
        refs.upgradeDesc.textContent = '深海迷境重归平静，神明之巅在前方。';
        if (refs.rewardRestart) refs.rewardRestart.textContent = '重新挑战第七层';
      } else if (game && game.currentLevelId === 6) {
        refs.upgradeKicker.textContent = '第六层 · 通关';
        refs.upgradeTitle.textContent = '邪恶法师已击败';
        refs.upgradeDesc.textContent = '黑暗地牢的诅咒解除，深海在前方。';
        if (refs.rewardRestart) refs.rewardRestart.textContent = '重新挑战第六层';
      } else if (game && game.currentLevelId === 5) {
        refs.upgradeKicker.textContent = '第五层 · 通关';
        refs.upgradeTitle.textContent = '熔岩巨龙已击败';
        refs.upgradeDesc.textContent = '神技已刻入灵魂。继续深入第六层。';
        if (refs.rewardRestart) refs.rewardRestart.textContent = '重新挑战第五层';
      } else if (game && game.currentLevelId === 4) {
        refs.upgradeKicker.textContent = '第四层 · 通关';
        refs.upgradeTitle.textContent = '雪人头目已击败';
        refs.upgradeDesc.textContent = '风雪暂歇。更炽热的高塔在前方。';
        if (refs.rewardRestart) refs.rewardRestart.textContent = '重新挑战第四层';
      } else {
        refs.upgradeKicker.textContent = '第三层 · 通关';
        refs.upgradeTitle.textContent = '深渊沙虫已击败';
        refs.upgradeDesc.textContent = '沙海封印解除。塔顶仍未向你敞开。';
        if (refs.rewardRestart) refs.rewardRestart.textContent = '重新挑战第三层';
      }
    }
  }

  /**
   * 根据全局状态切换 DOM 覆盖层。
   * 不修改 currentGameState，状态由 game.js 持有。
   */
  function switchUI(state) {
    const next = STATES.includes(state) ? state : 'PLAYING';
    if (refs.stage) refs.stage.dataset.uiState = next;

    const isMenu = next === 'MENU';
    const isPlaying = next === 'PLAYING';
    const isLoading = next === 'LOADING';
    const isDead = next === 'DEAD';
    const isReward = next === 'REWARD';

    setHidden(refs.mainMenu, !isMenu);
    setHidden(refs.hudLayer, !isPlaying);
    setHidden(refs.deathScreen, !isDead);
    setHidden(refs.rewardScreen, !isReward);

    if (!isLoading) cancelLoading();
    if (refs.loadingScreen) {
      refs.loadingScreen.hidden = !isLoading;
      if (isLoading) {
        refs.loadingScreen.classList.remove('is-fading');
        const game = global.ForestGame;
        const levelId = loadingLevelId ||
          (game && game.pendingLayerId) ||
          ((game && game.currentLevelId ? game.currentLevelId + 1 : 2));
        if (refs.loadingText) refs.loadingText.textContent = loadingLayerText(levelId);
        setLoadingDiary(levelId);
      }
    }

    if (isDead) {
      if (refs.overlayTitle) refs.overlayTitle.textContent = '你死了';
      if (refs.overlayHint) {
        refs.overlayHint.textContent = '塔不会记住失败。站起来，再走一次。';
      }
    }

    if (isReward) configureReward();
    if (isPlaying) updateHud();
  }

  function startLoadingTransition(levelId, onDone) {
    const game = global.ForestGame;
    if (
      !game ||
      global.currentGameState !== 'LOADING' ||
      !game.pendingLayerId
    ) {
      if (typeof onDone === 'function') onDone();
      return;
    }

    cancelLoading();
    loadingLevelId = levelId;
    loadingDone = typeof onDone === 'function' ? onDone : null;

    if (refs.loadingText) refs.loadingText.textContent = loadingLayerText(levelId);
    setLoadingDiary(levelId);
    if (refs.loadingScreen) {
      refs.loadingScreen.hidden = false;
      refs.loadingScreen.classList.remove('is-fading');
    }

    loadingTimer = window.setTimeout(() => {
      loadingTimer = 0;
      if (global.currentGameState !== 'LOADING') return;
      if (refs.loadingScreen) refs.loadingScreen.classList.add('is-fading');

      fadeTimer = window.setTimeout(() => {
        fadeTimer = 0;
        if (global.currentGameState !== 'LOADING') return;
        if (refs.loadingScreen) refs.loadingScreen.hidden = true;
        const done = loadingDone;
        loadingDone = null;
        if (done) done();
      }, 500);
    }, 1500);
  }

  function updateHud() {
    const game = global.ForestGame;
    if (!game || !game.player) return;

    const player = game.player;
    const hp = Math.max(0, Math.ceil(player.hp));
    const maxHp = Math.max(1, Math.ceil(player.maxHp));

    if (refs.hpText) {
      refs.hpText.textContent = `${hp}/${maxHp}`;
      refs.hpText.classList.toggle('is-low', hp / maxHp <= 0.3);
    }

    if (refs.rollStatus) {
      const maxCharges = player.rollMaxCharges || 1;
      const charges = Math.max(0, player.rollCharges || 0);
      const cooling = charges <= 0 || player.rolling || player.rollTimer > 0;
      refs.rollStatus.textContent = maxCharges > 1
        ? `${charges} / ${maxCharges}`
        : (cooling ? '冷却中' : '就绪');
      refs.rollStatus.classList.toggle('is-ready', charges > 0);
      refs.rollStatus.classList.toggle('is-cooldown', charges <= 0);
    }

    if (refs.meteorHud && refs.meteorStatus) {
      const meteorLevel = game.divine ? game.divine.meteorLevel : 0;
      refs.meteorHud.hidden = meteorLevel <= 0;
      if (meteorLevel > 0) {
        const cooling = game.meteorCooldown > 0;
        refs.meteorStatus.textContent = cooling
          ? `${game.meteorCooldown.toFixed(1)}s`
          : '就绪';
        refs.meteorStatus.classList.toggle('is-ready', !cooling);
        refs.meteorStatus.classList.toggle('is-cooldown', cooling);
      }
    }

    if (refs.hudPotion && refs.potionCount) {
      const charges = Math.max(0, player.potionCharges || 0);
      refs.potionCount.textContent = String(charges);
      refs.hudPotion.classList.toggle('is-empty', charges <= 0);
      refs.hudPotion.title = charges > 0
        ? 'Q：回复 3 HP（本房间可用 1 次）'
        : '本房间药水已用完，进入下一个房间后刷新';
    }

    const isColdLevel = game.currentLevelId === 4;
    if (refs.coldHud) {
      refs.coldHud.hidden = !isColdLevel;
      if (isColdLevel) {
        const cold = Math.max(0, Math.min(100, player.cold || 0));
        if (refs.coldFill) refs.coldFill.style.width = `${cold}%`;
        if (refs.coldText) refs.coldText.textContent = `${Math.round(cold)}/100`;
        refs.coldHud.classList.toggle('is-freezing', cold >= 100);
      }
    }
    if (refs.frostOverlay) {
      const showFrost = isColdLevel &&
        global.currentGameState === 'PLAYING' &&
        (player.cold || 0) > 50 &&
        !player.isWarming;
      refs.frostOverlay.hidden = !showFrost;
    }

    if (refs.floorLabel) {
      refs.floorLabel.textContent = `第 ${game.currentLevelId || 1} 层`;
    }

    if (refs.roomProgress) {
      const rooms = game.levelRooms || [];
      const total = Math.max(1, rooms.length);
      const index = Math.min(total, Math.max(1, (game.currentRoomIndex || 0) + 1));
      refs.roomProgress.textContent = `房间 ${index} / ${total}`;
    }
  }

  function bindButtons() {
    if (refs.startGameBtn) {
      refs.startGameBtn.addEventListener('click', () => {
        const game = global.ForestGame;
        if (!game || typeof game.startFromMenu !== 'function') return;
        refs.startGameBtn.blur();
        game.startFromMenu();
      });
    }

    if (refs.retryBtn) {
      refs.retryBtn.addEventListener('click', () => {
        const game = global.ForestGame;
        if (!game) return;
        refs.retryBtn.blur();
        game.reset();
      });
    }

    if (refs.rewardRestart) {
      refs.rewardRestart.addEventListener('click', () => {
        const game = global.ForestGame;
        if (!game) return;
        refs.rewardRestart.blur();
        game.reset();
      });
    }
  }

  const UI = {
    switchUI,
    startLoadingTransition,
    cancelLoading,
    updateHud
  };

  PF.UI = UI;
  global.switchUI = switchUI;
  global.UI = UI;

  bindButtons();
  switchUI(global.currentGameState || 'MENU');
  updateHud();

  function frame() {
    updateHud();
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);
})(window);
