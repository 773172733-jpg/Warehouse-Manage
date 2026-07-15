const ROUTES = require('../../constants/routes.js');
const { ERROR_CODES, ERROR_MESSAGES } = require('../../constants/errors.js');
const teamService = require('../../services/team-service.js');
const { createRequestKey } = require('../../utils/request-key.js');
const {
  STARTUP_DESTINATIONS,
  decideStartupDestination,
  getJoinErrorMessage
} = require('../../utils/team-join.js');

function normalizeInput(value) {
  return typeof value === 'string' ? value.trim() : '';
}

Page({
  data: {
    teamName: '',
    warehouseName: '默认仓库',
    submitting: false,
    errorMessage: '',
    accessChecking: true,
    accessError: ''
  },

  onLoad() {
    this.isActive = true;
    this.isNavigating = false;
    this.accessPromise = null;
    this.pendingRequestKey = '';
    this.pendingSignature = '';
  },

  onShow() {
    this.ensureNoActiveTeam();
  },

  onUnload() {
    this.isActive = false;
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    if (field !== 'teamName' && field !== 'warehouseName') {
      return;
    }

    this.pendingRequestKey = '';
    this.pendingSignature = '';
    this.setData({
      [field]: value,
      errorMessage: ''
    });
  },

  handleCreate() {
    if (this.data.submitting || this.data.accessChecking || this.data.accessError) {
      return;
    }

    const name = normalizeInput(this.data.teamName);
    const warehouseName = normalizeInput(this.data.warehouseName);
    const validationMessage = this.validateInput(name, warehouseName);
    if (validationMessage) {
      this.setData({ errorMessage: validationMessage });
      return;
    }

    const signature = `${name}\n${warehouseName}`;
    if (!this.pendingRequestKey || this.pendingSignature !== signature) {
      this.pendingRequestKey = createRequestKey('team');
      this.pendingSignature = signature;
    }

    this.setData({
      submitting: true,
      errorMessage: ''
    });

    teamService.createTeam({
      name,
      warehouseName,
      requestKey: this.pendingRequestKey
    })
      .then((result) => {
        if (!this.isActive) {
          return;
        }
        getApp().applyBootstrapResult(result);
        this.openInventory();
      })
      .catch((error) => {
        if (!this.isActive) {
          return;
        }
        if (error && error.code === ERROR_CODES.ALREADY_IN_TEAM) {
          this.refreshExistingTeam();
          return;
        }
        this.setData({
          submitting: false,
          errorMessage: this.getErrorMessage(error)
        });
      });
  },

  validateInput(name, warehouseName) {
    if (name.length < 2 || name.length > 30) {
      return ERROR_MESSAGES[ERROR_CODES.INVALID_TEAM_NAME];
    }
    if (warehouseName.length < 1 || warehouseName.length > 30) {
      return ERROR_MESSAGES[ERROR_CODES.INVALID_WAREHOUSE_NAME];
    }
    return '';
  },

  getErrorMessage(error) {
    if (error && ERROR_MESSAGES[error.code]) {
      return ERROR_MESSAGES[error.code];
    }
    return error && error.message ? error.message : '创建失败，请稍后重试。';
  },

  refreshExistingTeam() {
    getApp().bootstrap({ forceRefresh: true })
      .then((result) => {
        if (!this.isActive) {
          return;
        }
        if (!result.onboardingRequired) {
          this.openInventory();
          return;
        }
        this.setData({
          submitting: false,
          accessChecking: false,
          accessError: ERROR_MESSAGES[ERROR_CODES.NO_ACTIVE_TEAM]
        });
      })
      .catch((error) => {
        if (this.isActive) {
          this.setData({
            submitting: false,
            accessChecking: false,
            accessError: this.getErrorMessage(error)
          });
        }
      });
  },

  openInventory() {
    if (this.isNavigating) {
      return;
    }
    this.isNavigating = true;
    wx.switchTab({
      url: ROUTES.INVENTORY,
      success: () => {
        this.pendingRequestKey = '';
        this.pendingSignature = '';
      },
      fail: () => {
        this.isNavigating = false;
        if (this.isActive) {
          this.setData({
            submitting: false,
            errorMessage: '页面跳转失败，请重新点击创建。'
          });
        }
      }
    });
  },

  ensureNoActiveTeam() {
    if (this.accessPromise || this.isNavigating) {
      return this.accessPromise || Promise.resolve();
    }

    const app = getApp();
    this.setData({ accessChecking: true, accessError: '' });
    const currentPromise = app.bootstrap()
      .then((result) => {
        if (!this.isActive) {
          return;
        }
        if (!result.onboardingRequired) {
          this.openInventory();
          return;
        }

        return teamService.getJoinStatus()
          .then((joinStatus) => {
            if (!this.isActive) {
              return;
            }
            const destination = decideStartupDestination(result, joinStatus);
            if (destination === STARTUP_DESTINATIONS.TEAM_JOIN) {
              this.openTeamJoinFromStatus();
              return;
            }
            if (destination === STARTUP_DESTINATIONS.REFRESH_BOOTSTRAP) {
              return this.refreshExistingTeam();
            }
            if (destination === STARTUP_DESTINATIONS.TEAM_SETUP) {
              this.setData({ accessChecking: false, accessError: '' });
              return;
            }
            const error = new Error('申请状态读取失败，请稍后重试。');
            error.code = ERROR_CODES.INTERNAL_ERROR;
            throw error;
          });
      })
      .catch((error) => {
        if (this.isActive) {
          this.setData({
            accessChecking: false,
            accessError: getJoinErrorMessage(error)
          });
        }
      })
      .finally(() => {
        if (this.accessPromise === currentPromise) {
          this.accessPromise = null;
        }
      });

    this.accessPromise = currentPromise;
    return currentPromise;
  },

  openTeamJoinFromStatus() {
    if (this.isNavigating) {
      return;
    }
    this.isNavigating = true;
    wx.redirectTo({
      url: ROUTES.TEAM_JOIN,
      fail: () => {
        this.isNavigating = false;
        if (this.isActive) {
          this.setData({
            accessChecking: false,
            accessError: '加入团队页面打开失败，请稍后重试。'
          });
        }
      }
    });
  },

  handleJoinTeam() {
    wx.navigateTo({
      url: ROUTES.TEAM_JOIN,
      fail: () => {
        if (this.isActive) {
          this.setData({ errorMessage: '加入团队页面打开失败，请稍后重试。' });
        }
      }
    });
  }
});
