const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');

const TOKEN_FILE_NAME = 'da-tokens.json';
const CONFIG_FILE_NAME = 'da-config.json';
const DA_TOKEN_URL = 'https://www.donationalerts.com/oauth/token';
const DA_AUTHORIZE_URL = 'https://www.donationalerts.com/oauth/authorize';
const SCOPES = 'oauth-user-show oauth-donation-subscribe';

function tokenFile() {
  return path.join(getDataDir(), TOKEN_FILE_NAME);
}

function configFile() {
  return path.join(getDataDir(), CONFIG_FILE_NAME);
}

function defaultRedirectUri() {
  const port = Number(process.env.PORT) || 3847;
  return `http://127.0.0.1:${port}/oauth/callback`;
}

function ensureDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadTokens() {
  try {
    const file = tokenFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  ensureDir();
  const payload = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    expires_at: tokens.expires_at || Date.now() + (tokens.expires_in || 3600) * 1000,
    token_type: tokens.token_type || 'Bearer',
    saved_at: Date.now()
  };
  fs.writeFileSync(tokenFile(), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function clearTokens() {
  const file = tokenFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function loadSavedClientConfig() {
  try {
    const file = configFile();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function saveClientConfig({ clientId, clientSecret, redirectUri }) {
  ensureDir();
  const current = loadSavedClientConfig() || {};
  const next = {
    clientId: cleanCredential(clientId || current.clientId),
    clientSecret: clientSecret
      ? cleanCredential(clientSecret)
      : cleanCredential(current.clientSecret),
    redirectUri: cleanCredential(
      redirectUri || current.redirectUri || defaultRedirectUri()
    )
  };
  if (!next.clientId) throw new Error('Client ID обязателен');
  if (!next.clientSecret) throw new Error('API Key (secret) обязателен');
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), 'utf8');
  return getClientConfigForApi();
}

function cleanCredential(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

/**
 * Ключи из админки (da-config.json) важнее .env —
 * иначе старый/чужой .env даёт invalid_client при верных полях формы.
 */
function getClientConfig() {
  const saved = loadSavedClientConfig() || {};
  const fileId = cleanCredential(saved.clientId);
  const fileSecret = cleanCredential(saved.clientSecret);
  const fileRedirect = cleanCredential(saved.redirectUri);
  const envId = cleanCredential(process.env.DA_CLIENT_ID);
  const envSecret = cleanCredential(process.env.DA_CLIENT_SECRET);
  const envRedirect = cleanCredential(process.env.DA_REDIRECT_URI);

  if (fileId && fileSecret) {
    return {
      clientId: fileId,
      clientSecret: fileSecret,
      redirectUri: fileRedirect || envRedirect || defaultRedirectUri()
    };
  }

  return {
    clientId: envId || fileId,
    clientSecret: envSecret || fileSecret,
    redirectUri: envRedirect || fileRedirect || defaultRedirectUri()
  };
}

function getClientConfigForApi() {
  const cfg = getClientConfig();
  const saved = loadSavedClientConfig();
  const fileReady = Boolean(
    cleanCredential(saved?.clientId) && cleanCredential(saved?.clientSecret)
  );
  const envReady = Boolean(
    cleanCredential(process.env.DA_CLIENT_ID) &&
      cleanCredential(process.env.DA_CLIENT_SECRET)
  );
  return {
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    hasClientSecret: Boolean(cfg.clientSecret),
    hasClientId: Boolean(cfg.clientId),
    configured: Boolean(cfg.clientId && cfg.clientSecret),
    source: fileReady ? 'file' : envReady ? 'env' : saved ? 'file' : 'none'
  };
}

function buildAuthorizeUrl(state) {
  const { clientId, redirectUri } = getClientConfig();
  if (!clientId) {
    throw new Error('Укажи Client ID в админке (Donation Alerts) или в .env');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state: state || 'roulette'
  });
  return `${DA_AUTHORIZE_URL}?${params.toString()}`;
}

async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = getClientConfig();
  if (!clientId || !clientSecret) {
    throw new Error('Укажи Client ID и API Key в админке (Donation Alerts) или в .env');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code
  });
  const res = await fetch(DA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `OAuth ${res.status}`;
    const code = String(data.error || '');
    if (code === 'invalid_client') {
      throw new Error(
        `${detail}. Неверный Client ID или API Key (secret). ` +
          `Открой Donation Alerts → сверь пару ключей с кабинетом DA ` +
          `(https://www.donationalerts.com/application/clients), сохрани заново и подключи. ` +
          `Redirect URI: ${redirectUri}`
      );
    }
    throw new Error(
      `${detail}. Проверь, что Redirect URI в кабинете DA совпадает с: ${redirectUri}`
    );
  }
  return saveTokens(data);
}

async function refreshAccessToken() {
  const current = loadTokens();
  if (!current?.refresh_token) return null;
  const { clientId, clientSecret } = getClientConfig();
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
    scope: SCOPES
  });
  const res = await fetch(DA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return null;
  return saveTokens({
    ...data,
    refresh_token: data.refresh_token || current.refresh_token
  });
}

async function resolveAccessToken() {
  // 1) Явный токен из .env
  if (process.env.DA_ACCESS_TOKEN) {
    return {
      access_token: process.env.DA_ACCESS_TOKEN,
      source: 'env'
    };
  }

  let tokens = loadTokens();
  if (!tokens?.access_token) return null;

  // Обновить, если скоро истечёт (за 5 минут)
  if (tokens.expires_at && tokens.expires_at < Date.now() + 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken();
    if (refreshed) tokens = refreshed;
  }

  return { access_token: tokens.access_token, source: 'file' };
}

module.exports = {
  SCOPES,
  loadTokens,
  saveTokens,
  clearTokens,
  loadSavedClientConfig,
  saveClientConfig,
  getClientConfig,
  getClientConfigForApi,
  buildAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
  resolveAccessToken
};
