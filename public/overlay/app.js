const CARD_W = 112;
const CARD_GAP = 10;
const COLORS = ['#146c49', '#1f8f5a', '#0d4a32', '#2bbf78', '#0a3826', '#178a58'];
const OVERLAY_MODE = document.body?.dataset?.overlay || 'both';
const HAS_HUD = OVERLAY_MODE === 'both' || OVERLAY_MODE === 'hud';
const HAS_ROULETTE = OVERLAY_MODE === 'both' || OVERLAY_MODE === 'roulette';

let state = null;
let spinning = false;
let hideTimer = null;
let nextTimer = null;
/** Смещение stage по Y для въезда/выезда (px), чтобы applyLayout не сбрасывал анимацию */
let stageEnterOffsetY = 0;
let stageMotionToken = 0;
const pendingSpins = [];

const audioCtx = (() => {
  try {
    return new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return null;
  }
})();

function soundVolume() {
  return Math.max(0, Math.min(1, (Number(state?.settings?.soundVolume) ?? 70) / 100));
}

function soundPackName() {
  return state?.settings?.soundPack || 'classic';
}

function customSoundUrl() {
  return String(state?.settings?.soundCustomUrl || '').trim();
}

function usesCustomSound() {
  return soundPackName() === 'custom' && Boolean(customSoundUrl());
}

let spinAudio = null;

function stopSpinAudio() {
  if (!spinAudio) return;
  try {
    spinAudio.pause();
    spinAudio.currentTime = 0;
  } catch {
    /* ignore */
  }
  spinAudio = null;
}

function playCustomSpinSound() {
  if (!state?.settings?.soundEnabled) return;
  stopSpinAudio();
  const url = customSoundUrl();
  if (!url) return;
  const audio = new Audio(url);
  audio.volume = soundVolume();
  spinAudio = audio;
  audio.play().catch(() => {
    /* ignore autoplay errors */
  });
}

function beep(freq, dur, type = 'sine', gain = 0.04, { force = false } = {}) {
  if (!audioCtx || !state?.settings?.soundEnabled) return;
  if (!force && usesCustomSound()) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain * soundVolume();
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start();
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  o.stop(audioCtx.currentTime + dur);
}

function playSpinStartSound() {
  if (usesCustomSound()) {
    playCustomSpinSound();
    return;
  }
  const pack = soundPackName();
  if (pack === 'soft') beep(280, 0.1, 'sine', 0.03);
  else if (pack === 'arcade') beep(160, 0.07, 'square', 0.028);
  else if (pack === 'bell') beep(660, 0.12, 'triangle', 0.03);
  else beep(220, 0.08, 'triangle', 0.03);
}

function playTickSound(progress) {
  if (usesCustomSound()) return;
  const pack = soundPackName();
  const e = Math.max(0, Math.min(1, progress));
  if (pack === 'soft') beep(240 + e * 180, 0.035, 'sine', 0.014);
  else if (pack === 'arcade') beep(140 + e * 520, 0.03, 'square', 0.02);
  else if (pack === 'bell') beep(520 + e * 400, 0.04, 'triangle', 0.016);
  else beep(200 + e * 380, 0.025, 'square', 0.018);
}

function playWinSound() {
  if (usesCustomSound()) return;
  const pack = soundPackName();
  if (pack === 'soft') {
    beep(420, 0.22, 'sine', 0.045);
    setTimeout(() => beep(560, 0.28, 'triangle', 0.04), 140);
  } else if (pack === 'arcade') {
    beep(520, 0.1, 'square', 0.035);
    setTimeout(() => beep(780, 0.12, 'sawtooth', 0.03), 90);
    setTimeout(() => beep(1040, 0.2, 'square', 0.028), 200);
  } else if (pack === 'bell') {
    beep(880, 0.4, 'sine', 0.045);
    setTimeout(() => beep(1320, 0.45, 'sine', 0.028), 30);
    setTimeout(() => beep(660, 0.55, 'triangle', 0.03), 180);
  } else {
    beep(520, 0.2, 'sine', 0.05);
    setTimeout(() => beep(660, 0.25, 'sine', 0.05), 120);
  }
}

