const userService = require('./services/user-service.js');
const env = require('./config/env.js');
const logger = require('./utils/logger.js');

App({
  globalData: {
    user: null,
    currentMembership: null,
    currentTeam: null,
    currentRole: null,
    currentWarehouse: null,
    bootstrapStatus: 'idle',
    stockAlertsRefreshRequired: false
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
      logger.warn('口袋仓库Go服务环境尚未配置，云端初始化不可用。');
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

  applyBootstrapResult(result) {
    this.globalData.user = result.user;
    if (result.membership && result.team) {
      this.globalData.currentMembership = result.membership;
      this.globalData.currentTeam = result.team;
      this.globalData.currentRole = result.membership.role;
      this.globalData.currentWarehouse = result.warehouse;
      this.globalData.bootstrapStatus = 'success';
    } else {
      this.clearTeamContext({ bootstrapStatus: 'success' });
    }
    return result;
  },

  clearTeamContext(options = {}) {
    this.globalData.currentMembership = null;
    this.globalData.currentTeam = null;
    this.globalData.currentRole = null;
    this.globalData.currentWarehouse = null;
    this.globalData.stockAlertsRefreshRequired = false;
    this.globalData.bootstrapStatus = options.bootstrapStatus || 'idle';
  },

  bootstrap(options = {}) {
    if (this.globalData.bootstrapStatus === 'loading' && this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    const forceRefresh = Boolean(options.forceRefresh || options.force);

    if (!forceRefresh && this.globalData.bootstrapStatus === 'success') {
      return Promise.resolve({
        user: this.globalData.user,
        membership: this.globalData.currentMembership,
        team: this.globalData.currentTeam,
        warehouse: this.globalData.currentWarehouse,
        onboardingRequired: !this.globalData.currentTeam
      });
    }

    logger.info('Bootstrap started.');
    this.globalData.bootstrapStatus = 'loading';
    const currentPromise = userService.bootstrap()
      .then((result) => {
        this.applyBootstrapResult(result);
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
