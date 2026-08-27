const $ = (sel) => document.querySelector(sel);

let state = null;

function fillLayoutInputs(settings) {
  const L = settings.layout || {};
  const set = (id, v) => {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = v;
  };
  set('#layoutHudScale', L.hudScale ?? 1);
  set('#layoutHudWidth', L.hudWidth ?? 240);
  set('#layoutHudHeight', L.hudHeight ?? 0);
  set('#layoutStripScale', L.stripScale ?? 1);
  set('#layoutStripWidth', L.stripWidth ?? 820);
  set('#layoutStripHeight', L.stripHeight ?? 140);
}

function readLayoutFromForm() {
  const current = state?.settings?.layout || {};
  return {
    ...current,
    hudScale: Number($('#layoutHudScale').value),
    hudWidth: Number($('#layoutHudWidth').value),
    hudHeight: Number($('#layoutHudHeight').value),
    stripScale: Number($('#layoutStripScale').value),
    stripWidth: Number($('#layoutStripWidth').value),
    stripHeight: Number($('#layoutStripHeight').value),
    toastRelative: true
  };
}

function money(n) {
  return `${Math.round(Number(n) || 0)} ₽`;
}

function fmtReset(ms) {
  if (ms == null) return '—';
  const sec = Math.ceil(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function applyState(s) {
  state = s;
  const { economy, settings, tasks, categories, recentDonations, recentSpins, queueLength, da, donatepay, donatex } = s;

  const shownProgress = economy.displayProgress ?? economy.progress;
  const pct = economy.currentThreshold
    ? Math.min(100, (shownProgress / economy.currentThreshold) * 100)
    : 0;
  $('#progressText').textContent = (() => {
    const p = Math.round((shownProgress || 0) * 100) / 100;
    const t = Math.round((economy.currentThreshold || 0) * 100) / 100;
    return `${p} / ${t} ₽`;
  })();
  $('#progressBar').style.width = `${pct}%`;
  $('#thresholdText').textContent = money(economy.currentThreshold);
  $('#resetText').textContent = fmtReset(s.msUntilReset);
  $('#queueText').textContent = String(queueLength || 0);

  if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'SELECT') {
    $('#baseThreshold').value = settings.baseThreshold;
    $('#step').value = settings.step;
    $('#resetMinutes').value = settings.resetMinutes;
    $('#pauseBetweenSpinsMs').value = settings.pauseBetweenSpinsMs;
    const delaySec = (Number(settings.spinStartDelayMs) || 0) / 1000;
    $('#spinStartDelaySec').value = Number.isInteger(delaySec) ? delaySec : Math.round(delaySec * 10) / 10;
    if ($('#stripEnterDirection')) {
      $('#stripEnterDirection').value =
        settings.stripEnterDirection === 'down' ? 'down' : 'up';
    }
    $('#soundEnabled').checked = !!settings.soundEnabled;
    if ($('#soundPack') && document.activeElement !== $('#soundPack')) {
      $('#soundPack').value = settings.soundPack || 'classic';
    }
    if ($('#soundVolume') && document.activeElement !== $('#soundVolume')) {
      $('#soundVolume').value = settings.soundVolume ?? 70;
    }
    if ($('#soundCustomUrl') && document.activeElement !== $('#soundCustomUrl')) {
      $('#soundCustomUrl').value = settings.soundCustomUrl || '';
    }
    updateCustomSoundUi();
    fillLayoutInputs(settings);
  }

  const editBtn = $('#toggleLayoutEdit');
  if (editBtn) {
    editBtn.textContent = settings.layoutEditMode ? 'Режим правки: ВКЛ' : 'Режим правки: ВЫКЛ';
    editBtn.classList.toggle('danger', !!settings.layoutEditMode);
  }

  const btn = $('#toggleAccept');
  btn.textContent = settings.acceptingDonations ? 'Приём: ВКЛ' : 'Приём: ВЫКЛ';
  btn.classList.toggle('primary', settings.acceptingDonations);

  applyIntegrationBadge('#daBadge', '#daStatusLine', da, 'DA');
  applyIntegrationBadge('#dpBadge', '#dpStatusLine', donatepay, 'DP');
  applyIntegrationBadge('#dxBadge', '#dxStatusLine', donatex, 'DX');
  updatePlatformMenuStatuses({ da, donatepay, donatex });
  syncPlatformModalAfterState();

  renderCategories(categories || []);
  renderLog('#donationLog', (recentDonations || []).map((d) => {
    const when = new Date(d.at).toLocaleTimeString('ru-RU');
    return `<li><strong>${money(d.amount)}</strong> — ${escapeHtml(d.username)} <em>(${escapeHtml(d.source)})</em> · ${when}</li>`;
  }));
  renderLog('#spinLog', (recentSpins || []).map((sp) => {
    const when = new Date(sp.at).toLocaleTimeString('ru-RU');
    const who = sp.username ? `${escapeHtml(sp.username)} → ` : '';
    return `<li>${who}<strong>${escapeHtml(sp.taskText)}</strong> · ${when}</li>`;
  }));
}

function applyIntegrationBadge(badgeSel, lineSel, status, label) {
  const badge = $(badgeSel);
  const line = $(lineSel);
  if (badge) {
    if (status?.connected) {
      badge.textContent = `${label}: online`;
      badge.className = 'badge ok';
      badge.title = status.channel || '';
    } else {
      badge.textContent = `${label}: ${status?.error ? 'off' : '…'}`;
      badge.className = 'badge warn';
      badge.title = status?.error || '';
    }
  }
  if (line) {
    line.textContent = status?.connected
      ? `Статус: online${status.channel ? ` · ${status.channel}` : ''}`
      : `Статус: ${status?.error || 'нет подключения'}`;
  }
}

function renderLog(sel, items) {
  $(sel).innerHTML = items.length ? items.join('') : '<li>Пока пусто</li>';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const RARITIES = [
  { id: 'common', label: 'Обычная', weight: 50 },
  { id: 'uncommon', label: 'Необычная', weight: 25 },
  { id: 'rare', label: 'Редкая', weight: 15 },
  { id: 'epic', label: 'Эпическая', weight: 7 },
  { id: 'legendary', label: 'Легендарная', weight: 3 }
];

function rarityWeight(id) {
  return RARITIES.find((r) => r.id === id)?.weight ?? 50;
}

function parseCardsClient(text) {
  return String(text || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function categoryDropChance(categories, categoryId) {
  const active = (categories || []).filter(
    (c) => c && c.enabled !== false && parseCardsClient(c.cardsText).length > 0
  );
  const total = active.reduce((s, c) => s + rarityWeight(c.rarity), 0);
  if (total <= 0) return 0;
  const cat = active.find((c) => c.id === categoryId);
  if (!cat) return 0;
  return Math.round((rarityWeight(cat.rarity) / total) * 1000) / 10;
}

function captureCategoryFocus() {
  const el = document.activeElement;
  const list = $('#categoryList');
  if (!el || !list?.contains(el)) return null;
  const card = el.closest('[data-id]');
  if (!card) return null;
  return {
    id: card.dataset.id,
    field: el.dataset.field || el.className,
    start: el.selectionStart,
    end: el.selectionEnd,
    tag: el.tagName
  };
}

function restoreCategoryFocus(focus) {
  if (!focus?.id) return;
  requestAnimationFrame(() => {
    const id =
      typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(focus.id)
        : focus.id.replace(/"/g, '\\"');
    const card = document.querySelector(`#categoryList [data-id="${id}"]`);
    if (!card) return;
    const el =
      (focus.field && card.querySelector(`[data-field="${focus.field}"]`)) ||
      card.querySelector('.category-title');
    if (!el) return;
    el.focus({ preventScroll: true });
    if (typeof focus.start === 'number' && typeof el.setSelectionRange === 'function') {
      try {
        const len = el.value?.length ?? 0;
        el.setSelectionRange(
          Math.min(focus.start, len),
          Math.min(focus.end ?? focus.start, len)
        );
      } catch {
        /* ignore */
      }
    }
  });
}

let lastCategoryIds = '';
const categoryExtraOpen = new Set();

function renderCategories(categories) {
  const list = $('#categoryList');
  if (!list) return;
  const focus = captureCategoryFocus();
  const items = categories || [];
  const ids = items.map((c) => c.id).join('\0');

  const updateChances = () => {
    items.forEach((c) => {
      const esc =
        typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(c.id) : c.id;
      const chanceEl = list.querySelector(
        `[data-id="${esc}"] .category-chance-value`
      );
      if (chanceEl) {
        chanceEl.textContent = `${categoryDropChance(items, c.id)}%`;
      }
      const card = list.querySelector(`[data-id="${esc}"]`);
      if (card) {
        card.classList.toggle('is-disabled', c.enabled === false);
        const toggle = card.querySelector('.cat-toggle');
        if (toggle) {
          toggle.classList.toggle('is-off', c.enabled === false);
          toggle.title =
            c.enabled === false ? 'Включить категорию' : 'Выключить категорию';
        }
      }
    });
  };

  // Пока печатают в категории — не пересобираем DOM
  if (focus && ids === lastCategoryIds && list.querySelector(`[data-id]`)) {
    updateChances();
    return;
  }
  lastCategoryIds = ids;

  if (!items.length) {
    list.innerHTML =
      '<p class="hint">Нет категорий — добавь хотя бы одну, иначе крутка не запустится.</p>';
    return;
  }

  const rarityOptions = RARITIES.map(
    (r) => `<option value="${r.id}">${r.label}</option>`
  ).join('');

  list.innerHTML = items
    .map((c) => {
      const chance = categoryDropChance(items, c.id);
      const enabled = c.enabled !== false;
      const extraOpen = categoryExtraOpen.has(c.id);
      return `
      <article class="category-card${!enabled ? ' is-disabled' : ''}" data-id="${escapeHtml(c.id)}">
        <div class="category-head">
          <input type="text" class="category-title" data-field="name" maxlength="80"
            value="${escapeHtml(c.name || 'Категория')}" title="Название категории" />
          <div class="category-actions">
            <button type="button" class="category-icon-btn cat-toggle${!enabled ? ' is-off' : ''}"
              title="${enabled ? 'Выключить категорию' : 'Включить категорию'}" aria-label="Видимость">
              <svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button type="button" class="category-icon-btn cat-gear" title="Дополнительно" aria-label="Настройки">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>
            </button>
            <button type="button" class="category-icon-btn danger cat-del" title="Удалить" aria-label="Удалить">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>
        </div>
        <div class="category-field">
          <label class="category-label">Карточки</label>
          <textarea class="category-cards" data-field="cardsText" rows="2"
            placeholder="Прыгнуть, Присесть, Выпить чаю">${escapeHtml(c.cardsText || '')}</textarea>
        </div>
        <div class="category-field">
          <label class="category-label">Редкость</label>
          <div class="category-rarity-wrap">
            <select class="category-rarity" data-field="rarity">${rarityOptions}</select>
          </div>
        </div>
        <div class="category-field">
          <label class="category-label">Шанс выпадения</label>
          <div class="category-chance">
            <span class="category-chance-value">${chance}%</span>
            <span class="category-chance-help" title="Считается от редкости среди включённых категорий с карточками">?</span>
          </div>
        </div>
        <div class="category-extra"${extraOpen ? '' : ' hidden'}>
          <div class="category-field">
            <label class="category-label">Спойлер (URL картинки на карточках)</label>
            <input type="text" class="category-spoiler" data-field="spoiler"
              value="${escapeHtml(c.spoiler || '')}" placeholder="Необязательно" />
          </div>
        </div>
      </article>`;
    })
    .join('');

  list.querySelectorAll('.category-card').forEach((card) => {
    const id = card.dataset.id;
    const cat = items.find((c) => c.id === id);
    const raritySel = card.querySelector('.category-rarity');
    if (raritySel && cat) raritySel.value = cat.rarity || 'common';

    const save = debounce(async () => {
      await api('PATCH', `/api/categories/${id}`, {
        name: card.querySelector('[data-field="name"]')?.value,
        cardsText: card.querySelector('[data-field="cardsText"]')?.value,
        rarity: card.querySelector('[data-field="rarity"]')?.value,
        spoiler: card.querySelector('[data-field="spoiler"]')?.value
      });
    }, 400);

    card.querySelectorAll('[data-field]').forEach((el) => {
      el.addEventListener('input', save);
      el.addEventListener('change', save);
    });

    card.querySelector('.cat-toggle')?.addEventListener('click', async () => {
      const live = (state?.categories || []).find((c) => c.id === id);
      const currentlyEnabled = live ? live.enabled !== false : !card.classList.contains('is-disabled');
      await api('PATCH', `/api/categories/${id}`, {
        enabled: !currentlyEnabled
      });
    });

    card.querySelector('.cat-gear')?.addEventListener('click', () => {
      if (categoryExtraOpen.has(id)) categoryExtraOpen.delete(id);
      else categoryExtraOpen.add(id);
      const extra = card.querySelector('.category-extra');
      if (extra) extra.hidden = !categoryExtraOpen.has(id);
    });

    card.querySelector('.cat-del')?.addEventListener('click', async () => {
      if (items.length <= 1) {
        alert('Нужна хотя бы одна категория.');
        return;
      }
      if (!confirm('Удалить категорию?')) return;
      await api('DELETE', `/api/categories/${id}`);
    });
  });

  restoreCategoryFocus(focus);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (data.state) applyState(data.state);
  else if (data.economy) applyState(data);
  else if (data.settings) applyState(data);
  return data;
}

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const badge = $('#wsBadge');

  ws.onopen = () => {
    badge.textContent = 'WS: ok';
    badge.className = 'badge ok';
    badge.title = 'WebSocket: связь админки с локальным сервером приложения';
  };
  ws.onclose = () => {
    badge.textContent = 'WS: reconnect…';
    badge.className = 'badge warn';
    setTimeout(connectWs, 1500);
  };
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
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
    if (msg.type === 'state') applyState(msg.payload);
    if (msg.type === 'da' && state) {
      applyState({ ...state, da: msg.payload });
    }
    if (msg.type === 'donatepay' && state) {
      applyState({ ...state, donatepay: msg.payload });
    }
    if (msg.type === 'donatex' && state) {
      applyState({ ...state, donatex: msg.payload });
    }
  };
}

$('#saveSettings').onclick = async () => {
  await api('POST', '/api/settings', {
    baseThreshold: Number($('#baseThreshold').value),
    step: Number($('#step').value),
    resetMinutes: Number($('#resetMinutes').value),
    pauseBetweenSpinsMs: Number($('#pauseBetweenSpinsMs').value),
    spinStartDelayMs: Math.round(Number($('#spinStartDelaySec').value) * 1000),
    stripEnterDirection: $('#stripEnterDirection')?.value === 'down' ? 'down' : 'up',
    soundEnabled: $('#soundEnabled').checked
  });
};

$('#pauseBetweenSpinsMs')?.addEventListener('change', async () => {
  await api('POST', '/api/settings', {
    pauseBetweenSpinsMs: Math.max(0, Number($('#pauseBetweenSpinsMs').value) || 0)
  });
});

$('#spinStartDelaySec')?.addEventListener('change', async () => {
  await api('POST', '/api/settings', {
    spinStartDelayMs: Math.max(0, Math.round(Number($('#spinStartDelaySec').value) * 1000) || 0)
  });
});

$('#stripEnterDirection')?.addEventListener('change', async () => {
  await api('POST', '/api/settings', {
    stripEnterDirection: $('#stripEnterDirection').value === 'down' ? 'down' : 'up'
  });
});

$('#soundEnabled').onchange = async () => {
  await api('POST', '/api/settings', { soundEnabled: $('#soundEnabled').checked });
};

function updateCustomSoundUi() {
  const pack = $('#soundPack')?.value || 'classic';
  const row = $('#customSoundRow');
  if (row) row.style.display = pack === 'custom' ? '' : 'none';
  const hint = $('#soundHint');
  if (hint) {
    hint.textContent =
      pack === 'custom'
        ? 'Загрузи mp3/wav/ogg и нажми «Применить звук». Файл играет при крутке.'
        : 'Выбери стандартный звук или «Свой файл», затем «Применить звук».';
  }
}

$('#soundPack')?.addEventListener('change', () => {
  updateCustomSoundUi();
});

async function applySoundSettings() {
  const pack = $('#soundPack')?.value || 'classic';
  const customUrl = $('#soundCustomUrl')?.value?.trim() || '';
  if (pack === 'custom' && !customUrl) {
    alert('Сначала загрузи свой аудиофайл.');
    return;
  }
  await api('POST', '/api/settings', {
    soundEnabled: $('#soundEnabled').checked,
    soundPack: pack,
    soundVolume: Number($('#soundVolume')?.value ?? 70),
    soundCustomUrl: customUrl
  });
  showToastNear('#soundHint', 'Звук применён');
}

$('#applySoundBtn')?.addEventListener('click', () => applySoundSettings());

$('#previewSoundBtn')?.addEventListener('click', () => {
  previewRouletteSound({
    soundEnabled: true,
    soundPack: $('#soundPack')?.value || 'classic',
    soundVolume: Number($('#soundVolume')?.value ?? 70),
    soundCustomUrl: $('#soundCustomUrl')?.value?.trim() || ''
  });
});

$('#soundCustomFile')?.addEventListener('change', async () => {
  const file = $('#soundCustomFile').files?.[0];
  if (!file) return;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const res = await api('POST', '/api/upload/sound', { dataUrl });
    if (res.error) throw new Error(res.error);
    if (res.url) {
      $('#soundCustomUrl').value = res.url;
      $('#soundPack').value = 'custom';
      updateCustomSoundUi();
      showToastNear('#soundHint', 'Файл загружен — нажми «Применить звук»');
    }
  } catch (err) {
    alert(String(err.message || err));
  } finally {
    $('#soundCustomFile').value = '';
  }
});

$('#clearCustomSoundBtn')?.addEventListener('click', () => {
  if ($('#soundCustomUrl')) $('#soundCustomUrl').value = '';
  if ($('#soundPack')?.value === 'custom') {
    $('#soundPack').value = 'classic';
  }
  updateCustomSoundUi();
});

let previewAudio = null;

function previewRouletteSound(settings) {
  const pack = settings.soundPack || 'classic';
  const vol = Math.max(0, Math.min(1, (Number(settings.soundVolume) || 70) / 100));

  if (previewAudio) {
    try {
      previewAudio.pause();
    } catch {
      /* ignore */
    }
    previewAudio = null;
  }

  if (pack === 'custom') {
    const url = settings.soundCustomUrl;
    if (!url) {
      alert('Сначала загрузи свой аудиофайл.');
      return;
    }
    const audio = new Audio(url);
    audio.volume = vol;
    previewAudio = audio;
    audio.play().catch((err) => alert(String(err.message || err)));
    return;
  }

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = (freq, dur, type, gain) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain * vol;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.stop(ctx.currentTime + dur);
    };
    const packs = {
      classic: () => {
        beep(220, 0.08, 'triangle', 0.04);
        setTimeout(() => beep(420, 0.03, 'square', 0.025), 120);
        setTimeout(() => beep(520, 0.18, 'sine', 0.05), 280);
        setTimeout(() => beep(660, 0.22, 'sine', 0.05), 400);
      },
      soft: () => {
        beep(260, 0.1, 'sine', 0.035);
        setTimeout(() => beep(320, 0.04, 'sine', 0.02), 140);
        setTimeout(() => beep(480, 0.25, 'triangle', 0.04), 300);
      },
      arcade: () => {
        beep(180, 0.06, 'square', 0.03);
        setTimeout(() => beep(360, 0.04, 'square', 0.028), 100);
        setTimeout(() => beep(720, 0.12, 'sawtooth', 0.035), 240);
        setTimeout(() => beep(880, 0.18, 'square', 0.03), 380);
      },
      bell: () => {
        beep(880, 0.35, 'sine', 0.04);
        setTimeout(() => beep(1320, 0.4, 'sine', 0.025), 40);
        setTimeout(() => beep(660, 0.5, 'triangle', 0.03), 200);
      }
    };
    (packs[pack] || packs.classic)();
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    /* ignore */
  }
}

