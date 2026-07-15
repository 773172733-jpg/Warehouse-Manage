var mock = require('./mock-profile.js');
var utils = require('./profile-utils.js');

var CURRENT_ROLE = 'owner';

var MODAL_CONTENT = {
  profile: {
    title: '个人信息',
    type: 'profile'
  },
  notice: {
    title: '通知功能说明',
    paragraphs: [
      '当前版本尚未接入微信订阅消息。',
      '后续会根据管理员权限和团队设置接入。',
      '当前开关只用于UI预览，不会产生真实通知。'
    ]
  },
  help: {
    title: '使用帮助',
    bullets: ['搜索产品', '查看库存', '管理员入库出库', '查看记录', '团队权限']
  },
  about: {
    title: '关于轻仓',
    type: 'about'
  },
  privacy: {
    title: '隐私说明',
    paragraphs: [
      '当前本地原型不上传个人资料、产品或库存数据。',
      '后续云端版本会在正式上线前补充隐私政策。'
    ]
  }
};

function getActionConfig(action, teamName) {
  if (action === 'leaveTeam') {
    return {
      title: '退出团队',
      content: '确认退出“' + teamName + '”？退出后将无法继续查看团队库存。',
      confirmText: '退出'
    };
  }
  if (action === 'dissolveTeam') {
    return {
      title: '解散团队',
      content: '确认解散“' + teamName + '”？团队、产品和库存记录将无法继续使用。',
      confirmText: '解散'
    };
  }
  if (action === 'logout') {
    return {
      title: '退出当前账号',
      content: '确认退出当前登录状态？',
      confirmText: '退出'
    };
  }
  return null;
}

Page({
  data: {
    user: {},
    team: {},
    hasTeam: false,
    permission: {},
    summaryItems: [],
    quickEntries: [],
    settings: {},
    settingItems: [],
    dangerActions: [],
    appInfo: {},
    modalOpen: false,
    activeModal: null,
    modalTitle: '',
    modalParagraphs: [],
    modalBullets: []
  },

  onLoad: function () {
    this.resetLocalState();
  },

  onShow: function () {
    this.resetLocalState();
  },

  resetLocalState: function () {
    var normalized = utils.normalizeProfile(mock.MOCK_PROFILE, CURRENT_ROLE);
    var permission = utils.getPermissionFlags(normalized.currentUser.role, normalized.hasTeam);
    var settings = utils.cloneSettings(mock.DEFAULT_SETTINGS);
    this.setData({
      user: normalized.currentUser,
      team: normalized.currentTeam,
      hasTeam: normalized.hasTeam,
      permission: permission,
      summaryItems: utils.buildSummaryItems(normalized.summary),
      quickEntries: utils.buildQuickEntries(permission, normalized.hasTeam),
      settings: settings,
      settingItems: utils.buildSettingItems(settings, permission),
      dangerActions: utils.buildDangerActions(permission),
      appInfo: normalized.appInfo,
      modalOpen: false,
      activeModal: null
    });
  },

  openProfileModal: function () {
    this.openModal('profile');
  },

  openModalFromTap: function (event) {
    this.openModal(event.currentTarget.dataset.modal);
  },

  openModal: function (name) {
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
    this.setData({ modalOpen: false, activeModal: null });
  },

  stopPropagation: function () {},

  editProfilePlaceholder: function () {
    wx.showToast({ title: '个人资料编辑将在后续账号系统接入', icon: 'none' });
  },

  onSummaryTap: function (event) {
    var target = event.currentTarget.dataset.target;
    if (target === 'records') {
      wx.switchTab({ url: '/pages/records/records' });
      return;
    }
    wx.switchTab({ url: '/pages/inventory/inventory' });
  },

  onQuickEntryTap: function (event) {
    var action = event.currentTarget.dataset.action;
    var disabled = event.currentTarget.dataset.disabled;
    if (disabled === true || disabled === 'true') {
      wx.showToast({ title: '团队能力将在后续阶段接入', icon: 'none' });
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
    wx.showToast({ title: '该功能将在后续阶段开放', icon: 'none' });
  },

  onSettingChange: function (event) {
    var key = event.currentTarget.dataset.key;
    if (!Object.prototype.hasOwnProperty.call(this.data.settings, key)) return;
    var settings = utils.cloneSettings(this.data.settings);
    settings[key] = Boolean(event.detail.value);
    this.setData({
      settings: settings,
      settingItems: utils.buildSettingItems(settings, this.data.permission)
    });
  },

  onFeedbackTap: function () {
    wx.showToast({ title: '反馈功能将在后续版本接入', icon: 'none' });
  },

  onDangerTap: function (event) {
    var action = event.currentTarget.dataset.action;
    if (action === 'leaveTeam' && this.data.user.role === 'owner') {
      wx.showToast({ title: '创建者需先转让团队或解散团队', icon: 'none' });
      return;
    }

    var config = getActionConfig(action, this.data.team.name || '当前团队');
    if (!config) return;

    wx.showModal({
      title: config.title,
      content: config.content,
      confirmText: config.confirmText,
      confirmColor: '#D94A45',
      success: function (res) {
        if (!res.confirm) return;
        wx.showToast({ title: '账号与团队操作将在后续云端功能接入，本次未真实修改数据', icon: 'none' });
      }
    });
  }
});
