const env = require('../config/env');
const { ERROR_CODES } = require('../constants/errors');
const { normalizeError } = require('../utils/error-handler');

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
  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(normalizeError(null, ERROR_CODES.CLOUD_NOT_AVAILABLE));
  }

  const loadingTitle = options.loadingTitle;
  showLoading(loadingTitle);

  return wx.cloud.callFunction({
    name: options.name || env.CLOUD_FUNCTION_NAME,
    data: {
      action,
      data
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
  callApi
};
