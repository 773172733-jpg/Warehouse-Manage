const { ERROR_MESSAGES } = require('../constants/errors.js');

function normalizeError(error, fallbackCode) {
  const code = error && error.code ? error.code : fallbackCode;
  const message = (error && error.message) || ERROR_MESSAGES[code] || '操作失败，请稍后重试。';
  const normalized = {
    code,
    message
  };

  ['requestId', 'action', 'stage'].forEach((field) => {
    if (error && typeof error[field] === 'string' && error[field]) {
      normalized[field] = error[field];
    }
  });

  return normalized;
}

module.exports = {
  normalizeError
};
