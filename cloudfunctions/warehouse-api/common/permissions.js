const { ApiError, ERROR_CODES, isApiError } = require('./errors.js');
const { COLLECTIONS } = require('./database.js');

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
    throw new ApiError(ERROR_CODES.MEMBERSHIP_NOT_ACTIVE, '当前角色无权执行此操作。');
  }
  return membership;
}

module.exports = {
  ROLE_LEVELS,
  hasRole,
  requireActiveMembership,
  requireRole
};
