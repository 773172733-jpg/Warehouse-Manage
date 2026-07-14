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
    this.bootstrap().catch(() => {
      // startup 页面会展示失败状态；这里收口 onLaunch 发起的同一个 Promise。
    });
  },

  initCloud() {
    logger.info('CloudBase init started.');

    if (!env.WAREHOUSE_CLOUD_ENV) {
      logger.info('仓库管理器云环境尚未配置，当前运行本地骨架模式。');
      logger.info('CloudBase init finished.');
      return;
    }

    if (!wx.cloud) {
      logger.warn('CloudBase is not available in this runtime.');
      logger.info('CloudBase init finished.');
      return;
    }

    const cloudOptions = {
      env: env.WAREHOUSE_CLOUD_ENV,
      traceUser: true
    };

    try {
      wx.cloud.init(cloudOptions);
    } catch (error) {
      logger.error('CloudBase init failed.', error);
    } finally {
      logger.info('CloudBase init finished.');
    }
  },

  bootstrap(options = {}) {
    if (this.globalData.bootstrapStatus === 'loading' && this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    if (!options.force && this.globalData.bootstrapStatus === 'success') {
      return Promise.resolve({
        user: this.globalData.user,
        currentTeam: this.globalData.currentTeam,
        currentRole: this.globalData.currentRole
      });
    }

    logger.info('Bootstrap started.');
    this.globalData.bootstrapStatus = 'loading';
    const currentPromise = userService.bootstrap()
      .then((result) => {
        this.globalData.user = result.user;
        this.globalData.currentTeam = result.currentTeam;
        this.globalData.currentRole = result.currentRole;
        this.globalData.bootstrapStatus = 'success';
        logger.info('Bootstrap succeeded.');
        return result;
      })
      .catch((error) => {
        this.globalData.bootstrapStatus = 'failed';
        logger.error('Bootstrap failed.', error);
        throw error;
      })
      .finally(() => {
        if (this.bootstrapPromise === currentPromise) {
          this.bootstrapPromise = null;
        }
      });

    this.bootstrapPromise = currentPromise;
    return currentPromise;
  }
});
