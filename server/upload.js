const fs = require('fs');
const path = require('path');

/**
 * Сохранить dataURL-файл в директорию.
 * @returns {{ url: string } | { error: string, status: number }}
 */
function saveDataUrlUpload({
  dataUrl,
  mimePattern,
  resolveExt,
  maxBytes,
  dir,
  urlPrefix,
  newId,
  badTypeError,
  tooLargeError
}) {
  const raw = String(dataUrl || '');
  const match = mimePattern.exec(raw);
  if (!match) {
    return { error: badTypeError, status: 400 };
  }
  const ext = resolveExt(match[1].toLowerCase());
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > maxBytes) {
    return { error: tooLargeError, status: 400 };
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const name = `${newId()}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return { url: `${urlPrefix}/${name}` };
}

module.exports = { saveDataUrlUpload };
