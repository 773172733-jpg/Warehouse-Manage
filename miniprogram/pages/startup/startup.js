const ROUTES = require('../../constants/routes.js');
const { ERROR_MESSAGES, ERROR_CODES } = require('../../constants/errors.js');
const teamService = require('../../services/team-service.js');
const {
  STARTUP_DESTINATIONS,
  decideStartupDestination
} = require('../../utils/team-join.js');
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

        if (!result.onboardingRequired) {
          this.openInventory(sequence);
          return;
        }

        return this.resolveOnboarding(result, sequence);
      })
      .catch((error) => {
        if (this.isActive && sequence === this.startSequence) {
          this.showFailure(error);
        }
      });
  },

  resolveOnboarding(bootstrapResult, sequence) {
    return teamService.getJoinStatus()
      .then((joinStatus) => {
        if (!this.isActive || sequence !== this.startSequence) {
          return;
        }

        const destination = decideStartupDestination(bootstrapResult, joinStatus);
        if (destination === STARTUP_DESTINATIONS.TEAM_SETUP) {
          this.openTeamSetup(sequence);
          return;
        }
        if (destination === STARTUP_DESTINATIONS.TEAM_JOIN) {
          this.openTeamJoin(sequence);
          return;
        }
        if (destination === STARTUP_DESTINATIONS.REFRESH_BOOTSTRAP) {
          return this.refreshApprovedTeam(sequence);
        }
        if (destination === STARTUP_DESTINATIONS.INVENTORY) {
          this.openInventory(sequence);
          return;
        }

        const error = new Error(ERROR_MESSAGES[ERROR_CODES.BOOTSTRAP_FAILED]);
        error.code = ERROR_CODES.BOOTSTRAP_FAILED;
        throw error;
      });
  },

  refreshApprovedTeam(sequence) {
    return getApp().bootstrap({ forceRefresh: true })
      .then((result) => {
        if (!this.isActive || sequence !== this.startSequence) {
          return;
        }
        if (result.onboardingRequired) {
          const error = new Error('团队身份刷新失败，请稍后重试。');
          error.code = ERROR_CODES.BOOTSTRAP_FAILED;
          throw error;
        }
        this.openInventory(sequence);
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

  openTeamJoin(sequence) {
    logger.info('Startup is ready to open team join.');
    wx.redirectTo({
      url: ROUTES.TEAM_JOIN,
      success: () => {
        logger.info('Startup team join navigation succeeded.');
      },
      fail: (error) => {
        logger.error('Startup team join navigation failed.', error);

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