$('#toggleAccept').onclick = async () => {
  const next = !(state?.settings?.acceptingDonations);
  await api('POST', '/api/accepting', { accepting: next });
};

document.querySelectorAll('[data-test]').forEach((btn) => {
  btn.onclick = async () => {
    await api('POST', '/api/donate/test', { amount: Number(btn.dataset.test) });
  };
});

$('#customDonate').onclick = async () => {
  const amount = Number($('#customAmount').value);
  if (!amount) return;
  await api('POST', '/api/donate/test', { amount });
};

$('#forceSpin').onclick = async () => {
  await api('POST', '/api/spin');
};

$('#manualReset').onclick = async () => {
  await api('POST', '/api/reset');
};

async function clearLogs({ donations, spins, confirmText }) {
  if (confirmText && !confirm(confirmText)) return;
  await api('POST', '/api/logs/clear', { donations, spins });
}

$('#clearDonationsBtn').onclick = () =>
  clearLogs({
    donations: true,
    confirmText: 'Очистить список последних донатов?'
  });

$('#clearSpinsBtn').onclick = () =>
  clearLogs({
    spins: true,
    confirmText: 'Очистить список последних круток?'
  });

$('#clearAllLogsBtn').onclick = () =>
  clearLogs({
    donations: true,
    spins: true,
    confirmText: 'Очистить оба списка (донаты и крутки)?'
  });

