const userService = require('./services/user-service');
const env = require('./config/env');
const logger = require('./utils/logger');

App({
  globalData: {
    user: null,
    currentTeam: null,
    currentRole: null,
    bootstrapStatus: 'idle'
  },

  bootstrapPromise: null,

  onLaunch() {
    this.initCloud();
    this.bootstrap();
  },

  initCloud() {
    if (!wx.cloud) {
      logger.warn('CloudBase is not available in this runtime.');
      return;
    }

    const cloudOptions = {
      traceUser: true
    };

    if (env.DB_ENV) {
      cloudOptions.env = env.DB_ENV;
    }

    try {
      wx.cloud.init(cloudOptions);
    } catch (error) {
      logger.error('CloudBase init failed.', error);
    }
  },

  bootstrap(options = {}) {
    if (!options.force && this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    this.globalData.bootstrapStatus = 'loading';
    this.bootstrapPromise = userService.bootstrap()
      .then((result) => {
        this.globalData.user = result.user;
        this.globalData.currentTeam = result.currentTeam;
        this.globalData.currentRole = result.currentRole;
        this.globalData.bootstrapStatus = 'success';
        return result;
      })
      .catch((error) => {
        this.globalData.bootstrapStatus = 'failed';
        logger.error('App bootstrap failed.', error);
        throw error;
      })
      .finally(() => {
        if (options.force) {
          this.bootstrapPromise = null;
        }
      });

    return this.bootstrapPromise;
  }
});
