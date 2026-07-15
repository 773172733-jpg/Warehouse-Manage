const ROLES = require('../constants/roles.js');

const VALID_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.VIEWER];

function cleanUser(user) {
  if (!user || !user.id) {
    return null;
  }
  return {
    id: String(user.id),
    displayName: user.displayName || '微信用户',
    avatarUrl: user.avatarUrl || '',
    status: user.status || 'active'
  };
}

function cleanMembership(membership) {
  if (!membership || !membership.teamId || !VALID_ROLES.includes(membership.role)) {
    return null;
  }
  return {
    teamId: String(membership.teamId),
    role: membership.role,
    status: membership.status || 'active'
  };
}

function cleanTeam(team) {
  if (!team || !team.id) {
    return null;
  }
  return {
    id: String(team.id),
    name: team.name || '未命名团队',
    status: team.status || 'active'
  };
}

function cleanWarehouse(warehouse) {
  if (!warehouse || !warehouse.id) {
    return null;
  }
  return {
    id: String(warehouse.id),
    name: warehouse.name || '默认仓库',
    isDefault: Boolean(warehouse.isDefault),
    status: warehouse.status || 'active'
  };
}

function normalizeBootstrapResult(result) {
  const source = result && typeof result === 'object' ? result : {};
  const user = cleanUser(source.user);
  const membership = cleanMembership(source.membership);
  const team = cleanTeam(source.team);
  const warehouse = cleanWarehouse(source.warehouse);
  const hasActiveTeam = Boolean(
    membership && membership.status === 'active' &&
    team && team.status === 'active' &&
    membership.teamId === team.id
  );

  return {
    user,
    membership: hasActiveTeam ? membership : null,
    team: hasActiveTeam ? team : null,
    warehouse: hasActiveTeam && warehouse && warehouse.status === 'active' ? warehouse : null,
    onboardingRequired: !hasActiveTeam
  };
}

function normalizeRequiredBootstrapResult(result) {
  const normalized = normalizeBootstrapResult(result);
  if (!normalized.user) {
    const error = new Error('云端未返回有效用户信息。');
    error.code = 'BOOTSTRAP_FAILED';
    throw error;
  }
  return normalized;
}

module.exports = {
  normalizeBootstrapResult,
  normalizeRequiredBootstrapResult
};