$('#toggleLayoutEdit').onclick = async () => {
  const next = !state?.settings?.layoutEditMode;
  await api('POST', '/api/settings', { layoutEditMode: next });
};

$('#saveLayout').onclick = async () => {
  await api('POST', '/api/settings', { layout: readLayoutFromForm() });
};

$('#resetLayout').onclick = async () => {
  const current = state?.settings?.layout || {};
  await api('POST', '/api/settings', {
    layoutEditMode: false,
    layout: {
      ...current,
      hudX: current.hudX ?? 2,
      hudY: current.hudY ?? 78,
      hudScale: 1,
      hudWidth: 240,
      hudHeight: 0,
      toastX: current.toastX ?? 0,
      toastY: current.toastY ?? -40,
      toastRelative: true,
      stripX: current.stripX ?? 50,
      stripY: current.stripY ?? 48,
      stripScale: 1,
      stripWidth: 820,
      stripHeight: 140
    }
  });
};

$('#addCategoryBtn')?.addEventListener('click', async () => {
  await api('POST', '/api/categories/add', {
    name: 'Новая категория',
    rarity: 'common',
    cardsText: ''
  });
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Тик таймера сброса на клиенте между WS-апдейтами
setInterval(() => {
  if (!state?.economy?.lastDonationAt || !state?.settings?.resetMinutes) return;
  const deadline =
    state.economy.lastDonationAt + state.settings.resetMinutes * 60 * 1000;
  state.msUntilReset = Math.max(0, deadline - Date.now());
  $('#resetText').textContent = fmtReset(state.msUntilReset);
}, 1000);

$('#openRouletteBtn').onclick = async () => {
  if (window.rouletteApp?.openOverlayWindow) {
    await window.rouletteApp.openOverlayWindow('roulette');
  } else {
    window.open('/overlay/roulette/', '_blank', 'noopener');
  }
};

$('#openHudBtn').onclick = async () => {
  if (window.rouletteApp?.openOverlayWindow) {
    await window.rouletteApp.openOverlayWindow('hud');
  } else {
    window.open('/overlay/hud/', '_blank', 'noopener');
  }
};

function applyDaConfig(info) {
  const cfg = info?.config || info;
  if (!cfg) return;

  const redirect = cfg.redirectUri || `${location.origin}/oauth/callback`;
  const redirectEl = $('#daRedirect');
  const redirectInput = $('#daRedirectInput');
  if (redirectEl) redirectEl.textContent = redirect;
  if (redirectInput && !redirectInput.dataset.touched) {
    redirectInput.value = redirect;
  }

  const clientIdInput = $('#daClientId');
  if (clientIdInput && cfg.clientId && !clientIdInput.value.trim()) {
    clientIdInput.value = cfg.clientId;
  }

  const secretHint = $('#daSecretHint');
  const secretInput = $('#daClientSecret');
  if (secretHint) {
    secretHint.hidden = !cfg.hasClientSecret;
  }
  if (secretInput) {
    secretInput.placeholder = cfg.hasClientSecret
      ? 'Оставь пустым, чтобы не менять'
      : 'Секрет приложения DA';
  }

  const connectBtn = $('#connectDaBtn');
  if (connectBtn) {
    connectBtn.disabled = !cfg.configured;
    connectBtn.title = cfg.configured
      ? ''
      : 'Сначала сохрани Client ID и API Key';
  }

  const configLine = $('#daConfigLine');
  if (configLine) {
    const source =
      cfg.source === 'env'
        ? 'из .env'
        : cfg.source === 'file'
          ? 'сохранены в приложении'
          : 'не заданы';
    configLine.textContent = cfg.configured
      ? `Ключи: ${source}${cfg.source === 'env' ? ' (админка только для просмотра ID)' : ''}`
      : 'Ключи: не заданы — заполни форму выше';
  }
}

async function startDaOAuth() {
  const info = await fetch('/api/da/authorize-url')
    .then((r) => r.json())
    .catch((err) => ({ ok: false, error: String(err.message || err) }));

  if (!info?.ok || !info.url) {
    alert(info?.error || 'Не удалось начать авторизацию DA');
    return;
  }

  // В Electron — отдельное окно (системный браузер часто режет возврат на 127.0.0.1)
  if (window.rouletteApp?.openDaOAuth) {
    const result = await window.rouletteApp.openDaOAuth(info.url);
    await loadDaPanel();
    const status = await fetch('/api/da/status').then((r) => r.json()).catch(() => null);
    if (status?.da?.connected) {
      showToastNear('#daStatusLine', 'Donation Alerts подключён');
      closePlatformModal();
      return;
    }
    if (status?.hasSavedToken) {
      await api('POST', '/api/da/connect').catch(() => null);
      await loadDaPanel();
      const again = await fetch('/api/da/status').then((r) => r.json()).catch(() => null);
      if (again?.da?.connected) {
        showToastNear('#daStatusLine', 'Donation Alerts подключён');
        closePlatformModal();
      } else {
        showToastNear('#daStatusLine', 'Токен получен, подключаем…');
      }
      return;
    }
    if (result?.cancelled) {
      showToastNear('#daStatusLine', 'Авторизация отменена');
      return;
    }
    if (result?.error) {
      alert(result.error);
      return;
    }
    alert(
      'Токен DA не получен. Проверь Redirect URI в кабинете DA: ровно http://127.0.0.1:3847/oauth/callback'
    );
    return;
  }

  if (window.rouletteApp?.openExternal) {
    await window.rouletteApp.openExternal(info.url);
  } else {
    window.open(info.url, '_blank', 'noopener');
  }
}

$('#connectDaBtn').onclick = async () => {
  const status = await fetch('/api/da/status').then((r) => r.json()).catch(() => null);
  if (!status?.config?.configured) {
    alert('Сначала сохрани Client ID и API Key в форме выше.');
    return;
  }
  await startDaOAuth();
};

$('#disconnectDaBtn').onclick = async () => {
  await api('POST', '/api/da/disconnect');
};

$('#daRedirectInput')?.addEventListener('input', (ev) => {
  ev.target.dataset.touched = '1';
  const redirectEl = $('#daRedirect');
  if (redirectEl) redirectEl.textContent = ev.target.value.trim();
});

$('#daConfigForm')?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const clientId = $('#daClientId')?.value?.trim() || '';
  const clientSecret = $('#daClientSecret')?.value?.trim() || '';
  const redirectUri = $('#daRedirectInput')?.value?.trim() || '';

  if (!clientId) {
    alert('Укажи Client ID.');
    return;
  }

  try {
    const status = await fetch('/api/da/status').then((r) => r.json()).catch(() => null);
    if (!clientSecret && !status?.config?.hasClientSecret && !status?.config?.configured) {
      alert('Укажи API Key (secret).');
      return;
    }

    const res = await api('POST', '/api/da/config', {
      clientId,
      clientSecret: clientSecret || undefined,
      redirectUri: redirectUri || undefined
    });
    if (res.error) throw new Error(res.error);
    if ($('#daClientSecret')) $('#daClientSecret').value = '';
    applyDaConfig({ config: res.config });
    showToastNear('#daConfigLine', 'Ключи DA сохранены — открой окно авторизации');
    await startDaOAuth();
  } catch (err) {
    alert(String(err.message || err));
  }
});

