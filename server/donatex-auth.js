const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');

const CONFIG_FILE_NAME = 'donatex-config.json';

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

function saveConfig({ accessToken }) {
  ensureDir();
  const current = loadSavedConfig() || {};
  const fromEnv = process.env.DONATEX_ACCESS_TOKEN || '';
  const next = {
    accessToken: accessToken
      ? String(accessToken).trim()
      : String(current.accessToken || fromEnv || '').trim()
  };
  if (!next.accessToken) throw new Error('API-токен DonateX обязателен');
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), 'utf8');
  return getConfigForApi();
}

function clearConfig() {
  const file = configFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function getConfig() {
  const saved = loadSavedConfig() || {};
  return {
    accessToken: process.env.DONATEX_ACCESS_TOKEN || saved.accessToken || ''
  };
}

function getConfigForApi() {
  const cfg = getConfig();
  const saved = loadSavedConfig();
  const fromEnv = Boolean(process.env.DONATEX_ACCESS_TOKEN);
  return {
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
    source: process.env.DONATEX_ACCESS_TOKEN ? 'env' : 'file'
  };
}

module.exports = {
  loadSavedConfig,
  saveConfig,
  clearConfig,
  getConfig,
  getConfigForApi,
  resolveAccessToken
};
