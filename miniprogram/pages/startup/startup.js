const ROUTES = require('../../constants/routes');
const { ERROR_MESSAGES, ERROR_CODES } = require('../../constants/errors');

Page({
  data: {
    status: 'loading',
    errorMessage: ''
  },

  onLoad() {
    this.start();
  },

  start(force = false) {
    const app = getApp();

    this.setData({
      status: 'loading',
      errorMessage: ''
    });

    app.bootstrap({ force })
      .then(() => {
        wx.switchTab({
          url: ROUTES.INVENTORY
        });
      })
      .catch((error) => {
        this.setData({
          status: 'failed',
          errorMessage: error && error.message ? error.message : ERROR_MESSAGES[ERROR_CODES.BOOTSTRAP_FAILED]
        });
      });
  },

  handleRetry() {
    this.start(true);
  }
});
