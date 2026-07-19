const { getRemainingUses } = require('./invite-utils.js');
const {
  getMemberAvatarKey,
  getMemberDisplayName
} = require('./member-profile.js');

function presentUser(user) {
  return user ? {
    id: user._id,
    displayName: user.displayName || '微信用户',
    status: user.status || 'active'
  } : null;
}

function presentMembership(membership, user) {
  return membership ? {
    id: membership._id,
    teamId: membership.teamId,
    role: membership.role,
    status: membership.status,
    teamNickname: membership.teamNickname || '',
    displayName: getMemberDisplayName(membership, user),
    avatarKey: getMemberAvatarKey(membership),
    joinedAt: membership.joinedAt || null
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
    membership: hasActiveTeam ? presentMembership(source.membership, source.user) : null,
    team: hasActiveTeam ? presentTeam(source.team) : null,
    warehouse: hasActiveTeam ? presentWarehouse(source.warehouse) : null,
    onboardingRequired: !hasActiveTeam
  };
}

function presentInvite(invite) {
  if (!invite) {
    return null;
  }
  return {
    code: invite.code,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
    remainingUses: getRemainingUses(invite),
    requiresApproval: invite.requiresApproval !== false
  };
}

function presentJoinApplication(membership, team) {
  if (!membership) {
    return null;
  }
  return {
    status: membership.status,
    team: team ? { id: team._id, name: team.name, status: team.status } : null,
    appliedAt: membership.appliedAt || null,
    reviewedAt: membership.reviewedAt || null,
    reviewResult: membership.reviewResult || null
  };
}

function presentMember(membership, user, currentUserId, options) {
  if (!membership || !user) {
    return null;
  }
  const settings = options || {};
  const result = {
    id: membership._id,
    displayName: getMemberDisplayName(membership, user),
    teamNickname: membership.teamNickname || '',
    avatarKey: getMemberAvatarKey(membership),
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt || null,
    isCurrentUser: membership.userId === currentUserId
  };
  if (settings.includeAdminNote) {
    result.adminNote = membership.adminNote || '';
  }
  if (membership.status === 'pending') {
    result.appliedAt = membership.appliedAt || null;
  }
  return result;
}

function presentMemberOperation(membership) {
  return membership ? {
    id: membership._id,
    role: membership.role,
    status: membership.status,
    reviewResult: membership.reviewResult || null,
    reviewedAt: membership.reviewedAt || null,
    removedAt: membership.removedAt || null
  } : null;
}

module.exports = {
  presentUser,
  presentMembership,
  presentTeam,
  presentWarehouse,
  buildBootstrapResponse,
  presentInvite,
  presentJoinApplication,
  presentMember,
  presentMemberOperation
};
