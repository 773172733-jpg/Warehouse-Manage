const ROUTES = require('../../constants/routes');
const { ERROR_MESSAGES, ERROR_CODES } = require('../../constants/errors');
const logger = require('../../utils/logger');

Page({
  data: {
    status: 'loading',
    errorMessage: ''
  },

  onLoad() {
    this.isActive = true;
    this.startSequence = 0;
    this.start();
  },

  onUnload() {
    this.isActive = false;
    this.startSequence += 1;
  },

  start(force = false) {
    const app = getApp();
    const sequence = this.startSequence + 1;
    this.startSequence = sequence;

    this.setData({
      status: 'loading',
      errorMessage: ''
    });

    app.bootstrap({ force })
      .then(() => {
        if (!this.isActive || sequence !== this.startSequence) {
          return;
        }

        logger.info('Startup is ready to switch tab.');
        wx.switchTab({
          url: ROUTES.INVENTORY,
          success: () => {
            logger.info('Startup tab switch succeeded.');
          },
          fail: (error) => {
            logger.error('Startup tab switch failed.', error);

            if (this.isActive && sequence === this.startSequence) {
              this.showFailure(error);
            }
          }
        });
      })
      .catch((error) => {
        if (this.isActive && sequence === this.startSequence) {
          this.showFailure(error);
        }
      });
  },

  showFailure(error) {
    this.setData({
      status: 'failed',
      errorMessage: error && error.message ? error.message : ERROR_MESSAGES[ERROR_CODES.BOOTSTRAP_FAILED]
    });
  },

  handleRetry() {
    this.start(true);
  }
});
