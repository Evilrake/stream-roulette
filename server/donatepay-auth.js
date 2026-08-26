const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');

const CONFIG_FILE_NAME = 'donatepay-config.json';

function configFile() {
  return path.join(getDataDir(), CONFIG_FILE_NAME);
}

function ensureDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadSavedConfig() {
  try {
    const file = configFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig({ accessToken, region }) {
  ensureDir();
  const current = loadSavedConfig() || {};
  const fromEnv = process.env.DONATEPAY_ACCESS_TOKEN || '';
  const next = {
    accessToken: accessToken
      ? String(accessToken).trim()
      : String(current.accessToken || fromEnv || '').trim(),
    region: normalizeRegion(region || current.region || 'ru')
  };
  if (!next.accessToken) throw new Error('API-токен DonatePay обязателен');
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), 'utf8');
  return getConfigForApi();
}

function clearConfig() {
  const file = configFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function normalizeRegion(region) {
  const r = String(region || 'ru').toLowerCase();
  return r === 'eu' ? 'eu' : 'ru';
}

function getConfig() {
  const saved = loadSavedConfig() || {};
  return {
    accessToken: process.env.DONATEPAY_ACCESS_TOKEN || saved.accessToken || '',
    region: normalizeRegion(process.env.DONATEPAY_REGION || saved.region || 'ru')
  };
}

function getConfigForApi() {
  const cfg = getConfig();
  const saved = loadSavedConfig();
  const fromEnv = Boolean(
    process.env.DONATEPAY_ACCESS_TOKEN || process.env.DONATEPAY_REGION
  );
  return {
    region: cfg.region,
    hasAccessToken: Boolean(cfg.accessToken),
    configured: Boolean(cfg.accessToken),
    source: fromEnv ? 'env' : saved ? 'file' : 'none',
    tokenHint: cfg.accessToken
      ? `${cfg.accessToken.slice(0, 4)}…${cfg.accessToken.slice(-4)}`
      : null
  };
}

function resolveAccessToken() {
  const cfg = getConfig();
  if (!cfg.accessToken) return null;
  return {
    accessToken: cfg.accessToken,
    region: cfg.region,
    source: process.env.DONATEPAY_ACCESS_TOKEN ? 'env' : 'file'
  };
}

module.exports = {
  loadSavedConfig,
  saveConfig,
  clearConfig,
  getConfig,
  getConfigForApi,
  resolveAccessToken,
  normalizeRegion
};