async function loadDaPanel() {
  try {
    const info = await fetch('/api/da/status').then((r) => r.json());
    applyDaConfig(info);
  } catch {
    /* ignore */
  }
}

loadDaPanel();

const PLATFORM_LABELS = {
  da: 'Donation Alerts',
  dp: 'DonatePay',
  dx: 'DonateX'
};

let activePlatformKey = 'da';
let platformModalAwaitingConnect = false;

function setPlatformMenuOpen(open) {
  const btn = $('#platformMenuBtn');
  const list = $('#platformMenuList');
  if (!btn || !list) return;
  list.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function openPlatformModal(platform) {
  const key = PLATFORM_LABELS[platform] ? platform : 'da';
  activePlatformKey = key;
  const modal = $('#platformModal');
  if (!modal) return;

  document.querySelectorAll('[data-platform-pane]').forEach((pane) => {
    pane.hidden = pane.getAttribute('data-platform-pane') !== key;
  });
  document.querySelectorAll('.platform-menu-item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.platform === key);
  });

  const title = $('#platformModalTitle');
  const label = $('#platformMenuLabel');
  if (title) title.textContent = PLATFORM_LABELS[key];
  if (label) label.textContent = PLATFORM_LABELS[key];

  const map = { da: state?.da, dp: state?.donatepay, dx: state?.donatex };
  platformModalAwaitingConnect = !map[key]?.connected;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  setPlatformMenuOpen(false);
  updateHeaderPlatformStatus();

  try {
    localStorage.setItem('roulette.platformPane', key);
  } catch {
    /* ignore */
  }

  if (key === 'da') loadDaPanel();
  if (key === 'dp') loadDonatePayPanel();
  if (key === 'dx') loadDonateXPanel();
}

