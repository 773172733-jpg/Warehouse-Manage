const { ERROR_MESSAGES } = require('../constants/errors');

function normalizeError(error, fallbackCode) {
  const code = error && error.code ? error.code : fallbackCode;
  const message = (error && error.message) || ERROR_MESSAGES[code] || '操作失败，请稍后重试。';

  return {
    code,
    message
  };
}

module.exports = {
  normalizeError
};
