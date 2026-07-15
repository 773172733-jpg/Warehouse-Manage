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

function callApi(action, data = {}, options = {}) {
  if (!env.WAREHOUSE_CLOUD_ENV) {
    return Promise.reject(normalizeError(null, ERROR_CODES.CLOUD_ENV_NOT_CONFIGURED));
  }

  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(normalizeError(null, ERROR_CODES.CLOUD_NOT_AVAILABLE));
  }

  const loadingTitle = options.loadingTitle;
  showLoading(loadingTitle);

  return wx.cloud.callFunction({
    name: env.CLOUD_FUNCTION_NAME,
    config: {
      env: env.WAREHOUSE_CLOUD_ENV
    },
    data: {
      action,
      data,
      requestId: options.requestId || createRequestId()
    }
  })
    .then((res) => {
      const result = res && res.result;

      if (!result) {
        throw normalizeError(null, ERROR_CODES.CLOUD_CALL_FAILED);
      }

      if (result.success) {
        return result.data;
      }

      throw normalizeError(result.error, ERROR_CODES.BUSINESS_ERROR);
    })
    .catch((error) => {
      throw normalizeError(error, ERROR_CODES.CLOUD_CALL_FAILED);
    })
    .finally(() => {
      hideLoading(loadingTitle);
    });
}

module.exports = {
  callApi,
  createRequestId
};
