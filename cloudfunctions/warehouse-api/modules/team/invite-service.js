const { ApiError, ERROR_CODES, isApiError } = require('../../common/errors.js');
const { COLLECTIONS, getDocument } = require('../../common/database.js');
const { createInviteId, createMembershipId } = require('../../common/idempotency.js');
const { requireCurrentTeamAccess, requireRole } = require('../../common/permissions.js');
const {
  validateInviteRefreshInput,
  validateJoinApplyInput
} = require('../../common/validators.js');
const {
  generateInviteCode,
  isInviteExpired,
  isInviteUsable,
  getRemainingUses
} = require('../../common/invite-utils.js');
const { presentInvite, presentJoinApplication } = require('../../common/presenters.js');

const INVITE_CODE_ATTEMPTS = 5;

function throwInviteUnavailable(invite, now = Date.now()) {
  if (!invite) {
    throw new ApiError(ERROR_CODES.INVITE_NOT_FOUND, '邀请码不存在。');
  }
  if (invite.status === 'revoked') {
    throw new ApiError(ERROR_CODES.INVITE_REVOKED, '邀请码已撤销。');
  }
  if (invite.status !== 'active' || isInviteExpired(invite, now)) {
    throw new ApiError(ERROR_CODES.INVITE_EXPIRED, '邀请码已过期。');
  }
  if (getRemainingUses(invite) <= 0) {
    throw new ApiError(ERROR_CODES.INVITE_USAGE_EXCEEDED, '邀请码使用次数已达上限。');
  }
}

async function getOwnerContext(db, user) {
  const access = await requireCurrentTeamAccess(db, user);
  requireRole(access.membership, 'owner');
  return access;
}

async function findInviteByCode(source, code) {
  const result = await source.collection(COLLECTIONS.INVITES)
    .where({ code })
    .limit(1)
    .get();
  return result.data && result.data[0] ? result.data[0] : null;
}

async function getCurrentInvite(db, user) {
  try {
    const access = await getOwnerContext(db, user);
    const result = await db.collection(COLLECTIONS.INVITES)
      .where({ teamId: access.team._id, status: 'active' })
      .limit(20)
      .get();
    const invite = (result.data || []).find((item) => isInviteUsable(item));
    return { invite: presentInvite(invite || null) };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '邀请码读取失败，请稍后重试。');
  }
}

async function refreshInvite(db, user, rawInput) {
  const input = validateInviteRefreshInput(rawInput);
  const access = await getOwnerContext(db, user);
  const inviteId = createInviteId(access.team._id, user._id, input.requestKey);
  const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);

  for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt += 1) {
    const code = generateInviteCode();
    try {
      await db.runTransaction(async (transaction) => {
        const lockedUser = await getDocument(transaction, COLLECTIONS.USERS, user._id);
        const lockedTeam = await getDocument(transaction, COLLECTIONS.TEAMS, access.team._id);
        const ownerMembership = await getDocument(
          transaction,
          COLLECTIONS.TEAM_MEMBERS,
          createMembershipId(access.team._id, user._id)
        );
        if (!lockedUser || lockedUser.status !== 'active' || !lockedTeam || lockedTeam.status !== 'active') {
          throw new ApiError(ERROR_CODES.TEAM_NOT_ACTIVE, '当前团队不可用。');
        }
        requireRole(ownerMembership, 'owner');

        const existingRequest = await getDocument(transaction, COLLECTIONS.INVITES, inviteId);
        if (existingRequest) {
          if (existingRequest.teamId !== lockedTeam._id || existingRequest.createdBy !== user._id ||
              existingRequest.requestKey !== input.requestKey) {
            throw new ApiError(ERROR_CODES.DUPLICATE_REQUEST, '请求标识已被占用。');
          }
          return;
        }

        const codeCollision = await findInviteByCode(transaction, code);
        if (codeCollision) {
          const collision = new Error('INVITE_CODE_COLLISION');
          collision.isInviteCodeCollision = true;
          throw collision;
        }

        const activeResult = await transaction.collection(COLLECTIONS.INVITES)
          .where({ teamId: lockedTeam._id, status: 'active' })
          .limit(100)
          .get();
        const now = db.serverDate();
        for (const activeInvite of activeResult.data || []) {
          await transaction.collection(COLLECTIONS.INVITES).doc(activeInvite._id).update({
            data: { status: 'revoked', revokedAt: now, updatedAt: now }
          });
        }

        await transaction.collection(COLLECTIONS.INVITES).doc(inviteId).set({
          data: {
            teamId: lockedTeam._id,
            code,
            status: 'active',
            createdBy: user._id,
            expiresAt,
            maxUses: input.maxUses,
            usedCount: 0,
            requiresApproval: true,
            requestKey: input.requestKey,
            createdAt: now,
            updatedAt: now,
            revokedAt: null
          }
        });
        await transaction.collection(COLLECTIONS.TEAMS).doc(lockedTeam._id).update({
          data: { activeInviteId: inviteId, updatedAt: now }
        });
      }, 5);

      const invite = await getDocument(db, COLLECTIONS.INVITES, inviteId);
      return { invite: presentInvite(invite) };
    } catch (error) {
      if (error && error.isInviteCodeCollision) {
        continue;
      }
      if (isApiError(error)) {
        throw error;
      }
      const message = error && (error.errMsg || error.message || '');
      if (/INVITE_CODE_COLLISION|duplicate|unique|conflict/i.test(message)) {
        continue;
      }
      throw new ApiError(ERROR_CODES.DATABASE_ERROR, '邀请码刷新失败，请稍后重试。');
    }
  }

  throw new ApiError(ERROR_CODES.INVITE_CODE_GENERATION_FAILED, '邀请码生成失败，请稍后重试。');
}