function closePlatformModal() {
  const modal = $('#platformModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  platformModalAwaitingConnect = false;
}

function selectPlatform(platform) {
  openPlatformModal(platform);
}

function updateHeaderPlatformStatus() {
  const el = $('#platformHeaderStatus');
  if (!el || !state) return;
  const map = { da: state.da, dp: state.donatepay, dx: state.donatex };
  const status = map[activePlatformKey];
  el.classList.remove('is-online', 'is-offline');
  if (status?.connected) {
    el.textContent = 'online';
    el.classList.add('is-online');
  } else if (status?.error) {
    el.textContent = 'off';
    el.classList.add('is-offline');
  } else {
    el.textContent = '…';
  }
}

function updatePlatformMenuStatuses({ da, donatepay, donatex }) {
  const map = { da, dp: donatepay, dx: donatex };
  document.querySelectorAll('[data-status-for]').forEach((el) => {
    const key = el.getAttribute('data-status-for');
    const status = map[key];
    el.classList.remove('is-online', 'is-offline');
    if (status?.connected) {
      el.textContent = 'online';
      el.classList.add('is-online');
    } else if (status?.error) {
      el.textContent = 'off';
      el.classList.add('is-offline');
    } else {
      el.textContent = '…';
    }
  });
  updateHeaderPlatformStatus();
}

function maybeCloseModalAfterConnect(platformKey) {
  if (!state) return;
  const map = { da: state.da, dp: state.donatepay, dx: state.donatex };
  if (map[platformKey]?.connected) closePlatformModal();
}

function syncPlatformModalAfterState() {
  if (!platformModalAwaitingConnect) return;
  if ($('#platformModal')?.classList.contains('hidden')) return;
  maybeCloseModalAfterConnect(activePlatformKey);
}

$('#platformMenuBtn')?.addEventListener('click', (ev) => {
  ev.stopPropagation();
  const list = $('#platformMenuList');
  setPlatformMenuOpen(Boolean(list?.hidden));
});

document.querySelectorAll('.platform-menu-item').forEach((item) => {
  item.addEventListener('click', () => selectPlatform(item.dataset.platform));
});

document.querySelectorAll('[data-close-modal]').forEach((el) => {
  el.addEventListener('click', () => closePlatformModal());
});

document.addEventListener('click', (ev) => {
  const menu = $('#platformMenu');
  if (!menu || menu.contains(ev.target)) return;
  setPlatformMenuOpen(false);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    setPlatformMenuOpen(false);
    closePlatformModal();
  }
});

