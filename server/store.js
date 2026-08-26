const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');

function stateFile() {
  return path.join(getDataDir(), 'state.json');
}

const DEFAULT_STATE = {
  settings: {
    baseThreshold: 100,
    step: 50,
    resetMinutes: 60,
    acceptingDonations: true,
    pauseBetweenSpinsMs: 2500,
    spinStartDelayMs: 5000,
    stripEnterDirection: 'up',
    soundEnabled: true,
    soundPack: 'classic',
    soundVolume: 70,
    soundCustomUrl: '',
    layoutEditMode: false,
    layout: {
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
      toastY: -40,
      toastRelative: true
    }
  },
  economy: {
    currentThreshold: 100,
    progress: 0,
    lastDonationAt: null,
    lastSpinAt: null
  },
  tasks: [
    { id: 't1', text: 'Отжимания x20', weight: 2, spoiler: '' },
    { id: 't2', text: 'Песня в войс-чат', weight: 1, spoiler: '' },
    { id: 't3', text: 'История из жизни', weight: 2, spoiler: '' },
    { id: 't4', text: 'Стример выбирает сам', weight: 1, spoiler: '' }
  ],
  recentDonations: [],
  recentSpins: [],
  processedDonationIds: []
};

function ensureDataDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadState() {
  ensureDataDir();
  const file = stateFile();
  if (!fs.existsSync(file)) {
    saveState(DEFAULT_STATE);
    return structuredClone(DEFAULT_STATE);
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      settings: {
        ...DEFAULT_STATE.settings,
        ...(parsed.settings || {}),
        layout: {
          ...DEFAULT_STATE.settings.layout,
          ...((parsed.settings && parsed.settings.layout) || {})
        }
      },
      economy: { ...DEFAULT_STATE.economy, ...(parsed.economy || {}) },
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : DEFAULT_STATE.tasks,
      recentDonations: Array.isArray(parsed.recentDonations) ? parsed.recentDonations : [],
      recentSpins: Array.isArray(parsed.recentSpins) ? parsed.recentSpins : [],
      processedDonationIds: Array.isArray(parsed.processedDonationIds)
        ? parsed.processedDonationIds
        : []
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState(state) {
  ensureDataDir();
  const file = stateFile();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function newId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  DEFAULT_STATE,
  loadState,
  saveState,
  newId
};
