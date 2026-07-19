var utils = require('./profile-utils.js');
var ROUTES = require('../../constants/routes.js');
var avatarCatalog = require('../../constants/member-avatars.js');
var teamService = require('../../services/team-service.js');

var MODAL_CONTENT = {
  help: {
    title: '使用帮助',
    bullets: ['搜索和查看商品', '管理员入库、出库和盘点', '查看库存流水', '查看库存预警', '管理团队成员权限']
  },
  about: {
    title: '关于口袋仓库Go',
    type: 'about'
  },
  privacy: {
    title: '隐私说明',
    paragraphs: [
      '小程序使用微信身份建立账号，并在私有云环境中保存团队、商品和库存数据。',
      '成员头像使用小程序内置像素图片，不读取或上传微信头像。',
      '用户主动选择商品图片时，图片仅用于商品封面并保存到私有云存储。'
    ]
  }
};

function buildProfileSource(globalData) {
  var source = globalData || {};
  var user = source.user || {};
  var membership = source.currentMembership || {};
  var team = source.currentTeam || null;
  var warehouse = source.currentWarehouse || null;
  return {
    currentUser: {
      id: membership.id || '',
      name: membership.displayName || user.displayName || '微信用户',
      teamNickname: membership.teamNickname || '',
      avatarKey: membership.avatarKey || '',
      role: membership.role || source.currentRole || '',
      joinedAt: membership.joinedAt || null
    },
    currentTeam: team ? {
      id: team.id,
      name: team.name,
      warehouseName: warehouse && warehouse.name ? warehouse.name : '默认仓库'
    } : null,
    appInfo: {
      appName: '口袋仓库Go',
      version: '以微信客户端为准',
      buildLabel: '团队共享库存管理'
    }
  };
}

Page({
  data: {
    user: {},
    team: {},
    hasTeam: false,
    permission: {},
    quickEntries: [],
    appInfo: {},
    modalOpen: false,
    activeModal: null,
    modalTitle: '',
    modalParagraphs: [],
    modalBullets: [],
    avatarOptions: avatarCatalog.AVATARS,
    draftNickname: '',
    draftAvatarKey: '',
    profileSaving: false,
    teamNameSaving: false
  },

  onLoad: function () {
    this.isActive = true;
    this.applyLocalState();
  },

  onShow: function () {
    this.refreshProfile();
  },

  onUnload: function () {
    this.isActive = false;
  },

  applyLocalState: function () {
    var app = getApp();
    var normalized = utils.normalizeProfile(buildProfileSource(app.globalData));
    var permission = utils.getPermissionFlags(normalized.currentUser.role, normalized.hasTeam);
    this.setData({
      user: normalized.currentUser,
      team: normalized.currentTeam,
      hasTeam: normalized.hasTeam,
      permission: permission,
      quickEntries: utils.buildQuickEntries(permission, normalized.hasTeam),
      appInfo: normalized.appInfo
    });
  },

  refreshProfile: function () {
    return getApp().bootstrap({ forceRefresh: true })
      .then(() => {
        if (this.isActive) this.applyLocalState();
      })
      .catch(() => {
        if (this.isActive && !this.data.user.name) {
          wx.showToast({ title: '个人资料加载失败，请重试', icon: 'none' });
        }
      });
  },

  openProfileModal: function () {
    this.setData({
      modalOpen: true,
      activeModal: 'profile',
      modalTitle: '个人信息',
      draftNickname: this.data.user.teamNickname || '',
      draftAvatarKey: this.data.user.avatarKey,
      modalParagraphs: [],
      modalBullets: []
    });
  },

  openModalFromTap: function (event) {
    var name = event.currentTarget.dataset.modal;
    var config = MODAL_CONTENT[name];
    if (!config) return;
    this.setData({
      modalOpen: true,
      activeModal: name,
      modalTitle: config.title,
      modalParagraphs: config.paragraphs || [],
      modalBullets: config.bullets || []
    });
  },

  closeModal: function () {
    if (!this.data.profileSaving) {
      this.setData({ modalOpen: false, activeModal: null });
    }
  },

  stopPropagation: function () {},

  onNicknameInput: function (event) {
    this.setData({ draftNickname: event.detail.value || '' });
  },

  onAvatarSelect: function (event) {
    if (!this.data.profileSaving) {
      this.setData({ draftAvatarKey: event.currentTarget.dataset.key });
    }
  },

  saveProfile: function () {
    if (this.data.profileSaving) return;
    this.setData({ profileSaving: true });
    teamService.updateSelfProfile({
      teamNickname: this.data.draftNickname,
      avatarKey: this.data.draftAvatarKey
    })
      .then(() => getApp().bootstrap({ forceRefresh: true }))
      .then(() => {
        if (!this.isActive) return;
        this.applyLocalState();
        this.setData({ modalOpen: false, activeModal: null });
        wx.showToast({ title: '个人资料已更新', icon: 'success' });
      })
      .catch((error) => {
        if (this.isActive) {
          wx.showToast({
            title: error && error.message ? error.message : '个人资料保存失败，请重试',
            icon: 'none'
          });
        }
      })
      .finally(() => {
        if (this.isActive) this.setData({ profileSaving: false });
      });
  },

  editTeamName: function () {
    if (!this.data.permission.canEditTeamName || this.data.teamNameSaving) return;
    wx.showModal({
      title: '修改团队名称',
      editable: true,
      placeholderText: '请输入2至30个字符',
      content: this.data.team.name,
      confirmText: '保存',
      confirmColor: '#078B4B',
      success: (result) => {
        if (result.confirm) this.saveTeamName(result.content || '');
      }
    });
  },

  saveTeamName: function (displayName) {
    if (this.data.teamNameSaving) return;
    this.setData({ teamNameSaving: true });
    teamService.updateDisplayName({ displayName: displayName })
      .then(() => getApp().bootstrap({ forceRefresh: true }))
      .then(() => {
        if (!this.isActive) return;
        this.applyLocalState();
        wx.showToast({ title: '团队名称已更新', icon: 'success' });
      })
      .catch((error) => {
        if (this.isActive) {
          wx.showToast({
            title: error && error.message ? error.message : '团队名称保存失败，请重试',
            icon: 'none'
          });
        }
      })
      .finally(() => {
        if (this.isActive) this.setData({ teamNameSaving: false });
      });
  },

  onQuickEntryTap: function (event) {
    var action = event.currentTarget.dataset.action;
    var disabled = event.currentTarget.dataset.disabled;
    if (disabled === true || disabled === 'true') {
      wx.showToast({ title: '当前尚未加入团队', icon: 'none' });
      return;
    }
    if (action === 'team') {
      wx.switchTab({ url: '/pages/team/team' });
      return;
    }
    if (action === 'records') {
      wx.switchTab({ url: '/pages/records/records' });
      return;
    }
    if (action === 'recycle') {
      if (!this.data.permission.canViewRecycleBin) {
        wx.showToast({ title: '你没有查看产品回收站的权限', icon: 'none' });
        return;
      }
      wx.navigateTo({ url: ROUTES.PRODUCT_RECYCLE_BIN });
      return;
    }
    if (action === 'catalogRecycle') {
      if (!this.data.permission.canViewCatalogRecycleBin) {
        wx.showToast({ title: '只有团队创建者可以查看共享目录回收站', icon: 'none' });
        return;
      }
      wx.navigateTo({ url: ROUTES.CATALOG_RECYCLE_BIN });
      return;
    }
    if (action === 'joinTeam') {
      wx.navigateTo({ url: ROUTES.TEAM_SETUP });
    }
  }
});
