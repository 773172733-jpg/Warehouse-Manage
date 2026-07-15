var DEFAULT_SETTINGS = {
  lowStockNotice: true,
  stockChangeNotice: true,
  showStockStatus: true,
  compactList: false
};

var MOCK_PROFILE = {
  currentUser: {
    id: 'member-owner-001',
    name: '官明基',
    avatarText: '官',
    avatarColor: '#078B4B',
    role: 'owner',
    memberRemark: '负责人',
    joinedAt: '2026-07-01',
    lastActiveAt: '刚刚'
  },
  currentTeam: {
    id: 'team-light-warehouse',
    name: '轻仓设计团队',
    warehouseName: '默认仓库',
    memberCount: 8,
    ownerName: '官明基'
  },
  summary: {
    productCount: 18,
    lowStockCount: 3,
    outOfStockCount: 1,
    todayRecordCount: 5
  },
  appInfo: {
    appName: '轻仓',
    version: '0.1.0-alpha',
    buildLabel: '本地UI原型阶段'
  },
  settings: DEFAULT_SETTINGS
};

module.exports = {
  MOCK_PROFILE: MOCK_PROFILE,
  DEFAULT_SETTINGS: DEFAULT_SETTINGS
};
