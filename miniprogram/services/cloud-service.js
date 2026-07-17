const env = require('../config/env.js');
const { ERROR_CODES } = require('../constants/errors.js');
const { normalizeError } = require('../utils/error-handler.js');

function createRequestId() {
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function showLoading(title) {
  if (title) {
    wx.showLoading({
      title,
      mask: true
    });
  }
}

function hideLoading(title) {
  if (title) {
    wx.hideLoading();
  }
}

function withRequestContext(error, action, requestId) {
  return Object.assign({}, error, {
    code: error && error.code,
    message: error && error.message,
    action,
    requestId: (error && error.requestId) || requestId
  });
}

function callApi(action, data = {}, options = {}) {
  if (!env.WAREHOUSE_CLOUD_ENV) {
    return Promise.reject(normalizeError(null, ERROR_CODES.CLOUD_ENV_NOT_CONFIGURED));
  }

  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(normalizeError(null, ERROR_CODES.CLOUD_NOT_AVAILABLE));
  }

  const loadingTitle = options.loadingTitle;
  const requestId = options.requestId || createRequestId();
  showLoading(loadingTitle);

  return wx.cloud.callFunction({
    name: env.CLOUD_FUNCTION_NAME,
    config: {
      env: env.WAREHOUSE_CLOUD_ENV
    },
    data: {
      action,
      data,
      requestId
    }
  })
    .then((res) => {
      const result = res && res.result;

      if (!result) {
        throw normalizeError({ action, requestId }, ERROR_CODES.CLOUD_CALL_FAILED);
      }

      if (result.success) {
        return result.data;
      }

      throw normalizeError(Object.assign({}, result.error, {
        action,
        requestId: result.requestId || requestId
      }), ERROR_CODES.BUSINESS_ERROR);
    })
    .catch((error) => {
      throw normalizeError(
        withRequestContext(error, action, requestId),
        ERROR_CODES.CLOUD_CALL_FAILED
      );
    })
    .finally(() => {
      hideLoading(loadingTitle);
    });
}

module.exports = {
  callApi,
  createRequestId
};
