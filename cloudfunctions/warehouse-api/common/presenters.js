function presentUser(user) {
  return user ? {
    id: user._id,
    displayName: user.displayName || '微信用户',
    avatarUrl: user.avatarUrl || '',
    status: user.status || 'active'
  } : null;
}

function presentMembership(membership) {
  return membership ? {
    teamId: membership.teamId,
    role: membership.role,
    status: membership.status
  } : null;
}

function presentTeam(team) {
  return team ? {
    id: team._id,
    name: team.name,
    status: team.status
  } : null;
}

function presentWarehouse(warehouse) {
  return warehouse ? {
    id: warehouse._id,
    name: warehouse.name,
    isDefault: Boolean(warehouse.isDefault),
    status: warehouse.status
  } : null;
}

function buildBootstrapResponse(state) {
  const source = state || {};
  const hasActiveTeam = Boolean(
    source.membership && source.membership.status === 'active' &&
    source.team && source.team.status === 'active' &&
    source.membership.teamId === source.team._id
  );

  return {
    user: presentUser(source.user),
    membership: hasActiveTeam ? presentMembership(source.membership) : null,
    team: hasActiveTeam ? presentTeam(source.team) : null,
    warehouse: hasActiveTeam ? presentWarehouse(source.warehouse) : null,
    onboardingRequired: !hasActiveTeam
  };
}

module.exports = {
  presentUser,
  presentMembership,
  presentTeam,
  presentWarehouse,
  buildBootstrapResponse
};
