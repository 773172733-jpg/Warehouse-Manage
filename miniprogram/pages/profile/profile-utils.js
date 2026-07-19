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

  return {
    canManageTeam: inTeam && (normalizedRole === 'owner' || normalizedRole === 'admin'),
    canViewRecycleBin: inTeam && (normalizedRole === 'owner' || normalizedRole === 'admin'),
    canViewCatalogRecycleBin: inTeam && normalizedRole === 'owner',
    canOpenTeam: inTeam,
    isViewer: normalizedRole === 'viewer'
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
    memberCount: 0
  };

  return {
    currentUser: {
      id: safeText(rawUser.id, ''),
      name: safeText(rawUser.name, '微信用户'),
      avatarText: safeText(rawUser.avatarText, '微').slice(0, 2),
      avatarColor: safeText(rawUser.avatarColor, '#078B4B'),
      role: ROLE_MAP[role] ? role : 'unknown',
      roleLabel: roleInfo.label,
      roleClass: roleInfo.className,
      memberRemark: safeText(rawUser.memberRemark, '—'),
      joinedAt: safeText(rawUser.joinedAt, '—'),
      lastActiveAt: safeText(rawUser.lastActiveAt, '')
    },
    currentTeam: team,
    hasTeam: hasTeam,
    appInfo: {
      appName: safeText(profile.appInfo && profile.appInfo.appName, '口袋仓库Go'),
      version: safeText(profile.appInfo && profile.appInfo.version, '以微信客户端为准'),
      buildLabel: safeText(profile.appInfo && profile.appInfo.buildLabel, '团队共享库存管理')
    }
  };
}

function buildQuickEntries(permission, hasTeam) {
  var entries = [
    { key: 'team', title: '团队成员', desc: hasTeam ? '查看团队成员和权限' : '加入团队后可查看', action: 'team', disabled: !hasTeam },
    { key: 'records', title: '库存记录', desc: '查看入库、出库和调整记录', action: 'records', disabled: false }
  ];

  if (permission.canViewRecycleBin) {
    entries.push({ key: 'recycle', title: '产品回收站', desc: '查看当前仓库已移除产品', action: 'recycle', disabled: false });
  }
  if (permission.canViewCatalogRecycleBin) {
    entries.push({ key: 'catalogRecycle', title: '共享目录回收站', desc: '恢复团队已删除产品目录', action: 'catalogRecycle', disabled: false });
  }
  if (!hasTeam) {
    entries.push({ key: 'joinTeam', title: '创建或加入团队', desc: '开始使用团队库存', action: 'joinTeam', disabled: false });
  }

  return entries;
}

module.exports = {
  formatRole: formatRole,
  normalizeProfile: normalizeProfile,
  getPermissionFlags: getPermissionFlags,
  buildQuickEntries: buildQuickEntries
};