try {
  activePlatformKey = localStorage.getItem('roulette.platformPane') || 'da';
} catch {
  activePlatformKey = 'da';
}
const bootLabel = $('#platformMenuLabel');
if (bootLabel) bootLabel.textContent = PLATFORM_LABELS[activePlatformKey] || PLATFORM_LABELS.da;
document.querySelectorAll('.platform-menu-item').forEach((item) => {
  item.classList.toggle('is-active', item.dataset.platform === activePlatformKey);
});

function showToastNear(anchorSel, text) {
  const toast = document.createElement('p');
  toast.className = 'copy-toast';
  toast.textContent = text;
  const anchor = $(anchorSel);
  if (anchor) anchor.after(toast);
  else document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

function applyTokenConfig(info, {
  hintSel,
  configLineSel,
  connectBtnSel,
  regionSel,
  emptyText,
  savedText
}) {
  const cfg = info?.config || info;
  if (!cfg) return;

  const hint = $(hintSel);
  if (hint) hint.hidden = !cfg.hasAccessToken && !cfg.configured;

  const region = $(regionSel);
  if (region && cfg.region) region.value = cfg.region;

  const connectBtn = $(connectBtnSel);
  if (connectBtn) {
    connectBtn.disabled = !cfg.configured;
    connectBtn.title = cfg.configured ? '' : 'Сначала сохрани токен';
  }

  const configLine = $(configLineSel);
  if (configLine) {
    const source =
      cfg.source === 'env'
        ? 'из .env'
        : cfg.source === 'file'
          ? 'сохранён в приложении'
          : 'не задан';
    configLine.textContent = cfg.configured
      ? `${savedText}: ${source}${cfg.tokenHint ? ` (${cfg.tokenHint})` : ''}`
      : emptyText;
  }
}

function bindTokenPlatform({
  statusUrl,
  configUrl,
  connectUrl,
  disconnectUrl,
  formSel,
  tokenInputSel,
  regionSel,
  connectBtnSel,
  disconnectBtnSel,
  ui,
  successToast,
  emptyAlert,
  buildConfigBody,
  platformKey
}) {
  async function reload() {
    try {
      const info = await fetch(statusUrl).then((r) => r.json());
      applyTokenConfig(info, ui);
    } catch {
      /* ignore */
    }
  }

  $(formSel)?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const accessToken = $(tokenInputSel)?.value?.trim() || '';
    try {
      const status = await fetch(statusUrl).then((r) => r.json()).catch(() => null);
      if (!accessToken && !status?.config?.configured) {
        alert(emptyAlert);
        return;
      }
      const body = buildConfigBody
        ? buildConfigBody({ accessToken, status })
        : { accessToken: accessToken || undefined };
      const res = await api('POST', configUrl, body);
      if (res.error) throw new Error(res.error);
      if ($(tokenInputSel)) $(tokenInputSel).value = '';
      applyTokenConfig(res, ui);
      showToastNear(ui.configLineSel, successToast);
      if (platformKey && state) {
        const statusKey = platformKey === 'dp' ? 'donatepay' : 'donatex';
        if (res[statusKey]) applyState({ ...state, [statusKey]: res[statusKey] });
        maybeCloseModalAfterConnect(platformKey);
      }
    } catch (err) {
      alert(String(err.message || err));
    }
  });

  $(connectBtnSel)?.addEventListener('click', async () => {
    try {
      const res = await api('POST', connectUrl);
      if (res.error) throw new Error(res.error);
      if (platformKey) maybeCloseModalAfterConnect(platformKey);
    } catch (err) {
      alert(String(err.message || err));
    }
  });

  $(disconnectBtnSel)?.addEventListener('click', async () => {
    await api('POST', disconnectUrl);
    await reload();
  });

  return { reload };
}

