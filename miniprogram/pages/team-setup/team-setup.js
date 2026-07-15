const ROUTES = require('../../constants/routes.js');
const { ERROR_CODES, ERROR_MESSAGES } = require('../../constants/errors.js');
const teamService = require('../../services/team-service.js');

function createRequestKey() {
  return `team_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeInput(value) {
  return typeof value === 'string' ? value.trim() : '';
}

Page({
  data: {
    teamName: '',
    warehouseName: '默认仓库',
    submitting: false,
    errorMessage: ''
  },

  onLoad() {
    this.isActive = true;
    this.pendingRequestKey = '';
    this.pendingSignature = '';

    const app = getApp();
    if (app.globalData.currentTeam) {
      this.openInventory();
    }
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
    if (this.data.submitting) {
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
      this.pendingRequestKey = createRequestKey();
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
          errorMessage: ERROR_MESSAGES[ERROR_CODES.NO_ACTIVE_TEAM]
        });
      })
      .catch((error) => {
        if (this.isActive) {
          this.setData({
            submitting: false,
            errorMessage: this.getErrorMessage(error)
          });
        }
      });
  },

  openInventory() {
    wx.switchTab({
      url: ROUTES.INVENTORY,
      success: () => {
        this.pendingRequestKey = '';
        this.pendingSignature = '';
      },
      fail: () => {
        if (this.isActive) {
          this.setData({
            submitting: false,
            errorMessage: '页面跳转失败，请重新点击创建。'
          });
        }
      }
    });
  },

  handleJoinPlaceholder() {
    wx.showToast({
      title: '邀请加入功能将在后续阶段开放',
      icon: 'none'
    });
  }
});
