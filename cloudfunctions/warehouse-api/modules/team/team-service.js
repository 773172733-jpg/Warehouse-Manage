const { ApiError, ERROR_CODES, isApiError } = require('../../common/errors.js');
const {
  COLLECTIONS,
  getDocument
} = require('../../common/database.js');
const {
  createTeamId,
  createWarehouseId,
  createMembershipId
} = require('../../common/idempotency.js');
const { validateTeamCreateInput } = require('../../common/validators.js');
const { getCurrentTeamState } = require('../user/user-service.js');
const { buildBootstrapResponse } = require('../../common/presenters.js');

function isCompleteExistingTeam(team, warehouse, membership, user) {
  return Boolean(
    team && team.status === 'active' &&
    warehouse && team.defaultWarehouseId === warehouse._id &&
    warehouse.teamId === team._id && warehouse.status === 'active' && warehouse.isDefault === true &&
    membership && membership.teamId === team._id && membership.userId === user._id &&
    membership.status === 'active' && membership.role === 'owner' &&
    user.currentTeamId === team._id && user.currentWarehouseId === warehouse._id
  );
}

async function assertUserCanCreateTeam(transaction, user) {
  if (!user.currentTeamId) {
    return;
  }

  const membershipId = createMembershipId(user.currentTeamId, user._id);
  const membership = await getDocument(transaction, COLLECTIONS.TEAM_MEMBERS, membershipId);
  const team = await getDocument(transaction, COLLECTIONS.TEAMS, user.currentTeamId);
  if (membership && membership.status === 'active' && team && team.status === 'active') {
    throw new ApiError(ERROR_CODES.ALREADY_IN_TEAM, '当前用户已经加入团队。');
  }
}

async function createTeam(db, user, rawInput) {
  const input = validateTeamCreateInput(rawInput);
  const teamId = createTeamId(user._id, input.requestKey);
  const warehouseId = createWarehouseId(teamId);
  const membershipId = createMembershipId(teamId, user._id);

  try {
    const initialState = await getCurrentTeamState(db, user);
    if (initialState.team && initialState.team._id !== teamId) {
      throw new ApiError(ERROR_CODES.ALREADY_IN_TEAM, '当前用户已经加入团队。');
    }

    await db.runTransaction(async (transaction) => {
      const lockedUser = await getDocument(transaction, COLLECTIONS.USERS, user._id);
      if (!lockedUser) {
        throw new ApiError(ERROR_CODES.USER_NOT_FOUND, '当前用户尚未初始化。');
      }
      if (lockedUser.status !== 'active') {
        throw new ApiError(ERROR_CODES.USER_DISABLED, '当前用户已停用。');
      }

      const existingTeam = await getDocument(transaction, COLLECTIONS.TEAMS, teamId);
      if (existingTeam) {
        const existingWarehouse = await getDocument(transaction, COLLECTIONS.WAREHOUSES, warehouseId);
        const existingMembership = await getDocument(transaction, COLLECTIONS.TEAM_MEMBERS, membershipId);
        if (existingTeam.ownerId !== user._id || existingTeam.createRequestKey !== input.requestKey) {
          throw new ApiError(ERROR_CODES.DUPLICATE_REQUEST, '请求标识已被占用。');
        }
        if (!isCompleteExistingTeam(existingTeam, existingWarehouse, existingMembership, lockedUser)) {
          throw new ApiError(ERROR_CODES.DUPLICATE_REQUEST, '团队创建记录不完整，请联系管理员处理。');
        }
        return { teamId, idempotent: true };
      }

      await assertUserCanCreateTeam(transaction, lockedUser);
      const now = db.serverDate();

      await transaction.collection(COLLECTIONS.TEAMS).doc(teamId).set({
        data: {
          name: input.name,
          ownerId: lockedUser._id,
          defaultWarehouseId: '',
          activeProductCount: 0,
          status: 'active',
          createRequestKey: input.requestKey,
          createdAt: now,
          updatedAt: now,
          deletedAt: null
        }
      });
      await transaction.collection(COLLECTIONS.WAREHOUSES).doc(warehouseId).set({
        data: {
          teamId,
          name: input.warehouseName,
          description: '',
          isDefault: true,
          status: 'active',
          createdBy: lockedUser._id,
          createdAt: now,
          updatedAt: now,
          deletedAt: null
        }
      });
      await transaction.collection(COLLECTIONS.TEAMS).doc(teamId).update({
        data: {
          defaultWarehouseId: warehouseId,
          updatedAt: now
        }
      });
      await transaction.collection(COLLECTIONS.TEAM_MEMBERS).doc(membershipId).set({
        data: {
          teamId,
          userId: lockedUser._id,
          role: 'owner',
          status: 'active',
          invitedBy: null,
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
          removedAt: null
        }
      });
      await transaction.collection(COLLECTIONS.USERS).doc(lockedUser._id).update({
        data: {
          currentTeamId: teamId,
          currentWarehouseId: warehouseId,
          updatedAt: now
        }
      });

      return { teamId, idempotent: false };
    }, 5);

    const updatedUser = await getDocument(db, COLLECTIONS.USERS, user._id);
    const state = await getCurrentTeamState(db, updatedUser);
    return buildBootstrapResponse(state);
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '团队创建失败，请稍后重试。');
  }
}

async function getCurrentTeam(db, user) {
  const state = await getCurrentTeamState(db, user);
  if (state.team && !state.warehouse) {
    throw new ApiError(ERROR_CODES.WAREHOUSE_NOT_FOUND, '默认仓库不存在。');
  }
  return buildBootstrapResponse(state);
}

module.exports = {
  createTeam,
  getCurrentTeam,
  isCompleteExistingTeam
};
