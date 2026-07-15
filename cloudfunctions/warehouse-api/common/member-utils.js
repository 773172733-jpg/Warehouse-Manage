function canViewMemberStatus(role, status) {
  if (status === 'active') {
    return ['owner', 'admin', 'viewer'].includes(role);
  }
  return role === 'owner' && status === 'pending';
}

function isRoleTransitionAllowed(currentRole, targetRole) {
  if (!['admin', 'viewer'].includes(currentRole)) {
    return false;
  }
  return ['admin', 'viewer'].includes(targetRole);
}

function canLeaveTeam(role) {
  return role === 'admin' || role === 'viewer';
}

function canChangeMemberRole(actorUserId, membership, targetRole) {
  return Boolean(
    membership && membership.status === 'active' &&
    membership.userId !== actorUserId &&
    isRoleTransitionAllowed(membership.role, targetRole)
  );
}

function canRemoveMember(actorUserId, membership) {
  return Boolean(
    membership && membership.status === 'active' &&
    membership.userId !== actorUserId &&
    ['admin', 'viewer'].includes(membership.role)
  );
}

module.exports = {
  canViewMemberStatus,
  isRoleTransitionAllowed,
  canLeaveTeam,
  canChangeMemberRole,
  canRemoveMember
};
