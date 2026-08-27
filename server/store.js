const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');
const {
  createDefaultCategory,
  ensureCategories,
  expandCategoriesToTasks
} = require('./categories');

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
  categories: [createDefaultCategory()],
  tasks: [],
  recentDonations: [],
  recentSpins: [],
  processedDonationIds: []
};

function syncTasksFromCategories(state) {
  state.categories = ensureCategories(state);
  state.tasks = expandCategoriesToTasks(state.categories);
  return state;
}

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
    const fresh = structuredClone(DEFAULT_STATE);
    syncTasksFromCategories(fresh);
    saveState(fresh);
    return fresh;
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    const state = {
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
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      recentDonations: Array.isArray(parsed.recentDonations) ? parsed.recentDonations : [],
      recentSpins: Array.isArray(parsed.recentSpins) ? parsed.recentSpins : [],
      processedDonationIds: Array.isArray(parsed.processedDonationIds)
        ? parsed.processedDonationIds
        : []
    };
    syncTasksFromCategories(state);
    return state;
  } catch {
    const fresh = structuredClone(DEFAULT_STATE);
    syncTasksFromCategories(fresh);
    return fresh;
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
  newId,
  syncTasksFromCategories
};
