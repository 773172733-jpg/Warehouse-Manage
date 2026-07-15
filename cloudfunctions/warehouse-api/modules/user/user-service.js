const { ApiError, ERROR_CODES, isApiError } = require('../../common/errors.js');
const { requireOpenId } = require('../../common/auth.js');
const {
  COLLECTIONS,
  getDocument
} = require('../../common/database.js');
const { createUserId } = require('../../common/idempotency.js');
const { buildBootstrapResponse } = require('../../common/presenters.js');

async function ensureUser(db, context) {
  const openId = requireOpenId(context);

  try {
    const existingResult = await db.collection(COLLECTIONS.USERS)
      .where({ openId })
      .limit(1)
      .get();
    const existingUser = existingResult.data && existingResult.data[0];
    const userId = existingUser ? existingUser._id : createUserId(openId);

    await db.runTransaction(async (transaction) => {
      const existing = await getDocument(transaction, COLLECTIONS.USERS, userId);
      const now = db.serverDate();

      if (existing) {
        if (existing.status !== 'active') {
          throw new ApiError(ERROR_CODES.USER_DISABLED, '当前用户已停用。');
        }
        await transaction.collection(COLLECTIONS.USERS).doc(userId).update({
          data: {
            lastLoginAt: now,
            updatedAt: now
          }
        });
        return { userId };
      }

      await transaction.collection(COLLECTIONS.USERS).doc(userId).set({
        data: {
          openId,
          displayName: '微信用户',
          avatarUrl: '',
          status: 'active',
          currentTeamId: '',
          currentWarehouseId: '',
          createdAt: now,
          updatedAt: now,
          lastLoginAt: now
        }
      });
      return { userId };
    }, 5);

    return getDocument(db, COLLECTIONS.USERS, userId);
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '用户初始化失败，请稍后重试。');
  }
}

async function findActiveMembership(db, user) {
  if (user.currentTeamId) {
    const currentResult = await db.collection(COLLECTIONS.TEAM_MEMBERS)
      .where({
        userId: user._id,
        teamId: user.currentTeamId,
        status: 'active'
      })
      .limit(1)
      .get();
    if (currentResult.data && currentResult.data[0]) {
      return currentResult.data[0];
    }
  }

  const result = await db.collection(COLLECTIONS.TEAM_MEMBERS)
    .where({
      userId: user._id,
      status: 'active'
    })
    .limit(1)
    .get();
  return result.data && result.data[0] ? result.data[0] : null;
}

async function findActiveWarehouse(db, user, team) {
  const preferredWarehouseId = user.currentTeamId === team._id
    ? user.currentWarehouseId
    : '';
  const warehouseId = preferredWarehouseId || team.defaultWarehouseId;

  if (!warehouseId) {
    return null;
  }
  const warehouse = await getDocument(db, COLLECTIONS.WAREHOUSES, warehouseId);
  if (!warehouse || warehouse.teamId !== team._id || warehouse.status !== 'active') {
    return null;
  }
  return warehouse;
}

async function getCurrentTeamState(db, user) {
  try {
    const membership = await findActiveMembership(db, user);
    if (!membership) {
      return { user, membership: null, team: null, warehouse: null };
    }

    const team = await getDocument(db, COLLECTIONS.TEAMS, membership.teamId);
    if (!team || team.status !== 'active') {
      return { user, membership: null, team: null, warehouse: null };
    }

    const warehouse = await findActiveWarehouse(db, user, team);
    return { user, membership, team, warehouse };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '团队状态读取失败，请稍后重试。');
  }
}

async function repairCurrentPointers(db, state) {
  const user = state.user;
  const teamId = state.team ? state.team._id : '';
  const warehouseId = state.warehouse ? state.warehouse._id : '';

  if (user.currentTeamId === teamId && user.currentWarehouseId === warehouseId) {
    return user;
  }

  try {
    await db.collection(COLLECTIONS.USERS).doc(user._id).update({
      data: {
        currentTeamId: teamId,
        currentWarehouseId: warehouseId,
        updatedAt: db.serverDate()
      }
    });
  } catch (error) {
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '用户当前团队状态修复失败，请稍后重试。');
  }

  return Object.assign({}, user, {
    currentTeamId: teamId,
    currentWarehouseId: warehouseId
  });
}

async function bootstrapCurrentUser(db, context) {
  const user = await ensureUser(db, context);
  const state = await getCurrentTeamState(db, user);
  state.user = await repairCurrentPointers(db, state);
  return buildBootstrapResponse(state);
}

module.exports = {
  ensureUser,
  getCurrentTeamState,
  bootstrapCurrentUser
};
