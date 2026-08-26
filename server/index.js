const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const { getPublicDir, getSpoilersDir, getSoundsDir, getEnvFilePath } = require('./paths');
const { loadState, saveState, newId } = require('./store');
const { createEconomy } = require('./economy');
const { createDonationAlertsClient } = require('./da');
const daAuth = require('./da-auth');
const { createDonatePayClient } = require('./donatepay');
const donatepayAuth = require('./donatepay-auth');
const { createDonateXClient } = require('./donatex');
const donatexAuth = require('./donatex-auth');

if (!process.env.ROULETTE_ENV_LOADED) {
  require('dotenv').config({ path: getEnvFilePath() });
}

const DEFAULT_PORT = Number(process.env.PORT) || 3847;

let started = false;

function startServer(port = DEFAULT_PORT) {
  if (started) {
    return Promise.resolve({ port, url: `http://127.0.0.1:${port}` });
  }
  started = true;

  const PUBLIC = getPublicDir();
  const SPOILERS = getSpoilersDir();
  const SOUNDS = getSoundsDir();
  /** Меняется при каждом старте сервера — оверлеи в OBS сами перезагрузятся */
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  let state = loadState();

  function getState() {
    return state;
  }

  function setState(next) {
    state = next;
    saveState(state);
  }

  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use('/spoilers', express.static(SPOILERS));
  app.use('/sounds', express.static(SOUNDS));
  // OBS Browser Source агрессивно кэширует — после reload должны приходить свежие файлы
  app.use(
    express.static(PUBLIC, {
      etag: false,
      lastModified: false,
      setHeaders(res, filePath) {
        if (/\.(html?|js|css|map)$/i.test(filePath) || /[\\/]index\.html?$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    })
  );

  app.get('/', (_req, res) => {
    res.redirect('/admin/');
  });

  app.get('/overlay', (_req, res) => {
    res.redirect('/overlay/');
  });

  app.get('/admin', (_req, res) => {
    res.redirect('/admin/');
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const clients = new Set();

  function broadcast(type, payload) {
    const msg = JSON.stringify({ type, payload, at: Date.now() });
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }

  let daStatus = { connected: false, error: null };
  let donatepayStatus = { connected: false, error: null };
  let donatexStatus = { connected: false, error: null };

  function integrationsPayload() {
    return {
      da: daStatus,
      donatepay: donatepayStatus,
      donatex: donatexStatus
    };
  }

  const economy = createEconomy(getState, setState, (type, payload) => {
    if (type === 'state') {
      broadcast(type, { ...payload, ...integrationsPayload() });
    } else {
      broadcast(type, payload);
    }
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(
      JSON.stringify({
        type: 'hello',
        payload: { sessionId },
        at: Date.now()
      })
    );
    ws.send(
      JSON.stringify({
        type: 'state',
        payload: { ...economy.snapshot(), ...integrationsPayload() },
        at: Date.now()
      })
    );
    ws.on('close', () => clients.delete(ws));
  });

  app.get('/api/session', (_req, res) => {
    res.json({ sessionId });
  });

  function sendState(res) {
    res.json({ ...economy.snapshot(), ...integrationsPayload() });
  }

  app.get('/api/state', (_req, res) => {
    sendState(res);
  });

  app.post('/api/settings', (req, res) => {
    economy.updateSettings(req.body || {});
    sendState(res);
  });

  app.post('/api/tasks', (req, res) => {
    const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : null;
    if (!tasks) {
      res.status(400).json({ error: 'tasks array required' });
      return;
    }
    const normalized = tasks
      .map((t) => ({
        id: t.id || newId('task'),
        text: String(t.text || '').trim(),
        weight: Math.max(0.1, Number(t.weight) || 1),
        spoiler: String(t.spoiler || '').trim()
      }))
      .filter((t) => t.text);
    economy.setTasks(normalized);
    sendState(res);
  });

  app.post('/api/tasks/add', (req, res) => {
    const text = String(req.body?.text || '').trim();
    const weight = Math.max(0.1, Number(req.body?.weight) || 1);
    const spoiler = String(req.body?.spoiler || '').trim();
    if (!text) {
      res.status(400).json({ error: 'text required' });
      return;
    }
    const tasks = [...getState().tasks, { id: newId('task'), text, weight, spoiler }];
    economy.setTasks(tasks);
    sendState(res);
  });

  app.delete('/api/tasks/:id', (req, res) => {
    const tasks = getState().tasks.filter((t) => t.id !== req.params.id);
    economy.setTasks(tasks);
    sendState(res);
  });

  app.patch('/api/tasks/:id', (req, res) => {
    const tasks = getState().tasks.map((t) => {
      if (t.id !== req.params.id) return t;
      return {
        ...t,
        text: req.body.text != null ? String(req.body.text).trim() : t.text,
        weight:
          req.body.weight != null ? Math.max(0.1, Number(req.body.weight) || 1) : t.weight,
        spoiler:
          req.body.spoiler != null ? String(req.body.spoiler).trim() : t.spoiler || ''
      };
    });
    economy.setTasks(tasks);
    sendState(res);
  });

  app.post('/api/upload/spoiler', (req, res) => {
    const dataUrl = String(req.body?.dataUrl || '');
    const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(dataUrl);
    if (!match) {
      res.status(400).json({ error: 'Нужен dataUrl картинки (png/jpg/webp/gif)' });
      return;
    }
    const ext = match[1].toLowerCase().includes('png')
      ? 'png'
      : match[1].toLowerCase().includes('webp')
        ? 'webp'
        : match[1].toLowerCase().includes('gif')
          ? 'gif'
          : 'jpg';
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 6 * 1024 * 1024) {
      res.status(400).json({ error: 'Файл слишком большой (макс 6 МБ)' });
      return;
    }
    const dir = SPOILERS;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const name = `${newId('spoiler')}.${ext}`;
    fs.writeFileSync(path.join(dir, name), buf);
    res.json({ url: `/spoilers/${name}` });
  });

  app.post('/api/upload/sound', (req, res) => {
    const dataUrl = String(req.body?.dataUrl || '');
    const match =
      /^data:(audio\/(?:mpeg|mp3|wav|ogg|webm|x-wav|wave)|application\/octet-stream);base64,(.+)$/i.exec(
        dataUrl
      );
    if (!match) {
      res.status(400).json({ error: 'Нужен аудиофайл (mp3/wav/ogg/webm)' });
      return;
    }
    const mime = match[1].toLowerCase();
    let ext = 'mp3';
    if (mime.includes('wav')) ext = 'wav';
    else if (mime.includes('ogg')) ext = 'ogg';
    else if (mime.includes('webm')) ext = 'webm';
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) {
      res.status(400).json({ error: 'Файл слишком большой (макс 8 МБ)' });
      return;
    }
    if (!fs.existsSync(SOUNDS)) fs.mkdirSync(SOUNDS, { recursive: true });
    const name = `${newId('sound')}.${ext}`;
    fs.writeFileSync(path.join(SOUNDS, name), buf);
    res.json({ url: `/sounds/${name}` });
  });

  app.post('/api/donate/test', (req, res) => {
    const amount = Number(req.body?.amount);
    const username = req.body?.username || 'Тест';
    const result = economy.addDonation({
      amount,
      username,
      message: req.body?.message || 'Тестовый донат',
      source: 'test',
      externalId: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    });
    res.json({ result, state: { ...economy.snapshot(), ...integrationsPayload() } });
  });

  app.post('/api/reset', (_req, res) => {
    economy.resetThreshold(true);
    sendState(res);
  });

  app.post('/api/spin', (_req, res) => {
    const result = economy.forceSpin();
    res.json({ result, state: { ...economy.snapshot(), ...integrationsPayload() } });
  });

  app.post('/api/logs/clear', (req, res) => {
    economy.clearLogs({
      donations: Boolean(req.body?.donations),
      spins: Boolean(req.body?.spins)
    });
    sendState(res);
  });

  app.post('/api/accepting', (req, res) => {
    economy.updateSettings({ acceptingDonations: Boolean(req.body?.accepting) });
    sendState(res);
  });

  let daClient = null;
  let donatepayClient = null;
  let donatexClient = null;

  function pushIntegrationState() {
    broadcast('state', { ...economy.snapshot(), ...integrationsPayload() });
  }

  function setDaStatus(s) {
    daStatus = s;
    broadcast('da', daStatus);
    pushIntegrationState();
  }

  function setDonatePayStatus(s) {
    donatepayStatus = s;
    broadcast('donatepay', donatepayStatus);
    pushIntegrationState();
  }

  function setDonateXStatus(s) {
    donatexStatus = s;
    broadcast('donatex', donatexStatus);
    pushIntegrationState();
  }

  function ingestDonation(d, fallbackSource) {
    economy.addDonation({
      amount: d.amount,
      username: d.username,
      message: d.message,
      source: d.source || fallbackSource,
      externalId: d.externalId
    });
  }

  async function connectDonationAlerts(accessToken) {
    if (daClient) {
      try {
        daClient.stop();
      } catch {
        /* ignore */
      }
      daClient = null;
    }

    if (!accessToken) {
      setDaStatus({
        connected: false,
        error: 'Нет токена DA — нажми «Подключить Donation Alerts»'
      });
      return false;
    }

    setDaStatus({ connected: false, error: 'подключение…' });

    daClient = createDonationAlertsClient({
      accessToken,
      userId: process.env.DA_USER_ID || '',
      onDonation: (d) => ingestDonation(d, 'donationalerts'),
      onStatus: setDaStatus
    });
    daClient.connect();
    return true;
  }

  async function connectDonatePay({ accessToken, region }) {
    if (donatepayClient) {
      try {
        donatepayClient.stop();
      } catch {
        /* ignore */
      }
      donatepayClient = null;
    }

    if (!accessToken) {
      setDonatePayStatus({
        connected: false,
        error: 'Нет токена — сохрани API-ключ DonatePay'
      });
      return false;
    }

    setDonatePayStatus({ connected: false, error: 'подключение…' });

    donatepayClient = createDonatePayClient({
      accessToken,
      region: region || 'ru',
      onDonation: (d) => ingestDonation(d, 'donatepay'),
      onStatus: setDonatePayStatus
    });
    donatepayClient.connect();
    return true;
  }

  async function connectDonateX(accessToken) {
    if (donatexClient) {
      try {
        await donatexClient.stop();
      } catch {
        /* ignore */
      }
      donatexClient = null;
    }

    if (!accessToken) {
      setDonateXStatus({
        connected: false,
        error: 'Нет токена — сохрани API-токен DonateX'
      });
      return false;
    }

    setDonateXStatus({ connected: false, error: 'подключение…' });

    donatexClient = createDonateXClient({
      accessToken,
      onDonation: (d) => ingestDonation(d, 'donatex'),
      onStatus: setDonateXStatus
    });
    await donatexClient.connect();
    return true;
  }

  app.get('/api/da/status', (_req, res) => {
    const config = daAuth.getClientConfigForApi();
    const tokens = daAuth.loadTokens();
    res.json({
      da: daStatus,
      config,
      hasSavedToken: Boolean(tokens?.access_token || process.env.DA_ACCESS_TOKEN)
    });
  });

  app.get('/api/da/config', (_req, res) => {
    res.json(daAuth.getClientConfigForApi());
  });

  app.post('/api/da/config', (req, res) => {
    try {
      const { clientId, clientSecret, redirectUri } = req.body || {};
      const config = daAuth.saveClientConfig({ clientId, clientSecret, redirectUri });
      res.json({ ok: true, config });
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err.message || err) });
    }
  });

  app.get('/oauth/start', (req, res) => {
    try {
      const url = daAuth.buildAuthorizeUrl('roulette');
      res.redirect(url);
    } catch (err) {
      res.status(400).send(
        `<h1>Нельзя начать OAuth</h1><p>${String(err.message || err)}</p>` +
          `<p>Заполни Client ID и API Key в админке (раздел Donation Alerts) или в файле <code>.env</code>.</p>`
      );
    }
  });

  app.get('/api/da/authorize-url', (_req, res) => {
    try {
      const url = daAuth.buildAuthorizeUrl(`roulette-${Date.now()}`);
      const cfg = daAuth.getClientConfigForApi();
      res.json({ ok: true, url, redirectUri: cfg.redirectUri });
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err.message || err) });
    }
  });

  app.post('/api/da/connect', async (_req, res) => {
    try {
      const resolved = await daAuth.resolveAccessToken();
      if (!resolved?.access_token) {
        res.status(400).json({
          ok: false,
          error: 'Нет сохранённого токена — сначала пройди авторизацию DA'
        });
        return;
      }
      await connectDonationAlerts(resolved.access_token);
      res.json({
        ok: true,
        da: daStatus,
        hasSavedToken: true,
        config: daAuth.getClientConfigForApi()
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  app.get('/oauth/callback', async (req, res) => {
    const { code, error, error_description: desc } = req.query;
    if (error) {
      const msg = `${error}: ${desc || ''}`;
      setDaStatus({ connected: false, error: msg });
      res.status(400).send(`<h1>Ошибка DA</h1><p>${msg}</p>`);
      return;
    }
    if (!code) {
      setDaStatus({ connected: false, error: 'Нет кода авторизации от DA' });
      res.status(400).send('<h1>Нет кода авторизации</h1>');
      return;
    }
    try {
      const tokens = await daAuth.exchangeCode(String(code));
      await connectDonationAlerts(tokens.access_token);
      res.send(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>DA</title>
        <style>body{font-family:system-ui;background:#0c1210;color:#e8f2ea;display:grid;place-items:center;min-height:100vh;margin:0}
        .box{padding:24px 28px;border:1px solid rgba(61,214,140,.35);border-radius:14px;background:#14201b;text-align:center}
        a{color:#3dd68c}</style></head><body><div class="box">
        <h1>Donation Alerts подключён</h1>
        <p>Можно закрыть это окно и вернуться в приложение.</p>
        <p><a href="/admin/">Открыть админку</a></p>
        <script>setTimeout(function(){window.close()},1500)</script>
        </div></body></html>`);
    } catch (err) {
      const msg = String(err.message || err);
      setDaStatus({ connected: false, error: msg });
      console.error('[DA] OAuth callback:', msg);
      res.status(500).send(
        `<h1>Не удалось получить токен</h1><p>${msg}</p>` +
          `<p>В кабинете DA Redirect URI должен быть ровно <code>http://127.0.0.1:3847/oauth/callback</code> (не localhost).</p>`
      );
    }
  });

  app.post('/api/da/disconnect', (_req, res) => {
    daAuth.clearTokens();
    if (daClient) {
      try {
        daClient.stop();
      } catch {
        /* ignore */
      }
      daClient = null;
    }
    setDaStatus({ connected: false, error: 'отключено' });
    sendState(res);
  });

  // --- DonatePay ---
  app.get('/api/donatepay/status', (_req, res) => {
    res.json({
      donatepay: donatepayStatus,
      config: donatepayAuth.getConfigForApi()
    });
  });

  app.post('/api/donatepay/config', async (req, res) => {
    try {
      const { accessToken, region } = req.body || {};
      const config = donatepayAuth.saveConfig({ accessToken, region });
      const resolved = donatepayAuth.resolveAccessToken();
      if (resolved) {
        await connectDonatePay(resolved);
      }
      res.json({ ok: true, config, donatepay: donatepayStatus });
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err.message || err) });
    }
  });

  app.post('/api/donatepay/connect', async (_req, res) => {
    try {
      const resolved = donatepayAuth.resolveAccessToken();
      if (!resolved) {
        res.status(400).json({ ok: false, error: 'Сначала сохрани API-токен DonatePay' });
        return;
      }
      await connectDonatePay(resolved);
      sendState(res);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  app.post('/api/donatepay/disconnect', (_req, res) => {
    donatepayAuth.clearConfig();
    if (donatepayClient) {
      try {
        donatepayClient.stop();
      } catch {
        /* ignore */
      }
      donatepayClient = null;
    }
    setDonatePayStatus({ connected: false, error: 'отключено' });
    sendState(res);
  });

  // --- DonateX ---
  app.get('/api/donatex/status', (_req, res) => {
    res.json({
      donatex: donatexStatus,
      config: donatexAuth.getConfigForApi()
    });
  });

  app.post('/api/donatex/config', async (req, res) => {
    try {
      const { accessToken } = req.body || {};
      const config = donatexAuth.saveConfig({ accessToken });
      const resolved = donatexAuth.resolveAccessToken();
      if (resolved) {
        await connectDonateX(resolved.accessToken);
      }
      res.json({ ok: true, config, donatex: donatexStatus });
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err.message || err) });
    }
  });

  app.post('/api/donatex/connect', async (_req, res) => {
    try {
      const resolved = donatexAuth.resolveAccessToken();
      if (!resolved) {
        res.status(400).json({ ok: false, error: 'Сначала сохрани API-токен DonateX' });
        return;
      }
      await connectDonateX(resolved.accessToken);
      sendState(res);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  app.post('/api/donatex/disconnect', async (_req, res) => {
    donatexAuth.clearConfig();
    if (donatexClient) {
      try {
        await donatexClient.stop();
      } catch {
        /* ignore */
      }
      donatexClient = null;
    }
    setDonateXStatus({ connected: false, error: 'отключено' });
    sendState(res);
  });

  // Подключение при старте: .env токен или сохранённый OAuth / ключи
  (async () => {
    const wantDa =
      String(process.env.DA_ENABLED || 'true').toLowerCase() !== 'false';
    if (!wantDa) {
      setDaStatus({
        connected: false,
        error: 'DA_ENABLED=false — только тест-донаты'
      });
      console.log('[DA] отключено через DA_ENABLED=false');
    } else {
      try {
        const resolved = await daAuth.resolveAccessToken();
        if (resolved?.access_token) {
          await connectDonationAlerts(resolved.access_token);
          console.log(`[DA] старт с токеном (${resolved.source})`);
        } else {
          setDaStatus({
            connected: false,
            error: 'Нет токена — нажми «Подключить Donation Alerts»'
          });
          console.log('[DA] ждёт OAuth из админки');
        }
      } catch (err) {
        setDaStatus({ connected: false, error: String(err.message || err) });
        console.error('[DA]', err);
      }
    }

    const wantDp =
      String(process.env.DONATEPAY_ENABLED || 'true').toLowerCase() !== 'false';
    if (!wantDp) {
      setDonatePayStatus({ connected: false, error: 'DONATEPAY_ENABLED=false' });
      console.log('[DonatePay] отключено');
    } else {
      try {
        const resolved = donatepayAuth.resolveAccessToken();
        if (resolved) {
          await connectDonatePay(resolved);
          console.log(`[DonatePay] старт с токеном (${resolved.source}, ${resolved.region})`);
        } else {
          setDonatePayStatus({
            connected: false,
            error: 'Нет токена — сохрани ключ в админке'
          });
          console.log('[DonatePay] ждёт токен из админки');
        }
      } catch (err) {
        setDonatePayStatus({ connected: false, error: String(err.message || err) });
        console.error('[DonatePay]', err);
      }
    }

    const wantDx =
      String(process.env.DONATEX_ENABLED || 'true').toLowerCase() !== 'false';
    if (!wantDx) {
      setDonateXStatus({ connected: false, error: 'DONATEX_ENABLED=false' });
      console.log('[DonateX] отключено');
    } else {
      try {
        const resolved = donatexAuth.resolveAccessToken();
        if (resolved) {
          await connectDonateX(resolved.accessToken);
          console.log(`[DonateX] старт с токеном (${resolved.source})`);
        } else {
          setDonateXStatus({
            connected: false,
            error: 'Нет токена — сохрани ключ в админке'
          });
          console.log('[DonateX] ждёт токен из админки');
        }
      } catch (err) {
        setDonateXStatus({ connected: false, error: String(err.message || err) });
        console.error('[DonateX]', err);
      }
    }
  })();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${port}`;
      console.log('');
      console.log('  Рулетка запущена');
      console.log(`  Админка:  ${url}/admin/`);
      console.log(`  Рулетка:  ${url}/overlay/roulette/`);
      console.log(`  Порог:    ${url}/overlay/hud/`);
      console.log(`  Вместе:   ${url}/overlay/`);
      console.log(`  DA OAuth: ${url}/oauth/start`);
      console.log('');
      resolve({ port, url, server });
    });
  });
}

module.exports = { startServer };

if (require.main === module) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