function playDonateSound() {
  const pack = usesCustomSound() ? 'classic' : soundPackName();
  if (pack === 'soft') beep(360, 0.08, 'sine', 0.03, { force: true });
  else if (pack === 'arcade') beep(300, 0.06, 'square', 0.028, { force: true });
  else if (pack === 'bell') beep(990, 0.12, 'sine', 0.03, { force: true });
  else beep(380, 0.07, 'sine', 0.035, { force: true });
}

function cardStride() {
  const track = document.getElementById('stripTrack');
  const card = track?.children?.[0];
  if (card) return card.offsetWidth + CARD_GAP;
  return CARD_W + CARD_GAP;
}

function money(n) {
  const v = Number(n) || 0;
  const rounded = Math.round(v * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded} ₽` : `${rounded.toFixed(2)} ₽`;
}

function fmtProgress(progress, threshold) {
  const p = Math.round((Number(progress) || 0) * 100) / 100;
  const t = Math.round((Number(threshold) || 0) * 100) / 100;
  const ps = Number.isInteger(p) ? String(p) : p.toFixed(2);
  const ts = Number.isInteger(t) ? String(t) : t.toFixed(2);
  return `${ps} / ${ts} ₽`;
}

function fmtReset(ms) {
  if (ms == null) return '—';
  const sec = Math.ceil(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function defaultLayout() {
  // toastX/toastY — смещение уведомления в px относительно блока порога
  if (OVERLAY_MODE === 'hud') {
    return {
      hudX: 8,
      hudY: 18,
      hudScale: 1.15,
      hudWidth: 260,
      hudHeight: 0,
      stripX: 50,
      stripY: 48,
      stripScale: 1,
      stripWidth: 820,
      stripHeight: 140,
      toastX: 0,
      toastY: -40
    };
  }
  if (OVERLAY_MODE === 'roulette') {
    return {
      hudX: 2,
      hudY: 78,
      hudScale: 1,
      hudWidth: 240,
      hudHeight: 0,
      stripX: 50,
      stripY: 50,
      stripScale: 1,
      stripWidth: 820,
      stripHeight: 140,
      toastX: 0,
      toastY: -40
    };
  }
  return {
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
}

function applyLayout(settings) {
  const layout = { ...defaultLayout(), ...(settings?.layout || {}) };
  const group = document.getElementById('hudGroup');
  const hud = document.getElementById('hud');
  const stage = document.getElementById('stage');
  const toast = document.getElementById('toast');
  const banner = document.getElementById('editBanner');
  const edit = Boolean(settings?.layoutEditMode);

  if (HAS_HUD && (group || hud)) {
    const host = group || hud;
    host.style.left = `${layout.hudX}%`;
    host.style.top = `${layout.hudY}%`;
    host.style.bottom = 'auto';
    host.style.transform = `scale(${layout.hudScale})`;
  }

  if (hud && HAS_HUD) {
    hud.style.width = `${layout.hudWidth}px`;
    if (layout.hudHeight && layout.hudHeight > 0) {
      hud.style.minHeight = `${layout.hudHeight}px`;
      hud.style.height = `${layout.hudHeight}px`;
    } else {
      hud.style.minHeight = '';
      hud.style.height = '';
    }
    hud.classList.toggle('edit-target', edit);
  }

  if (stage && HAS_ROULETTE) {
    stage.style.left = `${layout.stripX}%`;
    stage.style.top = `${layout.stripY}%`;
    stage.style.width = `${layout.stripWidth}px`;
    applyStageTransform(stage, layout.stripScale);
    const stripH = layout.stripHeight || 140;
    stage.style.setProperty('--card-h', `${stripH}px`);
    // ширина карточки чуть пропорциональна длине, чтобы не ломать пропорции
    const cardW = Math.round(Math.min(160, Math.max(72, stripH * 0.8)));
    stage.style.setProperty('--card-w', `${cardW}px`);
    stage.classList.toggle('edit-target', edit);
    stage.classList.toggle('edit-visible', edit);
  }

  if (toast && HAS_HUD) {
    toast.style.left = `${layout.toastX ?? 0}px`;
    toast.style.top = `${layout.toastY ?? -40}px`;
    toast.style.transform = 'none';
    toast.classList.toggle('edit-target', edit);
    if (edit) {
      if (!toast.textContent.trim() || toast.dataset.preview === '1') {
        toast.textContent = toast.dataset.lastText || '+50 ₽ от Тест';
        toast.dataset.preview = '1';
      }
      toast.classList.remove('hidden');
      clearTimeout(toast._t);
    } else if (toast.dataset.preview === '1') {
      toast.classList.add('hidden');
      delete toast.dataset.preview;
    }
  }

  if (!banner) return;

  // В отдельном окне порога баннер не нужен — инструкция уже в админке
  if (OVERLAY_MODE === 'hud') {
    banner.classList.add('hidden');
    return;
  }

  if (edit) {
    banner.classList.remove('hidden');
    if (HAS_ROULETTE && stage) {
      stage.classList.remove('hidden');
      const track = document.getElementById('stripTrack');
      if (track && !spinning && !track.children.length) {
        track.innerHTML = cardHtml({ text: 'Превью', spoiler: '', _win: false }, 0);
      }
    }
  } else {
    banner.classList.add('hidden');
    if (HAS_ROULETTE && stage && !spinning && pendingSpins.length === 0) {
      const track = document.getElementById('stripTrack');
      const showingResult = track?.querySelector('[data-win="1"].winner');
      if (!showingResult) {
        stage.classList.add('hidden');
        if (track) track.innerHTML = '';
      }
    }
  }
}

function updateHud(s) {
  state = s;
  const { economy } = s;

  if (HAS_HUD) {
    const shownProgress = economy.displayProgress ?? economy.progress;
    const pct = economy.currentThreshold
      ? Math.min(100, (shownProgress / economy.currentThreshold) * 100)
      : 0;
    const progressEl = document.getElementById('hudProgress');
    const barEl = document.getElementById('hudBar');
    const thrEl = document.getElementById('hudThreshold');
    const resetEl = document.getElementById('hudReset');
    if (progressEl) {
      progressEl.textContent = fmtProgress(shownProgress, economy.currentThreshold);
    }
    if (barEl) barEl.style.width = `${pct}%`;
    if (thrEl) thrEl.textContent = money(economy.currentThreshold);
    if (resetEl) resetEl.textContent = fmtReset(s.msUntilReset);
  }

  applyLayout(s.settings);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pickWeighted(tasks) {
  const active = tasks.filter((t) => t && t.text && Number(t.weight) > 0);
  if (!active.length) return null;
  const total = active.reduce((s, t) => s + Number(t.weight), 0);
  let r = Math.random() * total;
  for (const t of active) {
    r -= Number(t.weight);
    if (r <= 0) return t;
  }
  return active[active.length - 1];
}

function buildStrip(tasks, winner, count = 48) {
  const list = [];
  const winIndex = count - 8;
  for (let i = 0; i < count; i++) {
    if (i === winIndex) {
      list.push({ ...winner, _win: true });
    } else {
      const t = pickWeighted(tasks) || winner;
      list.push({ ...t, _win: false });
    }
  }
  return { list, winIndex };
}

function cardHtml(task, colorIndex) {
  const spoiler = (task.spoiler || '').trim();
  const hasSpoiler = Boolean(spoiler);
  const bg = hasSpoiler
    ? `style="background-image:url('${escapeHtml(spoiler)}')"`
    : `style="background:${COLORS[colorIndex % COLORS.length]}"`;
  const cls = hasSpoiler ? 'card' : 'card no-spoiler';
  return `
    <div class="${cls}" data-win="${task._win ? '1' : '0'}">
      <div class="card-face card-spoiler" ${bg}><span class="q">?</span></div>
      <div class="card-face card-text">${escapeHtml(task.text)}</div>
    </div>`;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function stripScale() {
  return Number(state?.settings?.layout?.stripScale) || 1;
}

function stripEnterDirection() {
  return state?.settings?.stripEnterDirection === 'down' ? 'down' : 'up';
}

function enterTravelPx() {
  return Math.round(Math.max(420, window.innerHeight * 0.9));
}

function applyStageTransform(stage, scale = stripScale()) {
  if (!stage) return;
  stage.style.transform = `translate(-50%, calc(-50% + ${stageEnterOffsetY}px)) scale(${scale})`;
}

function waitTransition(el, property, fallbackMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (e) => {
      if (e.target !== el) return;
      if (property && e.propertyName !== property) return;
      finish();
    };
    el.addEventListener('transitionend', onEnd);
    setTimeout(finish, fallbackMs);
  });
}

/** Въезд: снизу вверх (up) или сверху вниз (down). Пропускается, если stage уже на экране. */
async function runStageEnter(stage, needsEnter) {
  const token = ++stageMotionToken;
  const scale = stripScale();
  if (!needsEnter) {
    stage.classList.remove('hidden');
    stageEnterOffsetY = 0;
    stage.style.opacity = '';
    stage.style.transition = '';
    applyStageTransform(stage, scale);
    return;
  }

  const travel = enterTravelPx();
  const fromY = stripEnterDirection() === 'down' ? -travel : travel;

  stageEnterOffsetY = fromY;
  stage.style.transition = 'none';
  stage.style.opacity = '0';
  applyStageTransform(stage, scale);
  stage.classList.remove('hidden');

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (token !== stageMotionToken) return;

  stage.style.transition =
    'transform 0.75s cubic-bezier(0.22, 1.08, 0.36, 1), opacity 0.45s ease';
  stageEnterOffsetY = 0;
  applyStageTransform(stage, scale);
  stage.style.opacity = '1';

  await waitTransition(stage, 'transform', 850);
  if (token !== stageMotionToken) return;
  stage.style.transition = '';
  stage.style.opacity = '';
}

/** Выезд обратно туда, откуда приехала */
async function runStageExit(stage) {
  if (!stage || stage.classList.contains('hidden')) return;
  const token = ++stageMotionToken;
  const scale = stripScale();
  const travel = enterTravelPx();
  const toY = stripEnterDirection() === 'down' ? -travel : travel;

  stage.style.transition =
    'transform 0.55s cubic-bezier(0.45, 0, 0.7, 0.25), opacity 0.4s ease';
  stageEnterOffsetY = toY;
  applyStageTransform(stage, scale);
  stage.style.opacity = '0';

  await waitTransition(stage, 'transform', 650);
  if (token !== stageMotionToken) return;
  stage.classList.add('hidden');
  stage.style.transition = '';
  stage.style.opacity = '';
  stageEnterOffsetY = 0;
  applyStageTransform(stage, scale);
}

function queueSpin(spin) {
  if (!HAS_ROULETTE) return;
  pendingSpins.push(spin);
  pumpSpins();
}

function pumpSpins() {
  if (spinning || pendingSpins.length === 0) return;
  const spin = pendingSpins.shift();
  playSpin(spin);
}

async function playSpin(spin) {
  spinning = true;
  clearTimeout(hideTimer);
  clearTimeout(nextTimer);

  const stage = document.getElementById('stage');
  const result = document.getElementById('result');
  const track = document.getElementById('stripTrack');
  const needsEnter =
    stage.classList.contains('hidden') || Math.abs(stageEnterOffsetY) > 1;
  result.classList.add('hidden');

  const tasks = spin.tasksSnapshot?.length ? spin.tasksSnapshot : state?.tasks || [];
  const winner = spin.task;
  const { list, winIndex } = buildStrip(tasks, winner);

  track.style.transition = 'none';
  track.style.transform = 'translate3d(0,0,0)';
  track.innerHTML = list.map((t, i) => cardHtml(t, i)).join('');

  await runStageEnter(stage, needsEnter);

  // Считаем по реальной геометрии карточки (border/gap), иначе указатель попадает на соседнюю
  const viewport = track.parentElement;
  const winEl = track.children[winIndex];
  const viewportW = viewport.clientWidth;
  const cardCenter = winEl.offsetLeft + winEl.offsetWidth / 2;
  const targetX = viewportW / 2 - cardCenter;
  // Лёгкий джиттер только внутри выигрышной карточки, не уводя на соседнюю
  const maxJitter = Math.max(4, winEl.offsetWidth * 0.12);
  const jitter = (Math.random() - 0.5) * 2 * maxJitter;
  const finalX = targetX + jitter;

  playSpinStartSound();

  const duration = 6800;
  const start = performance.now();
  let lastTickSlot = -1;

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const e = easeOutCubic(t);
    const x = finalX * e;
    track.style.transform = `translate3d(${x}px, 0, 0)`;

    const stride = cardStride();
    const slot = Math.floor(Math.abs(x) / stride);
    if (slot !== lastTickSlot) {
      lastTickSlot = slot;
      playTickSound(e);
    }

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      track.style.transform = `translate3d(${finalX}px, 0, 0)`;
      const winCard = track.querySelector('[data-win="1"]');
      if (winCard) {
        winCard.classList.add('winner', 'revealed');
      }
      const viewerEl = document.getElementById('resultViewer');
      const viewerName =
        spin.donation?.username ||
        (spin.donation?.source === 'manual' ? 'Стример' : null) ||
        'Зритель';
      if (viewerEl) viewerEl.textContent = viewerName;
      document.getElementById('resultText').textContent = winner.text;
      result.classList.remove('hidden');
      playWinSound();

      spinning = false;
      // свой файл может играть дольше крутки — не обрываем резко, только если уже кончился спин-чейн
      if (pendingSpins.length === 0) {
        setTimeout(() => {
          if (!spinning && pendingSpins.length === 0) stopSpinAudio();
        }, 500);
      }

      if (pendingSpins.length > 0) {
        const pauseMs = Math.max(
          0,
          Number(state?.settings?.pauseBetweenSpinsMs ?? 2500)
        );
        nextTimer = setTimeout(() => pumpSpins(), pauseMs);
      } else {
        hideTimer = setTimeout(async () => {
          if (state?.settings?.layoutEditMode) return;
          result.classList.add('hidden');
          await runStageExit(stage);
          track.innerHTML = '';
        }, 4200);
      }
    }
  }

  requestAnimationFrame(() => requestAnimationFrame(frame));
}

function showToast(text) {
  const el = document.getElementById('toast');
  if (!el || !HAS_HUD) return;
  el.dataset.lastText = text;
  delete el.dataset.preview;
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  if (state?.settings?.layoutEditMode) return;
  el._t = setTimeout(() => el.classList.add('hidden'), 2800);
}

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onclose = () => setTimeout(connectWs, 1500);
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    // После перезапуска приложения OBS сам подтянет новый HTML/JS/CSS
    if (msg.type === 'hello' && msg.payload?.sessionId) {
      const sid = String(msg.payload.sessionId);
      const prev = sessionStorage.getItem('rouletteSessionId');
      if (prev && prev !== sid) {
        sessionStorage.setItem('rouletteSessionId', sid);
        location.reload();
        return;
      }
      sessionStorage.setItem('rouletteSessionId', sid);
    }
    if (msg.type === 'state') updateHud(msg.payload);
    if (msg.type === 'spin' && HAS_ROULETTE) queueSpin(msg.payload);
    if (msg.type === 'donation' && HAS_HUD) {
      const d = msg.payload;
      showToast(`+${Math.round(d.amount)} ₽ от ${d.username}`);
      playDonateSound();
    }
    if (msg.type === 'reset' && HAS_HUD) {
      const reason = msg.payload.reason === 'decay' ? 'Снижение' : 'Сброс';
      showToast(`${reason} порога → ${Math.round(msg.payload.threshold)} ₽`);
    }
    if (msg.type === 'error') {
      showToast(msg.payload.message || 'Ошибка');
    }
  };
}

fetch('/api/state')
  .then((r) => r.json())
  .then(updateHud)
  .catch(console.error);

connectWs();

setInterval(() => {
  if (!HAS_HUD) return;
  if (!state?.economy?.lastDonationAt || !state?.settings?.resetMinutes) return;
  const resetEl = document.getElementById('hudReset');
  if (!resetEl) return;
  if (state.economy.currentThreshold <= state.settings.baseThreshold) {
    resetEl.textContent = '—';
    return;
  }
  const deadline =
    state.economy.lastDonationAt + state.settings.resetMinutes * 60 * 1000;
  state.msUntilReset = Math.max(0, deadline - Date.now());
  resetEl.textContent = fmtReset(state.msUntilReset);
}, 1000);

document.body.addEventListener(
  'click',
  () => {
    if (audioCtx?.state === 'suspended') audioCtx.resume();
  },
  { once: true }
);

let drag = null;
let saveLayoutTimer = null;

function scheduleSaveLayout(layout) {
  clearTimeout(saveLayoutTimer);
  saveLayoutTimer = setTimeout(() => {
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout })
    }).catch(console.error);
  }, 250);
}

function startDrag(kind, ev) {
  if (!state?.settings?.layoutEditMode) return;
  if (kind === 'hud' && !HAS_HUD) return;
  if (kind === 'strip' && !HAS_ROULETTE) return;
  if (kind === 'toast' && !HAS_HUD) return;
  ev.preventDefault();
  const layout = { ...defaultLayout(), ...(state.settings.layout || {}) };
  drag = {
    kind,
    startX: ev.clientX,
    startY: ev.clientY,
    origin: { ...layout }
  };
}

function onPointerMove(ev) {
  if (!drag || !state?.settings?.layoutEditMode) return;
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  const layout = { ...drag.origin };
  if (drag.kind === 'hud') {
    const dx = ((ev.clientX - drag.startX) / w) * 100;
    const dy = ((ev.clientY - drag.startY) / h) * 100;
    layout.hudX = Math.min(95, Math.max(0, drag.origin.hudX + dx));
    layout.hudY = Math.min(95, Math.max(0, drag.origin.hudY + dy));
  } else if (drag.kind === 'toast') {
    const scale = Math.max(0.4, Number(drag.origin.hudScale) || 1);
    const dx = (ev.clientX - drag.startX) / scale;
    const dy = (ev.clientY - drag.startY) / scale;
    const ox = drag.origin.toastX ?? 0;
    const oy = drag.origin.toastY ?? -40;
    layout.toastX = Math.min(400, Math.max(-200, ox + dx));
    layout.toastY = Math.min(400, Math.max(-200, oy + dy));
  } else {
    const dx = ((ev.clientX - drag.startX) / w) * 100;
    const dy = ((ev.clientY - drag.startY) / h) * 100;
    layout.stripX = Math.min(100, Math.max(0, drag.origin.stripX + dx));
    layout.stripY = Math.min(100, Math.max(0, drag.origin.stripY + dy));
  }
  state.settings.layout = layout;
  applyLayout(state.settings);
}

function onPointerUp() {
  if (!drag) return;
  const layout = state.settings.layout;
  drag = null;
  scheduleSaveLayout(layout);
}

document.getElementById('hud')?.addEventListener('pointerdown', (e) => startDrag('hud', e));
document.getElementById('stage')?.addEventListener('pointerdown', (e) => startDrag('strip', e));
document.getElementById('toast')?.addEventListener('pointerdown', (e) => startDrag('toast', e));
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);

window.addEventListener(
  'wheel',
  (ev) => {
    if (!state?.settings?.layoutEditMode) return;
    const t = ev.target.closest('#hud, #stage');
    if (!t) return;
    if (t.id === 'hud' && !HAS_HUD) return;
    if (t.id === 'stage' && !HAS_ROULETTE) return;
    ev.preventDefault();
    const layout = { ...defaultLayout(), ...(state.settings.layout || {}) };
    const delta = ev.deltaY > 0 ? -0.05 : 0.05;
    if (t.id === 'hud') {
      layout.hudScale = Math.min(3, Math.max(0.4, layout.hudScale + delta));
    } else {
      layout.stripScale = Math.min(2.5, Math.max(0.4, layout.stripScale + delta));
    }
    state.settings.layout = layout;
    applyLayout(state.settings);
    scheduleSaveLayout(layout);
  },
  { passive: false }
);
