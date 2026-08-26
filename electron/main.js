const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');

let adminWin = null;
let rouletteWin = null;
let hudWin = null;
let baseUrl = 'http://127.0.0.1:3847';
let startServer = null;

function prepareRuntimePaths() {
  if (app.isPackaged) {
    const userData = app.getPath('userData');
    process.env.ROULETTE_USER_DATA = userData;
    if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });

    const envFile = path.join(userData, '.env');
    const exampleSrc = path.join(process.resourcesPath, '.env.example');
    if (!fs.existsSync(envFile) && fs.existsSync(exampleSrc)) {
      fs.copyFileSync(exampleSrc, envFile);
    }
    process.env.ROULETTE_ENV_LOADED = '1';
    require('dotenv').config({ path: envFile });
  } else {
    process.env.ROULETTE_ENV_LOADED = '1';
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  }
}

function createAdminWindow() {
  adminWin = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: 'Стрим-рулетка',
    backgroundColor: '#0c1210',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  adminWin.loadURL(`${baseUrl}/admin/`);
  adminWin.on('closed', () => {
    adminWin = null;
    app.quit();
  });
}

function createRouletteWindow() {
  if (rouletteWin && !rouletteWin.isDestroyed()) {
    rouletteWin.focus();
    return;
  }

  rouletteWin = new BrowserWindow({
    width: 960,
    height: 360,
    minWidth: 480,
    minHeight: 220,
    title: 'Оверлей — рулетка',
    transparent: true,
    backgroundColor: '#00000000',
    frame: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  rouletteWin.loadURL(`${baseUrl}/overlay/roulette/`);
  rouletteWin.on('closed', () => {
    rouletteWin = null;
  });
}

function createHudWindow() {
  if (hudWin && !hudWin.isDestroyed()) {
    hudWin.focus();
    return;
  }

  hudWin = new BrowserWindow({
    width: 560,
    height: 420,
    minWidth: 360,
    minHeight: 280,
    title: 'Оверлей — порог',
    transparent: true,
    backgroundColor: '#00000000',
    frame: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  hudWin.loadURL(`${baseUrl}/overlay/hud/`);
  hudWin.on('closed', () => {
    hudWin = null;
  });
}

function createOverlayWindows() {
  createRouletteWindow();
  createHudWindow();
}

function buildMenu() {
  const template = [
    {
      label: 'Рулетка',
      submenu: [
        {
          label: 'Окно рулетки',
          accelerator: 'CmdOrCtrl+O',
          click: () => createRouletteWindow()
        },
        {
          label: 'Окно порога',
          accelerator: 'CmdOrCtrl+P',
          click: () => createHudWindow()
        },
        { type: 'separator' },
        {
          label: 'OBS: URL рулетки',
          click: () => shell.openExternal(`${baseUrl}/overlay/roulette/`)
        },
        {
          label: 'OBS: URL порога',
          click: () => shell.openExternal(`${baseUrl}/overlay/hud/`)
        },
        {
          label: 'Папка настроек',
          click: () => shell.openPath(app.getPath('userData'))
        },
        { type: 'separator' },
        {
          label: 'Перезагрузить админку',
          accelerator: 'CmdOrCtrl+R',
          click: () => adminWin?.reload()
        },
        { type: 'separator' },
        { role: 'quit', label: 'Выход' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'togglefullscreen', label: 'Полный экран' },
        { role: 'zoomIn', label: 'Крупнее' },
        { role: 'zoomOut', label: 'Мельче' },
        { role: 'resetZoom', label: 'Сброс масштаба' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('open-overlay-window', (_e, kind) => {
  if (kind === 'hud') createHudWindow();
  else if (kind === 'both') createOverlayWindows();
  else createRouletteWindow();
  return true;
});

ipcMain.handle('get-app-info', () => ({
  baseUrl,
  overlayUrl: `${baseUrl}/overlay/`,
  rouletteUrl: `${baseUrl}/overlay/roulette/`,
  hudUrl: `${baseUrl}/overlay/hud/`,
  userData: app.getPath('userData')
}));

ipcMain.handle('open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

/**
 * OAuth DA во встроенном окне: системный браузер часто блокирует
 * возврат на http://127.0.0.1 (HTTPS-Only) — токен тогда не сохраняется.
 */
ipcMain.handle('open-da-oauth', async (_e, authorizeUrl) => {
  if (typeof authorizeUrl !== 'string' || !/^https:\/\/www\.donationalerts\.com\//i.test(authorizeUrl)) {
    return { ok: false, error: 'Некорректный URL авторизации DA' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        if (authWin && !authWin.isDestroyed()) authWin.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const authWin = new BrowserWindow({
      width: 780,
      height: 880,
      minWidth: 520,
      minHeight: 640,
      parent: adminWin || undefined,
      modal: Boolean(adminWin),
      title: 'Donation Alerts — подключение',
      backgroundColor: '#0c1210',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    const handleUrl = (url) => {
      if (!url || typeof url !== 'string') return;
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      const isCallback =
        parsed.pathname === '/oauth/callback' ||
        parsed.pathname.endsWith('/oauth/callback');
      if (!isCallback) return;

      if (parsed.searchParams.get('error')) {
        finish({
          ok: false,
          error:
            parsed.searchParams.get('error_description') ||
            parsed.searchParams.get('error') ||
            'Ошибка авторизации DA'
        });
        return;
      }
      if (parsed.searchParams.get('code')) {
        // Даём Express обработать callback (обмен code → token)
        setTimeout(() => finish({ ok: true }), 1200);
      }
    };

    authWin.webContents.on('will-redirect', (_ev, url) => handleUrl(url));
    authWin.webContents.on('will-navigate', (_ev, url) => handleUrl(url));
    authWin.webContents.on('did-navigate', (_ev, url) => handleUrl(url));
    authWin.webContents.on('did-navigate-in-page', (_ev, url) => handleUrl(url));
    authWin.on('closed', () => {
      if (!settled) finish({ ok: false, cancelled: true });
    });

    authWin.loadURL(authorizeUrl).catch((err) => {
      finish({ ok: false, error: String(err.message || err) });
    });
  });
});

app.whenReady().then(async () => {
  prepareRuntimePaths();
  // сервер подключаем после userData, чтобы data/.env писались в AppData
  ({ startServer } = require('../server'));

  try {
    const { url } = await startServer();
    baseUrl = url;
  } catch (err) {
    console.error('Не удалось запустить сервер:', err);
    app.quit();
    return;
  }

  buildMenu();
  createAdminWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createAdminWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
