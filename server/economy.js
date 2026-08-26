/**
 * Экономика рулетки:
 * - донаты копятся до currentThreshold
 * - при достижении — spin, порог += step
 * - без донатов: каждые resetMinutes порог падает на step (не ниже базы)
 */

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pickWeightedTask(tasks) {
  const active = (tasks || []).filter((t) => t && t.text && Number(t.weight) > 0);
  if (!active.length) return null;
  const total = active.reduce((s, t) => s + Number(t.weight), 0);
  let r = Math.random() * total;
  for (const task of active) {
    r -= Number(task.weight);
    if (r <= 0) return task;
  }
  return active[active.length - 1];
}

function createEconomy(getState, setState, emit) {
  let spinning = false;
  let spinQueue = [];
  let spinChainActive = false;
  let resetTimer = null;

  function snapshot() {
    const state = getState();
    const { progress, currentThreshold } = state.economy;
    return {
      settings: state.settings,
      economy: {
        ...state.economy,
        displayProgress: progressForDisplay(progress, currentThreshold)
      },
      tasks: state.tasks,
      recentDonations: state.recentDonations.slice(0, 20),
      recentSpins: state.recentSpins.slice(0, 20),
      spinning,
      queueLength: spinQueue.length,
      acceptingDonations: state.settings.acceptingDonations,
      msUntilReset: getMsUntilReset()
    };
  }

  function getMsUntilReset() {
    const state = getState();
    const { resetMinutes } = state.settings;
    const { lastDonationAt, currentThreshold } = state.economy;
    const { baseThreshold } = state.settings;
    if (!lastDonationAt || !resetMinutes) return null;
    // Таймер снижения только пока порог выше базы
    if (currentThreshold <= baseThreshold) return null;
    const deadline = lastDonationAt + resetMinutes * 60 * 1000;
    return Math.max(0, deadline - Date.now());
  }

  function broadcast() {
    emit('state', snapshot());
  }

  function scheduleResetCheck() {
    if (resetTimer) clearTimeout(resetTimer);
    const ms = getMsUntilReset();
    if (ms == null) return;
    resetTimer = setTimeout(() => {
      checkAutoDecay();
    }, Math.min(ms + 50, 60_000));
  }

  /** Постепенное снижение порога на step, а не обнуление до базы */
  function checkAutoDecay() {
    const state = getState();
    const { resetMinutes, baseThreshold, step } = state.settings;
    const { lastDonationAt, currentThreshold } = state.economy;
    if (!lastDonationAt || !resetMinutes) {
      scheduleResetCheck();
      return;
    }
    if (currentThreshold <= baseThreshold) {
      scheduleResetCheck();
      return;
    }

    const elapsed = Date.now() - lastDonationAt;
    const period = resetMinutes * 60 * 1000;
    if (elapsed >= period) {
      const decayStep = Math.max(1, Number(step) || 0);
      const lowered = Math.max(baseThreshold, currentThreshold - decayStep);

      if (lowered !== currentThreshold) {
        state.economy.currentThreshold = lowered;
        state.economy.lastDonationAt = Date.now();
        if (state.economy.progress >= state.economy.currentThreshold) {
          state.economy.progress = Math.max(0, state.economy.currentThreshold - 1);
        }
        setState(state);
        emit('reset', {
          reason: 'decay',
          threshold: lowered
        });
        broadcast();
      }
    }
    scheduleResetCheck();
  }

  function consumeOneThreshold(state) {
    if (state.economy.progress < state.economy.currentThreshold) return null;
    const spent = state.economy.currentThreshold;
    state.economy.progress = roundMoney(state.economy.progress - spent);
    state.economy.currentThreshold = roundMoney(
      state.economy.currentThreshold + state.settings.step
    );
    return spent;
  }

  /** Ставит в очередь все крутки, пока прогресс покрывает порог */
  function drainProgressToQueue(donationMeta) {
    let queued = 0;

    while (true) {
      const state = getState();
      const spent = consumeOneThreshold(state);
      if (spent == null) break;
      setState(state);
      queued += 1;
      enqueueSpin({
        triggerAmount: spent,
        donation: donationMeta?.donation || null
      });
    }

    return queued;
  }

  function addDonation({ amount, username, message, source, externalId }) {
    const state = getState();

    if (externalId) {
      if (state.processedDonationIds.includes(String(externalId))) {
        return { ok: false, reason: 'duplicate' };
      }
      state.processedDonationIds.unshift(String(externalId));
      state.processedDonationIds = state.processedDonationIds.slice(0, 500);
    }

    if (
      !state.settings.acceptingDonations &&
      source !== 'test' &&
      source !== 'manual'
    ) {
      return { ok: false, reason: 'paused' };
    }

    const value = roundMoney(amount);
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, reason: 'invalid_amount' };
    }

    state.economy.progress = roundMoney(state.economy.progress + value);
    state.economy.lastDonationAt = Date.now();

    const entry = {
      id: externalId || `local_${Date.now()}`,
      amount: value,
      username: username || 'Аноним',
      message: message || '',
      source: source || 'test',
      at: Date.now()
    };
    state.recentDonations.unshift(entry);
    state.recentDonations = state.recentDonations.slice(0, 50);

    const spinsQueued = drainProgressToQueue({ donation: entry });

    setState(state);
    emit('donation', entry);
    broadcast();
    scheduleResetCheck();

    return { ok: true, entry, spinsQueued };
  }

  function enqueueSpin(meta = {}) {
    const state = getState();
    const task = pickWeightedTask(state.tasks);
    if (!task) {
      emit('error', { code: 'no_tasks', message: 'Нет заданий для крутки' });
      broadcast();
      return;
    }

    const spin = {
      id: `spin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      task: {
        id: task.id,
        text: task.text,
        weight: task.weight,
        spoiler: task.spoiler || ''
      },
      tasksSnapshot: state.tasks.map((t) => ({
        id: t.id,
        text: t.text,
        weight: t.weight,
        spoiler: t.spoiler || ''
      })),
      triggerAmount: meta.triggerAmount || state.economy.currentThreshold,
      donation: meta.donation || null,
      createdAt: Date.now()
    };

    spinQueue.push(spin);
    broadcast();
    processQueue();
  }

  async function processQueue() {
    if (spinning || spinQueue.length === 0) {
      if (spinQueue.length === 0) spinChainActive = false;
      return;
    }
    spinning = true;

    const stateBefore = getState();
    // Задержка только перед первой круткой после простоя (чтобы не наложиться на алерт доната)
    if (!spinChainActive) {
      const startDelay = Math.max(0, Number(stateBefore.settings.spinStartDelayMs) || 0);
      if (startDelay > 0) await sleep(startDelay);
      spinChainActive = true;
    }

    if (spinQueue.length === 0) {
      spinning = false;
      spinChainActive = false;
      broadcast();
      return;
    }

    const spin = spinQueue.shift();
    const state = getState();
    state.economy.lastSpinAt = Date.now();
    state.recentSpins.unshift({
      id: spin.id,
      taskText: spin.task.text,
      username: spin.donation?.username || null,
      at: Date.now()
    });
    state.recentSpins = state.recentSpins.slice(0, 50);
    setState(state);

    emit('spin', spin);
    broadcast();

    // Ждём окончания анимации ленты на оверлее (~6.8с), затем паузу между крутками
    const animationMs = 7200;
    await sleep(animationMs);

    spinning = false;
    broadcast();

    const pauseMs = Math.max(
      0,
      Number(getState().settings.pauseBetweenSpinsMs ?? 2500)
    );

    if (spinQueue.length === 0) {
      spinChainActive = false;
      drainProgressToQueue(null);
    } else if (pauseMs > 0) {
      await sleep(pauseMs);
    }
    processQueue();
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function clearLogs({ donations = false, spins = false } = {}) {
    const state = getState();
    if (donations) state.recentDonations = [];
    if (spins) state.recentSpins = [];
    setState(state);
    broadcast();
  }

  function resetThreshold(manual = true) {
    const state = getState();
    state.economy.currentThreshold = state.settings.baseThreshold;
    state.economy.progress = 0;
    if (manual) {
      state.economy.lastDonationAt = Date.now();
    }
    setState(state);
    emit('reset', {
      reason: manual ? 'manual' : 'inactivity',
      threshold: state.settings.baseThreshold
    });
    broadcast();
    scheduleResetCheck();
  }

  function updateSettings(patch) {
    const state = getState();
    const s = state.settings;
    if (patch.baseThreshold != null) s.baseThreshold = Math.max(1, Number(patch.baseThreshold));
    if (patch.step != null) s.step = Math.max(0, Number(patch.step));
    if (patch.resetMinutes != null) s.resetMinutes = Math.max(1, Number(patch.resetMinutes));
    if (patch.acceptingDonations != null) s.acceptingDonations = Boolean(patch.acceptingDonations);
    if (patch.pauseBetweenSpinsMs != null) {
      s.pauseBetweenSpinsMs = Math.max(0, Number(patch.pauseBetweenSpinsMs));
    }
    if (patch.spinStartDelayMs != null) {
      s.spinStartDelayMs = Math.max(0, Number(patch.spinStartDelayMs));
    }
    if (patch.stripEnterDirection != null) {
      const dir = String(patch.stripEnterDirection);
      s.stripEnterDirection = dir === 'down' ? 'down' : 'up';
    }
    if (patch.soundEnabled != null) s.soundEnabled = Boolean(patch.soundEnabled);
    if (patch.soundPack != null) {
      const pack = String(patch.soundPack);
      s.soundPack = ['classic', 'soft', 'arcade', 'bell', 'custom'].includes(pack)
        ? pack
        : 'classic';
    }
    if (patch.soundVolume != null) {
      s.soundVolume = Math.min(100, Math.max(0, Number(patch.soundVolume) || 0));
    }
    if (patch.soundCustomUrl != null) {
      s.soundCustomUrl = String(patch.soundCustomUrl || '').trim();
    }
    if (patch.layout && typeof patch.layout === 'object') {
      s.layout = { ...s.layout, ...normalizeLayout(patch.layout) };
    }
    if (patch.layoutEditMode != null) s.layoutEditMode = Boolean(patch.layoutEditMode);

    if (state.economy.currentThreshold < s.baseThreshold) {
      state.economy.currentThreshold = s.baseThreshold;
    }
    setState(state);
    broadcast();
    scheduleResetCheck();
  }

  function setTasks(tasks) {
    const state = getState();
    state.tasks = tasks;
    setState(state);
    broadcast();
  }

  function forceSpin() {
    const state = getState();
    if (!state.tasks.length) {
      emit('error', { code: 'no_tasks', message: 'Нет заданий для крутки' });
      return { ok: false, reason: 'no_tasks' };
    }
    enqueueSpin({ triggerAmount: 0, donation: { username: 'Ручной запуск', source: 'manual' } });
    return { ok: true };
  }

  setInterval(checkAutoDecay, 15_000);
  scheduleResetCheck();

  return {
    snapshot,
    addDonation,
    resetThreshold,
    updateSettings,
    setTasks,
    forceSpin,
    clearLogs,
    checkAutoDecay,
    broadcast
  };
}

module.exports = { createEconomy, pickWeightedTask, roundMoney, progressForDisplay };

function progressForDisplay(progress, threshold) {
  const t = roundMoney(threshold);
  const p = roundMoney(progress);
  if (t <= 0) return 0;
  if (p < t) return p;
  return roundMoney(p % t);
}

function normalizeLayout(layout) {
  const d = {
    hudX: 2,
    hudY: 78,
    hudScale: 1,
    hudWidth: 240,
    hudHeight: 0,
    stripX: 50,
    stripY: 48,
    stripScale: 1,
    stripWidth: 820,
    stripHeight: 140,
    toastX: 0,
    toastY: -40
  };
  const src = layout || {};
  const num = (v, fallback, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  // Старые сохранения: toast в % окна (0..100). Переводим в смещение у порога.
  let toastX = src.toastX;
  let toastY = src.toastY;
  if (
    toastX != null &&
    toastY != null &&
    Number(toastX) >= 0 &&
    Number(toastX) <= 100 &&
    Number(toastY) >= 0 &&
    Number(toastY) <= 100 &&
    src.toastRelative !== true
  ) {
    toastX = 0;
    toastY = -40;
  }
  return {
    hudX: num(src.hudX, d.hudX, 0, 100),
    hudY: num(src.hudY, d.hudY, 0, 100),
    hudScale: num(src.hudScale, d.hudScale, 0.4, 3),
    hudWidth: num(src.hudWidth, d.hudWidth, 120, 600),
    hudHeight: num(src.hudHeight, d.hudHeight, 0, 400),
    stripX: num(src.stripX, d.stripX, 0, 100),
    stripY: num(src.stripY, d.stripY, 0, 100),
    stripScale: num(src.stripScale, d.stripScale, 0.4, 2.5),
    stripWidth: num(src.stripWidth, d.stripWidth, 280, 1600),
    stripHeight: num(src.stripHeight, d.stripHeight, 80, 280),
    toastX: num(toastX, d.toastX, -200, 400),
    toastY: num(toastY, d.toastY, -200, 400),
    toastRelative: true
  };
}