const donatePayUi = {
  hintSel: '#dpTokenHint',
  configLineSel: '#dpConfigLine',
  connectBtnSel: '#connectDpBtn',
  regionSel: '#dpRegion',
  emptyText: 'Токен: не задан — вставь API access token выше',
  savedText: 'Токен'
};

const donateXUi = {
  hintSel: '#dxTokenHint',
  configLineSel: '#dxConfigLine',
  connectBtnSel: '#connectDxBtn',
  emptyText: 'Токен: не задан — вставь API-токен выше',
  savedText: 'Токен'
};

const donatePayPlatform = bindTokenPlatform({
  statusUrl: '/api/donatepay/status',
  configUrl: '/api/donatepay/config',
  connectUrl: '/api/donatepay/connect',
  disconnectUrl: '/api/donatepay/disconnect',
  formSel: '#dpConfigForm',
  tokenInputSel: '#dpAccessToken',
  regionSel: '#dpRegion',
  connectBtnSel: '#connectDpBtn',
  disconnectBtnSel: '#disconnectDpBtn',
  ui: donatePayUi,
  successToast: 'DonatePay подключён',
  emptyAlert: 'Укажи API access token DonatePay.',
  platformKey: 'dp',
  buildConfigBody: ({ accessToken }) => ({
    accessToken: accessToken || undefined,
    region: $('#dpRegion')?.value || 'ru'
  })
});

