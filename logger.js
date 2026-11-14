const fs = require('node:fs');
const path = require('node:path');

const LOG_DIR = path.join(__dirname, 'data', 'logs');

function getLogPath(fileName) {
  return path.join(LOG_DIR, fileName);
}

function formatMeta(meta = {}) {
  if (!meta || Object.keys(meta).length === 0) {
    return '';
  }

  const safeMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safeMeta[key] = value;
    } else {
      safeMeta[key] = JSON.stringify(value);
    }
  }

  return ` ${JSON.stringify(safeMeta)}`;
}

function writeLog(fileName, level, message, meta = {}) {
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const timestamp = new Date().toISOString();
  const logPath = getLogPath(fileName);
  const line = `${timestamp} [${level}] ${message}${formatMeta(meta)}`;
  fs.appendFileSync(logPath, `${line}\n`, 'utf8');
}

function createLogger(fileName) {
  return {
    info(message, meta) {
      writeLog(fileName, 'INFO', message, meta);
    },
    warn(message, meta) {
      writeLog(fileName, 'WARN', message, meta);
    },
    error(message, meta) {
      writeLog(fileName, 'ERROR', message, meta);
    },
  };
}

module.exports = {
  auth: createLogger('auth.log'),
  message: createLogger('message.log'),
  http: createLogger('http.log'),
  error: createLogger('error.log'),
  getLogPath,
  writeLog,
};
