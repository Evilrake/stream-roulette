const { createJsonConfigStore, tokenHint, configSource } = require('./json-config');

const store = createJsonConfigStore({ fileName: 'donatepay-config.json' });

function normalizeRegion(region) {
  const r = String(region || 'ru').toLowerCase();
  return r === 'eu' ? 'eu' : 'ru';
}

function loadSavedConfig() {
  return store.load();
}

function saveConfig({ accessToken, region }) {
  const current = loadSavedConfig() || {};
  const fromEnv = process.env.DONATEPAY_ACCESS_TOKEN || '';
  const next = {
    accessToken: accessToken
      ? String(accessToken).trim()
      : String(current.accessToken || fromEnv || '').trim(),
    region: normalizeRegion(region || current.region || 'ru')
  };
  if (!next.accessToken) throw new Error('API-токен DonatePay обязателен');
  store.save(next);
  return getConfigForApi();
}

function clearConfig() {
  store.clear();
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
    source: configSource(fromEnv, Boolean(saved)),
    tokenHint: tokenHint(cfg.accessToken)
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