const donateXPlatform = bindTokenPlatform({
  statusUrl: '/api/donatex/status',
  configUrl: '/api/donatex/config',
  connectUrl: '/api/donatex/connect',
  disconnectUrl: '/api/donatex/disconnect',
  formSel: '#dxConfigForm',
  tokenInputSel: '#dxAccessToken',
  connectBtnSel: '#connectDxBtn',
  disconnectBtnSel: '#disconnectDxBtn',
  ui: donateXUi,
  successToast: 'DonateX подключён',
  emptyAlert: 'Укажи API-токен DonateX.',
  platformKey: 'dx'
});

function loadDonatePayPanel() {
  return donatePayPlatform.reload();
}

function loadDonateXPanel() {
  return donateXPlatform.reload();
}

loadDonatePayPanel();
loadDonateXPanel();
function fillObsUrls(info) {
  const origin = info?.baseUrl || location.origin;
  const roulette = info?.rouletteUrl || `${origin}/overlay/roulette/`;
  const hud = info?.hudUrl || `${origin}/overlay/hud/`;
  const both = info?.overlayUrl || `${origin}/overlay/`;
  const set = (id, url) => {
    const el = document.getElementById(id);
    if (el) el.textContent = url;
  };
  set('obsRouletteUrl', roulette);
  set('obsHudUrl', hud);
  set('obsBothUrl', both);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function showCopyToast() {
  const el = $('#copyToast');
  if (!el) return;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 1600);
}

document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.onclick = async () => {
    const id = btn.getAttribute('data-copy');
    const node = document.getElementById(id);
    if (!node) return;
    const ok = await copyText(node.textContent.trim());
    if (ok) showCopyToast();
  };
});

$('#openObsRoulette').onclick = async () => {
  const url = $('#obsRouletteUrl')?.textContent?.trim();
  if (!url) return;
  if (window.rouletteApp?.openExternal) await window.rouletteApp.openExternal(url);
  else window.open(url, '_blank', 'noopener');
};

$('#openObsHud').onclick = async () => {
  const url = $('#obsHudUrl')?.textContent?.trim();
  if (!url) return;
  if (window.rouletteApp?.openExternal) await window.rouletteApp.openExternal(url);
  else window.open(url, '_blank', 'noopener');
};

if (window.rouletteApp?.getAppInfo) {
  window.rouletteApp.getAppInfo().then(fillObsUrls);
} else {
  fillObsUrls({ baseUrl: location.origin });
}

fetch('/api/state')
  .then((r) => r.json())
  .then(applyState)
  .catch(console.error);

connectWs();

function initCollapsiblePanels() {
  const KEY = 'roulette.collapsedPanels';
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    saved = {};
  }

  function persist() {
    const next = {};
    document.querySelectorAll('article.panel[data-panel]').forEach((panel) => {
      next[panel.dataset.panel] = panel.classList.contains('is-collapsed');
    });
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  document.querySelectorAll('article.panel[data-panel]').forEach((panel) => {
    const id = panel.dataset.panel;
    const toggle = panel.querySelector(':scope > .panel-toggle');
    if (!toggle) return;

    const collapsed = Boolean(saved[id]);
    panel.classList.toggle('is-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

    toggle.addEventListener('click', () => {
      const nextCollapsed = !panel.classList.contains('is-collapsed');
      panel.classList.toggle('is-collapsed', nextCollapsed);
      toggle.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
      persist();
    });
  });
}

initCollapsiblePanels();
updateCustomSoundUi();
