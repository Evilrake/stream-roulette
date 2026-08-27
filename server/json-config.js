const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');

/**
 * Простое JSON-хранилище в data/ с приоритетом env над файлом.
 */
function createJsonConfigStore({ fileName }) {
  function filePath() {
    return path.join(getDataDir(), fileName);
  }

  function ensureDir() {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function load() {
    try {
      const file = filePath();
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  function save(data) {
    ensureDir();
    fs.writeFileSync(filePath(), JSON.stringify(data, null, 2), 'utf8');
    return data;
  }

  function clear() {
    const file = filePath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  return { filePath, load, save, clear };
}

function tokenHint(token) {
  if (!token) return null;
  const s = String(token);
  if (s.length < 8) return '••••';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function configSource(fromEnv, hasSaved) {
  if (fromEnv) return 'env';
  if (hasSaved) return 'file';
  return 'none';
}

module.exports = {
  createJsonConfigStore,
  tokenHint,
  configSource
};
