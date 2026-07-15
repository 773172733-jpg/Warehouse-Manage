const ROUTES = require('../../constants/routes.js');
const { ERROR_CODES } = require('../../constants/errors.js');
const teamService = require('../../services/team-service.js');
const {
  INVITE_CODE_MAX_LENGTH,
  JOIN_VIEW_STATES,
  normalizeInviteCode,
  validateInviteCode,
  getJoinErrorMessage,
  mapJoinStatus,
  ensureJoinRequestIntent,
  formatApplicationTime
} = require('../../utils/team-join.js');

Page({
  data: {
    viewState: 'loading',
    code: '',
    maxCodeLength: INVITE_CODE_MAX_LENGTH,
    submitting: false,
    refreshing: false,
    errorMessage: '',
    teamName: '',
    appliedAtText: '—',
    reviewMessage: ''
  },

  onLoad() {
    this.isActive = true;
    this.isNavigating = false;
    this.statusSequence = 0;
    this.statusPromise = null;
    this.identityPromise = null;
    this.approvalPromise = null;
    this.pendingIntent = null;
  },

  onShow() {
    this.checkIdentityAndStatus();
  },

  onUnload() {
    this.isActive = false;
    this.statusSequence += 1;
    this.pendingIntent = null;
  },

  checkIdentityAndStatus(forceRefresh = false) {
    if (this.identityPromise || this.isNavigating) {
      return this.identityPromise || Promise.resolve();
    }

    const app = getApp();
    if (app.globalData.currentTeam) {
      this.openInventory();
      return Promise.resolve();
    }

    this.setData({ viewState: 'loading', errorMessage: '' });
    const currentPromise = app.bootstrap({ forceRefresh })
      .then((result) => {
        if (!this.isActive) {
          return;
        }
        if (!result.onboardingRequired) {
          this.openInventory();
          return;
        }
        return this.loadJoinStatus();
      })
      .catch((error) => {
        if (this.isActive) {
          this.showStatusError(error);
        }
      })
      .finally(() => {
        if (this.identityPromise === currentPromise) {
          this.identityPromise = null;
        }
      });

    this.identityPromise = currentPromise;
    return currentPromise;
  },

  loadJoinStatus() {
    if (this.statusPromise || this.isNavigating) {
      return this.statusPromise || Promise.resolve();
    }

    const sequence = this.statusSequence + 1;
    this.statusSequence = sequence;
    this.setData({ refreshing: true, errorMessage: '' });

    const currentPromise = teamService.getJoinStatus()
      .then((response) => {
        if (!this.isActive || sequence !== this.statusSequence) {
          return;
        }
        const mapped = mapJoinStatus(response);
        if (mapped.viewState === JOIN_VIEW_STATES.ERROR) {
          const error = new Error('申请状态读取失败，请稍后重试。');
          error.code = ERROR_CODES.INTERNAL_ERROR;
          throw error;
        }
        if (mapped.viewState === JOIN_VIEW_STATES.APPROVED) {
          return this.refreshApprovedIdentity();
        }
        this.applyMappedState(mapped);
      })
      .catch((error) => {
        if (this.isActive && sequence === this.statusSequence) {
          this.showStatusError(error);
        }
      })
      .finally(() => {
        if (this.isActive && sequence === this.statusSequence) {
          this.setData({ refreshing: false, submitting: false });
        }
        if (this.statusPromise === currentPromise) {
          this.statusPromise = null;
        }
      });

    this.statusPromise = currentPromise;
    return currentPromise;
  },

  applyMappedState(mapped) {
    const application = mapped.application;
    const reviewMessage = application && application.reviewRemark
      ? application.reviewRemark
      : '团队创建者未填写原因';

    this.setData({
      viewState: mapped.viewState,
      submitting: false,
      errorMessage: '',
      teamName: application && application.team ? application.team.name : '未命名团队',
      appliedAtText: formatApplicationTime(application && application.appliedAt),
      reviewMessage
    });
  },

  refreshApprovedIdentity() {
    if (this.approvalPromise || this.isNavigating) {
      return this.approvalPromise || Promise.resolve();
    }

    this.setData({ viewState: JOIN_VIEW_STATES.APPROVED, errorMessage: '' });
    const currentPromise = getApp().bootstrap({ forceRefresh: true })
      .then((result) => {
        if (!this.isActive) {
          return;
        }
        if (result.onboardingRequired) {
          const error = new Error('团队身份尚未生效，请稍后刷新。');
          error.code = ERROR_CODES.BOOTSTRAP_FAILED;
          throw error;
        }
        this.pendingIntent = null;
        this.openInventory();
      })
      .catch((error) => {
        if (this.isActive) {
          this.showStatusError(error);
        }
      })
      .finally(() => {
        if (this.approvalPromise === currentPromise) {
          this.approvalPromise = null;
        }
      });

    this.approvalPromise = currentPromise;
    return currentPromise;
  },

  handleInput(event) {
    const code = normalizeInviteCode(event.detail.value).slice(0, INVITE_CODE_MAX_LENGTH);
    if (!this.pendingIntent || this.pendingIntent.code !== code) {
      this.pendingIntent = null;
    }
    this.setData({ code, errorMessage: '' });
  },

  handleClear() {
    this.pendingIntent = null;
    this.setData({ code: '', errorMessage: '' });
  },

  handleSubmit() {
    if (this.data.submitting || this.data.refreshing) {
      return;
    }

    const validation = validateInviteCode(this.data.code);
    if (!validation.valid) {
      this.setData({ code: validation.code, errorMessage: validation.message });
      return;
    }

    this.pendingIntent = ensureJoinRequestIntent(validation.code, this.pendingIntent);
    this.setData({
      code: validation.code,
      submitting: true,
      errorMessage: ''
    });

    teamService.applyToJoin({
      code: this.pendingIntent.code,
      requestKey: this.pendingIntent.requestKey
    })
      .then(() => {
        if (!this.isActive) {
          return;
        }
        this.pendingIntent = null;
        this.setData({ code: '' });
        return this.loadJoinStatus();
      })
      .catch((error) => {
        if (!this.isActive) {
          return;
        }
        if (error && error.code === ERROR_CODES.ALREADY_IN_TEAM) {
          this.pendingIntent = null;
          this.refreshApprovedIdentity();
          return;
        }
        if (error && error.code === ERROR_CODES.JOIN_REQUEST_ALREADY_PENDING) {
          this.pendingIntent = null;
          this.loadJoinStatus();
          return;
        }
        this.setData({
          viewState: JOIN_VIEW_STATES.INPUT,
          submitting: false,
          errorMessage: getJoinErrorMessage(error)
        });
      });
  },

  handleRefreshStatus() {
    this.loadJoinStatus();
  },

  handleRetryStatus() {
    this.checkIdentityAndStatus(true);
  },

  handleReapply() {
    this.pendingIntent = null;
    this.setData({
      viewState: JOIN_VIEW_STATES.INPUT,
      code: '',
      errorMessage: '',
      teamName: '',
      appliedAtText: '—',
      reviewMessage: ''
    });
  },

  handleBackToSetup() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.redirectTo({ url: ROUTES.TEAM_SETUP });
      }
    });
  },

  showStatusError(error) {
    this.setData({
      viewState: JOIN_VIEW_STATES.ERROR,
      submitting: false,
      refreshing: false,
      errorMessage: getJoinErrorMessage(error)
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
        this.pendingIntent = null;
      },
      fail: () => {
        this.isNavigating = false;
        if (this.isActive) {
          this.showStatusError({ code: ERROR_CODES.INTERNAL_ERROR });
        }
      }
    });
  }
});