async function applyToJoin(db, user, rawInput) {
  const input = validateJoinApplyInput(rawInput);
  try {
    const initialInvite = await findInviteByCode(db, input.code);
    throwInviteUnavailable(initialInvite);
    const membershipId = createMembershipId(initialInvite.teamId, user._id);

    await db.runTransaction(async (transaction) => {
      const lockedUser = await getDocument(transaction, COLLECTIONS.USERS, user._id);
      if (!lockedUser) {
        throw new ApiError(ERROR_CODES.USER_NOT_FOUND, '当前用户尚未初始化。');
      }
      if (lockedUser.status !== 'active') {
        throw new ApiError(ERROR_CODES.USER_DISABLED, '当前用户已停用。');
      }
      const invite = await getDocument(transaction, COLLECTIONS.INVITES, initialInvite._id);
      throwInviteUnavailable(invite);
      const team = await getDocument(transaction, COLLECTIONS.TEAMS, invite.teamId);
      if (!team || team.status !== 'active') {
        throw new ApiError(ERROR_CODES.TEAM_NOT_ACTIVE, '邀请码所属团队不可用。');
      }

      const activeResult = await transaction.collection(COLLECTIONS.TEAM_MEMBERS)
        .where({ userId: user._id, status: 'active' })
        .limit(1)
        .get();
      if ((activeResult.data && activeResult.data[0]) || lockedUser.currentTeamId) {
        throw new ApiError(ERROR_CODES.ALREADY_IN_TEAM, '你已经加入有效团队。');
      }

      const existing = await getDocument(transaction, COLLECTIONS.TEAM_MEMBERS, membershipId);
      if (existing && existing.status === 'active') {
        throw new ApiError(ERROR_CODES.ALREADY_IN_TEAM, '你已经加入该团队。');
      }
      if (existing && existing.status === 'pending') {
        return;
      }
      if (existing && existing.status === 'removed' && existing.applyRequestKey === input.requestKey) {
        return;
      }

      const now = db.serverDate();
      const membershipData = {
        teamId: team._id,
        userId: user._id,
        role: 'viewer',
        status: 'pending',
        memberRemark: '',
        applyRequestKey: input.requestKey,
        appliedAt: now,
        inviteId: invite._id,
        reviewedAt: null,
        reviewedBy: null,
        reviewResult: null,
        reviewRemark: '',
        joinedAt: null,
        removedAt: null,
        removalReason: '',
        updatedAt: now
      };
      if (existing) {
        await transaction.collection(COLLECTIONS.TEAM_MEMBERS).doc(membershipId).update({
          data: membershipData
        });
      } else {
        membershipData.createdAt = now;
        membershipData.invitedBy = null;
        await transaction.collection(COLLECTIONS.TEAM_MEMBERS).doc(membershipId).set({
          data: membershipData
        });
      }
    }, 5);

    const membership = await getDocument(db, COLLECTIONS.TEAM_MEMBERS, membershipId);
    const team = await getDocument(db, COLLECTIONS.TEAMS, initialInvite.teamId);
    return { application: presentJoinApplication(membership, team) };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '加入申请提交失败，请稍后重试。');
  }
}

async function getJoinStatus(db, user) {
  try {
    const activeResult = await db.collection(COLLECTIONS.TEAM_MEMBERS)
      .where({ userId: user._id, status: 'active' })
      .limit(1)
      .get();
    let membership = activeResult.data && activeResult.data[0];
    if (!membership) {
      const latestResult = await db.collection(COLLECTIONS.TEAM_MEMBERS)
        .where({ userId: user._id })
        .orderBy('updatedAt', 'desc')
        .limit(1)
        .get();
      membership = latestResult.data && latestResult.data[0];
    }
    if (!membership) {
      return { application: null };
    }
    const team = await getDocument(db, COLLECTIONS.TEAMS, membership.teamId);
    return { application: presentJoinApplication(membership, team) };
  } catch (error) {
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '加入申请状态读取失败，请稍后重试。');
  }
}

module.exports = {
  INVITE_CODE_ATTEMPTS,
  throwInviteUnavailable,
  findInviteByCode,
  getCurrentInvite,
  refreshInvite,
  applyToJoin,
  getJoinStatus
};
