const { createJsonConfigStore, tokenHint, configSource } = require('./json-config');

const store = createJsonConfigStore({ fileName: 'donatex-config.json' });

function loadSavedConfig() {
  return store.load();
}

function saveConfig({ accessToken }) {
  const current = loadSavedConfig() || {};
  const fromEnv = process.env.DONATEX_ACCESS_TOKEN || '';
  const next = {
    accessToken: accessToken
      ? String(accessToken).trim()
      : String(current.accessToken || fromEnv || '').trim()
  };
  if (!next.accessToken) throw new Error('API-токен DonateX обязателен');
  store.save(next);
  return getConfigForApi();
}

function clearConfig() {
  store.clear();
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
    source: configSource(fromEnv, Boolean(saved)),
    tokenHint: tokenHint(cfg.accessToken)
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
