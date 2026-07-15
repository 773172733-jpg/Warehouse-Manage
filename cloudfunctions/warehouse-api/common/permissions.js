const { ApiError, ERROR_CODES, isApiError } = require('./errors.js');
const { COLLECTIONS, getDocument } = require('./database.js');
const { createMembershipId } = require('./idempotency.js');

const ROLE_LEVELS = {
  viewer: 10,
  admin: 20,
  owner: 30
};

function hasRole(role, requiredRole) {
  const actualLevel = ROLE_LEVELS[role] || 0;
  const requiredLevel = ROLE_LEVELS[requiredRole] || Number.MAX_SAFE_INTEGER;
  return actualLevel >= requiredLevel;
}

async function requireActiveMembership(db, userId, teamId) {
  try {
    const result = await db.collection(COLLECTIONS.TEAM_MEMBERS)
      .where({
        userId,
        teamId,
        status: 'active'
      })
      .limit(1)
      .get();
    const membership = result.data && result.data[0];

    if (!membership) {
      throw new ApiError(ERROR_CODES.MEMBERSHIP_NOT_ACTIVE, '当前团队成员关系无效。');
    }
    return membership;
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '成员关系读取失败，请稍后重试。');
  }
}

function requireRole(membership, requiredRole) {
  if (!membership || membership.status !== 'active') {
    throw new ApiError(ERROR_CODES.MEMBERSHIP_NOT_ACTIVE, '当前团队成员关系无效。');
  }
  if (!hasRole(membership.role, requiredRole)) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '当前角色无权执行此操作。');
  }
  return membership;
}

async function findActiveMembershipForUser(db, user) {
  if (user.currentTeamId) {
    const current = await getDocument(
      db,
      COLLECTIONS.TEAM_MEMBERS,
      createMembershipId(user.currentTeamId, user._id)
    );
    if (current && current.status === 'active') {
      return current;
    }
  }

  const result = await db.collection(COLLECTIONS.TEAM_MEMBERS)
    .where({ userId: user._id, status: 'active' })
    .limit(1)
    .get();
  return result.data && result.data[0] ? result.data[0] : null;
}

async function requireCurrentTeamAccess(db, user) {
  try {
    const membership = await findActiveMembershipForUser(db, user);
    if (!membership) {
      throw new ApiError(ERROR_CODES.NO_ACTIVE_TEAM, '当前尚未加入有效团队。');
    }
    const team = await getDocument(db, COLLECTIONS.TEAMS, membership.teamId);
    if (!team || team.status !== 'active') {
      throw new ApiError(ERROR_CODES.TEAM_NOT_ACTIVE, '当前团队不可用。');
    }
    const warehouse = team.defaultWarehouseId
      ? await getDocument(db, COLLECTIONS.WAREHOUSES, team.defaultWarehouseId)
      : null;
    return { membership, team, warehouse };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '团队权限读取失败，请稍后重试。');
  }
}

module.exports = {
  ROLE_LEVELS,
  hasRole,
  requireActiveMembership,
  requireRole,
  findActiveMembershipForUser,
  requireCurrentTeamAccess
};
