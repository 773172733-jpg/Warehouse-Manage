const ROUTES = require('../../constants/routes.js');
const { ERROR_MESSAGES, ERROR_CODES } = require('../../constants/errors.js');
const logger = require('../../utils/logger.js');

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

    app.bootstrap({ forceRefresh: force })
      .then((result) => {
        if (!this.isActive || sequence !== this.startSequence) {
          return;
        }

        if (result.onboardingRequired) {
          this.openTeamSetup(sequence);
          return;
        }

        this.openInventory(sequence);
      })
      .catch((error) => {
        if (this.isActive && sequence === this.startSequence) {
          this.showFailure(error);
        }
      });
  },

  openInventory(sequence) {
    logger.info('Startup is ready to switch to inventory.');
    wx.switchTab({
      url: ROUTES.INVENTORY,
      success: () => {
        logger.info('Startup inventory switch succeeded.');
      },
      fail: (error) => {
        logger.error('Startup inventory switch failed.', error);

        if (this.isActive && sequence === this.startSequence) {
          this.showFailure(error);
        }
      }
    });
  },

  openTeamSetup(sequence) {
    logger.info('Startup is ready to open team setup.');
    wx.redirectTo({
      url: ROUTES.TEAM_SETUP,
      success: () => {
        logger.info('Startup team setup navigation succeeded.');
      },
      fail: (error) => {
        logger.error('Startup team setup navigation failed.', error);

        if (this.isActive && sequence === this.startSequence) {
          this.showFailure(error);
        }
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
