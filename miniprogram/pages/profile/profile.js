var utils = require('./profile-utils.js');
var ROUTES = require('../../constants/routes.js');

var MODAL_CONTENT = {
  profile: {
    title: '个人信息',
    type: 'profile'
  },
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
      '用户主动选择商品图片时，图片仅用于商品封面并保存到私有云存储。',
      '小程序不读取位置，不申请订阅消息，不读取剪贴板。正式隐私保护指引请以微信公众平台展示内容为准。'
    ]
  }
};

function buildProfileSource(globalData) {
  var source = globalData || {};
  var user = source.user || {};
  var membership = source.currentMembership || {};
  var team = source.currentTeam || null;
  var warehouse = source.currentWarehouse || null;
  var displayName = user.displayName || '微信用户';
  return {
    currentUser: {
      name: displayName,
      avatarText: displayName.slice(0, 1) || '微',
      avatarColor: '#078B4B',
      role: membership.role || source.currentRole || '',
      memberRemark: '—',
      joinedAt: '—'
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
    modalBullets: []
  },

  onLoad: function () {
    this.resetLocalState();
  },

  onShow: function () {
    this.resetLocalState();
  },

  resetLocalState: function () {
    var app = getApp();
    var normalized = utils.normalizeProfile(buildProfileSource(app.globalData));
    var permission = utils.getPermissionFlags(normalized.currentUser.role, normalized.hasTeam);
    this.setData({
      user: normalized.currentUser,
      team: normalized.currentTeam,
      hasTeam: normalized.hasTeam,
      permission: permission,
      quickEntries: utils.buildQuickEntries(permission, normalized.hasTeam),
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
