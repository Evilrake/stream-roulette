const path = require('path');
const fs = require('fs');

/**
 * В разработке — папка проекта.
 * В установленном приложении — AppData (запись разрешена).
 */
function getUserDataRoot() {
  if (process.env.ROULETTE_USER_DATA) {
    return process.env.ROULETTE_USER_DATA;
  }
  return path.join(__dirname, '..');
}

function getDataDir() {
  const dir = path.join(getUserDataRoot(), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSpoilersDir() {
  const dir = path.join(getUserDataRoot(), 'spoilers');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSoundsDir() {
  const dir = path.join(getUserDataRoot(), 'sounds');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getPublicDir() {
  return path.join(__dirname, '..', 'public');
}

function getEnvFilePath() {
  if (process.env.ROULETTE_USER_DATA) {
    return path.join(process.env.ROULETTE_USER_DATA, '.env');
  }
  return path.join(__dirname, '..', '.env');
}

module.exports = {
  getUserDataRoot,
  getDataDir,
  getSpoilersDir,
  getSoundsDir,
  getPublicDir,
  getEnvFilePath
};
