var ROLE_MAP = {
  owner: { label: '创建者', className: 'owner' },
  admin: { label: '管理员', className: 'admin' },
  viewer: { label: '普通成员', className: 'viewer' }
};

function safeText(value, fallback) {
  var text = value === undefined || value === null ? '' : String(value).trim();
  return text || fallback;
}

function safeNumber(value) {
  var number = Number(value);
  if (!isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function formatRole(role) {
  return ROLE_MAP[role] || { label: '未知角色', className: 'unknown' };
}

function getPermissionFlags(role, hasTeam) {
  var normalizedRole = ROLE_MAP[role] ? role : 'unknown';
  var inTeam = Boolean(hasTeam);

  // 真实权限必须由后续云函数根据team_members验证。
  return {
    canManageTeam: inTeam && (normalizedRole === 'owner' || normalizedRole === 'admin'),
    canManageCategories: inTeam && (normalizedRole === 'owner' || normalizedRole === 'admin'),
    canManageUnits: inTeam && (normalizedRole === 'owner' || normalizedRole === 'admin'),
    canViewRecycleBin: inTeam && (normalizedRole === 'owner' || normalizedRole === 'admin'),
    canLeaveTeam: inTeam && (normalizedRole === 'admin' || normalizedRole === 'viewer'),
    canDissolveTeam: inTeam && normalizedRole === 'owner',
    canOpenTeam: inTeam,
    isViewer: normalizedRole === 'viewer'
  };
}

function normalizeSummary(summary) {
  summary = summary || {};
  return {
    productCount: safeNumber(summary.productCount),
    lowStockCount: safeNumber(summary.lowStockCount),
    outOfStockCount: safeNumber(summary.outOfStockCount),
    todayRecordCount: safeNumber(summary.todayRecordCount)
  };
}

function normalizeProfile(profile, roleOverride) {
  profile = profile || {};
  var rawUser = profile.currentUser || {};
  var rawTeam = profile.currentTeam || null;
  var role = roleOverride || rawUser.role;
  var roleInfo = formatRole(role);
  var hasTeam = Boolean(rawTeam && rawTeam.id);
  var team = hasTeam ? {
    id: safeText(rawTeam.id, ''),
    name: safeText(rawTeam.name, '暂未加入团队'),
    warehouseName: safeText(rawTeam.warehouseName, '—'),
    memberCount: safeNumber(rawTeam.memberCount),
    ownerName: safeText(rawTeam.ownerName, '—')
  } : {
    id: '',
    name: '暂未加入团队',
    warehouseName: '—',
    memberCount: 0,
    ownerName: '—'
  };

  return {
    currentUser: {
      id: safeText(rawUser.id, 'member-local'),
      name: safeText(rawUser.name, '微信用户'),
      avatarText: safeText(rawUser.avatarText, '微').slice(0, 2),
      avatarColor: safeText(rawUser.avatarColor, '#078B4B'),
      role: ROLE_MAP[role] ? role : 'unknown',
      roleLabel: roleInfo.label,
      roleClass: roleInfo.className,
      memberRemark: safeText(rawUser.memberRemark, '—'),
      joinedAt: safeText(rawUser.joinedAt, '—'),
      lastActiveAt: safeText(rawUser.lastActiveAt, '—')
    },
    currentTeam: team,
    hasTeam: hasTeam,
    summary: normalizeSummary(profile.summary),
    appInfo: {
      appName: safeText(profile.appInfo && profile.appInfo.appName, '轻仓'),
      version: safeText(profile.appInfo && profile.appInfo.version, '开发版本'),
      buildLabel: safeText(profile.appInfo && profile.appInfo.buildLabel, '本地UI原型阶段')
    }
  };
}

function cloneSettings(settings) {
  settings = settings || {};
  return {
    lowStockNotice: Boolean(settings.lowStockNotice),
    stockChangeNotice: Boolean(settings.stockChangeNotice),
    showStockStatus: settings.showStockStatus !== false,
    compactList: Boolean(settings.compactList)
  };
}

function buildSummaryItems(summary) {
  return [
    { key: 'products', label: '产品种类', value: summary.productCount, tone: 'primary', target: 'inventory' },
    { key: 'low', label: '低库存', value: summary.lowStockCount, tone: 'warning', target: 'inventory' },
    { key: 'out', label: '已缺货', value: summary.outOfStockCount, tone: 'danger', target: 'inventory' },
    { key: 'today', label: '今日记录', value: summary.todayRecordCount, tone: 'primary', target: 'records' }
  ];
}

function buildQuickEntries(permission, hasTeam) {
  var entries = [
    { key: 'team', title: '团队成员', desc: hasTeam ? '查看团队成员和权限' : '加入团队后可查看', action: 'team', disabled: !hasTeam },
    { key: 'records', title: '库存记录', desc: '查看入库、出库和调整记录', action: 'records', disabled: false }
  ];

  if (permission.canViewRecycleBin) {
    entries.push({ key: 'recycle', title: '回收站', desc: '查看和恢复已移除产品', action: 'recycle', disabled: false });
  }
  if (permission.canManageCategories) {
    entries.push({ key: 'categories', title: '分类管理', desc: '后续阶段开放', action: 'todo', disabled: false });
  }
  if (permission.canManageUnits) {
    entries.push({ key: 'units', title: '单位管理', desc: '后续阶段开放', action: 'todo', disabled: false });
  }

  if (!hasTeam) {
    entries.push({ key: 'joinTeam', title: '创建或加入团队', desc: '团队能力将在后续阶段接入', action: 'joinTeam', disabled: false });
  }

  return entries;
}

function buildSettingItems(settings, permission) {
  var noticeDesc = permission.isViewer ? '作为个人偏好预览，不会修改团队通知配置' : '库存低于设定值时提醒管理员';
  return [
    { key: 'lowStockNotice', title: '低库存提醒', desc: noticeDesc, checked: settings.lowStockNotice },
    { key: 'stockChangeNotice', title: '库存变动提醒', desc: '团队库存发生入库、出库或调整时提醒', checked: settings.stockChangeNotice },
    { key: 'showStockStatus', title: '显示库存状态标签', desc: '在产品列表中显示正常、低库存和缺货标签', checked: settings.showStockStatus },
    { key: 'compactList', title: '简洁列表模式', desc: '减少产品卡片中的辅助信息', checked: settings.compactList }
  ];
}

function buildDangerActions(permission) {
  var actions = [];
  if (permission.canLeaveTeam) {
    actions.push({ key: 'leaveTeam', title: '退出团队', danger: true });
  }
  actions.push({ key: 'logout', title: '退出当前账号', danger: true });
  if (permission.canDissolveTeam) {
    actions.push({ key: 'dissolveTeam', title: '解散团队', danger: true });
  }
  return actions;
}

module.exports = {
  formatRole: formatRole,
  normalizeProfile: normalizeProfile,
  getPermissionFlags: getPermissionFlags,
  normalizeSummary: normalizeSummary,
  cloneSettings: cloneSettings,
  buildSummaryItems: buildSummaryItems,
  buildQuickEntries: buildQuickEntries,
  buildSettingItems: buildSettingItems,
  buildDangerActions: buildDangerActions
};
