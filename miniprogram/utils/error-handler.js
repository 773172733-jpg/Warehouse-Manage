const { ERROR_MESSAGES } = require('../constants/errors.js');

function normalizeError(error, fallbackCode) {
  const code = error && error.code ? error.code : fallbackCode;
  const message = ERROR_MESSAGES[code] || (error && error.message) || '操作失败，请稍后重试。';

  return {
    code,
    message
  };
}

module.exports = {
  normalizeError
};
