const { ApiError, ERROR_CODES, isApiError } = require('../../common/errors.js');
const { COLLECTIONS, getDocument } = require('../../common/database.js');
const { createMembershipId } = require('../../common/idempotency.js');
const { requireCurrentTeamAccess, requireRole } = require('../../common/permissions.js');
const {
  validateMemberListInput,
  validateMemberReviewInput,
  validateMemberRoleInput,
  validateMemberRemoveInput,
  validateLeaveInput,
  validateMemberProfileUpdateInput,
  validateMemberAdminNoteInput
} = require('../../common/validators.js');
const {
  canViewMemberStatus,
  canLeaveTeam,
  canChangeMemberRole,
  canRemoveMember
} = require('../../common/member-utils.js');
const { getRemainingUses } = require('../../common/invite-utils.js');
const { presentMember, presentMemberOperation } = require('../../common/presenters.js');

async function requireOwnerInTransaction(transaction, user, teamId) {
  const lockedUser = await getDocument(transaction, COLLECTIONS.USERS, user._id);
  const team = await getDocument(transaction, COLLECTIONS.TEAMS, teamId);
  const membership = await getDocument(
    transaction,
    COLLECTIONS.TEAM_MEMBERS,
    createMembershipId(teamId, user._id)
  );
  if (!lockedUser || lockedUser.status !== 'active') {
    throw new ApiError(ERROR_CODES.USER_DISABLED, '当前用户不可用。');
  }
  if (!team || team.status !== 'active') {
    throw new ApiError(ERROR_CODES.TEAM_NOT_ACTIVE, '当前团队不可用。');
  }
  requireRole(membership, 'owner');
  return { user: lockedUser, team, membership };
}

async function getOwnerAccess(db, user) {
  const access = await requireCurrentTeamAccess(db, user);
  requireRole(access.membership, 'owner');
  return access;
}

async function queryMembers(db, teamId, status, role) {
  const where = { teamId, status };
  if (role) {
    where.role = role;
  }
  const result = await db.collection(COLLECTIONS.TEAM_MEMBERS)
    .where(where)
    .limit(100)
    .get();
  return result.data || [];
}

async function listMembers(db, user, rawInput) {
  const input = validateMemberListInput(rawInput);
  try {
    const access = await requireCurrentTeamAccess(db, user);
    if (input.status && !canViewMemberStatus(access.membership.role, input.status)) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, '当前角色不能查看待审核申请。');
    }
    const statuses = input.status
      ? [input.status]
      : (access.membership.role === 'owner' ? ['active', 'pending'] : ['active']);
    const groups = await Promise.all(
      statuses.map((status) => queryMembers(db, access.team._id, status, input.role))
    );
    const memberships = groups.flat();
    const canViewAdminNotes = ['owner', 'admin'].includes(access.membership.role);
    const members = (await Promise.all(memberships.map(async (membership) => {
      const memberUser = await getDocument(db, COLLECTIONS.USERS, membership.userId);
      return presentMember(membership, memberUser, user._id, {
        includeAdminNote: canViewAdminNotes
      });
    }))).filter(Boolean);
    const keyword = input.keyword.toLowerCase();
    const filtered = keyword
      ? members.filter((member) => {
        const searchable = canViewAdminNotes
          ? `${member.displayName} ${member.adminNote || ''}`
          : member.displayName;
        return searchable.toLowerCase().includes(keyword);
      })
      : members;
    return { members: filtered, total: filtered.length };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '团队成员读取失败，请稍后重试。');
  }
}

async function updateSelfProfile(db, user, rawInput) {
  const input = validateMemberProfileUpdateInput(rawInput);
  const access = await requireCurrentTeamAccess(db, user);
  try {
    await db.runTransaction(async (transaction) => {
      const lockedUser = await getDocument(transaction, COLLECTIONS.USERS, user._id);
      const lockedTeam = await getDocument(transaction, COLLECTIONS.TEAMS, access.team._id);
      const membership = await getDocument(
        transaction,
        COLLECTIONS.TEAM_MEMBERS,
        access.membership._id
      );
      if (!lockedUser || lockedUser.status !== 'active') {
        throw new ApiError(ERROR_CODES.USER_DISABLED, '当前用户不可用。');
      }
      if (!lockedTeam || lockedTeam.status !== 'active') {
        throw new ApiError(ERROR_CODES.TEAM_NOT_ACTIVE, '当前团队不可用。');
      }
      if (!membership || membership.userId !== user._id || membership.teamId !== lockedTeam._id ||
          membership.status !== 'active') {
        throw new ApiError(ERROR_CODES.MEMBERSHIP_NOT_ACTIVE, '当前团队成员关系无效。');
      }
      const update = { updatedAt: db.serverDate() };
      if (Object.prototype.hasOwnProperty.call(input, 'teamNickname')) {
        update.teamNickname = input.teamNickname;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'avatarKey')) {
        update.avatarKey = input.avatarKey;
      }
      await transaction.collection(COLLECTIONS.TEAM_MEMBERS).doc(membership._id).update({
        data: update
      });
    }, 5);
    const membership = await getDocument(db, COLLECTIONS.TEAM_MEMBERS, access.membership._id);
    return { member: presentMember(membership, user, user._id) };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '成员资料更新失败，请稍后重试。');
  }
}

async function updateAdminNote(db, user, rawInput) {
  const input = validateMemberAdminNoteInput(rawInput);
  const access = await requireCurrentTeamAccess(db, user);
  requireRole(access.membership, 'admin');
  try {
    await db.runTransaction(async (transaction) => {
      const actor = await getDocument(
        transaction,
        COLLECTIONS.TEAM_MEMBERS,
        access.membership._id
      );
      const target = await getDocument(
        transaction,
        COLLECTIONS.TEAM_MEMBERS,
        input.targetMemberId
      );
      if (!actor || actor.userId !== user._id || actor.teamId !== access.team._id) {
        throw new ApiError(ERROR_CODES.MEMBERSHIP_NOT_ACTIVE, '当前团队成员关系无效。');
      }
      requireRole(actor, 'admin');
      if (!target || target.teamId !== actor.teamId) {
        throw new ApiError(ERROR_CODES.MEMBER_NOT_FOUND, '成员不存在。');
      }
      if (target.userId === user._id) {
        throw new ApiError(ERROR_CODES.FORBIDDEN, '不能为自己填写管理备注。');
      }
      if (target.status !== 'active') {
        throw new ApiError(ERROR_CODES.MEMBERSHIP_NOT_ACTIVE, '目标成员关系无效。');
      }
      const now = db.serverDate();
      await transaction.collection(COLLECTIONS.TEAM_MEMBERS).doc(target._id).update({
        data: {
          adminNote: input.adminNote,
          adminNoteUpdatedAt: now,
          adminNoteUpdatedBy: user._id,
          updatedAt: now
        }
      });
    }, 5);
    const membership = await getDocument(db, COLLECTIONS.TEAM_MEMBERS, input.targetMemberId);
    const memberUser = await getDocument(db, COLLECTIONS.USERS, membership.userId);
    return {
      member: presentMember(membership, memberUser, user._id, { includeAdminNote: true })
    };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '管理备注更新失败，请稍后重试。');
  }
}

async function reviewMember(db, user, rawInput) {
  const input = validateMemberReviewInput(rawInput);
  const access = await getOwnerAccess(db, user);
  try {
    await db.runTransaction(async (transaction) => {
      const owner = await requireOwnerInTransaction(transaction, user, access.team._id);
      const target = await getDocument(transaction, COLLECTIONS.TEAM_MEMBERS, input.memberId);
      if (!target || target.teamId !== owner.team._id) {
        throw new ApiError(ERROR_CODES.MEMBER_NOT_FOUND, '成员不存在。');
      }
      if (target.reviewRequestKey === input.requestKey) {
        if (target.reviewDecision !== input.decision) {
          throw new ApiError(ERROR_CODES.DUPLICATE_REQUEST, '请求标识已用于其他审核结果。');
        }
        return;
      }
      if (target.status !== 'pending') {
        throw new ApiError(ERROR_CODES.MEMBERSHIP_NOT_PENDING, '该申请已不在待审核状态。');
      }

      const now = db.serverDate();
      if (input.decision === 'reject') {
        await transaction.collection(COLLECTIONS.TEAM_MEMBERS).doc(target._id).update({
          data: {
            status: 'removed',
            reviewResult: 'rejected',
            reviewRemark: input.remark,
            reviewedAt: now,
            reviewedBy: user._id,
            reviewRequestKey: input.requestKey,
            reviewDecision: input.decision,
            removedAt: now,
            removalReason: 'join_rejected',
            updatedAt: now
          }
        });
        return;
      }

      const invite = target.inviteId
        ? await getDocument(transaction, COLLECTIONS.INVITES, target.inviteId)
        : null;
      if (!invite || invite.teamId !== owner.team._id) {
        throw new ApiError(ERROR_CODES.INVITE_NOT_FOUND, '申请关联的邀请码不存在。');
      }
      if (getRemainingUses(invite) <= 0) {
        throw new ApiError(ERROR_CODES.INVITE_USAGE_EXCEEDED, '邀请码使用次数已达上限。');
      }
      const targetUser = await getDocument(transaction, COLLECTIONS.USERS, target.userId);
      if (!targetUser || targetUser.status !== 'active') {
        throw new ApiError(ERROR_CODES.USER_NOT_FOUND, '申请用户不存在或不可用。');
      }
      const activeResult = await transaction.collection(COLLECTIONS.TEAM_MEMBERS)
        .where({ userId: target.userId, status: 'active' })
        .limit(1)
        .get();
      if (activeResult.data && activeResult.data[0]) {
        throw new ApiError(ERROR_CODES.ALREADY_IN_TEAM, '申请用户已经加入其他团队。');
      }
      if (!owner.team.defaultWarehouseId) {
        throw new ApiError(ERROR_CODES.WAREHOUSE_NOT_FOUND, '默认仓库不存在。');
      }

      await transaction.collection(COLLECTIONS.TEAM_MEMBERS).doc(target._id).update({
        data: {
          status: 'active',
          role: 'viewer',
          joinedAt: now,
          reviewedAt: now,
          reviewedBy: user._id,
          reviewResult: 'approved',
          reviewRemark: input.remark,
          reviewRequestKey: input.requestKey,
          reviewDecision: input.decision,
          removedAt: null,
          removalReason: '',
          updatedAt: now
        }
      });
      await transaction.collection(COLLECTIONS.USERS).doc(target.userId).update({
        data: {
          currentTeamId: owner.team._id,
          currentWarehouseId: owner.team.defaultWarehouseId,
          updatedAt: now
        }
      });
      const nextUsedCount = Number(invite.usedCount || 0) + 1;
      await transaction.collection(COLLECTIONS.INVITES).doc(invite._id).update({
        data: {
          usedCount: nextUsedCount,
          status: nextUsedCount >= Number(invite.maxUses || 0) ? 'expired' : invite.status,
          updatedAt: now
        }
      });
    }, 5);

    const membership = await getDocument(db, COLLECTIONS.TEAM_MEMBERS, input.memberId);
    return { member: presentMemberOperation(membership) };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '成员审核失败，请稍后重试。');
  }
}

async function updateMemberRole(db, user, rawInput) {
  const input = validateMemberRoleInput(rawInput);
  const access = await getOwnerAccess(db, user);
  try {
    await db.runTransaction(async (transaction) => {
      const owner = await requireOwnerInTransaction(transaction, user, access.team._id);
      const target = await getDocument(transaction, COLLECTIONS.TEAM_MEMBERS, input.memberId);
      if (!target || target.teamId !== owner.team._id) {
        throw new ApiError(ERROR_CODES.MEMBER_NOT_FOUND, '成员不存在。');
      }
      if (target.userId === user._id || target.role === 'owner') {
        throw new ApiError(ERROR_CODES.CANNOT_CHANGE_OWNER, '不能修改团队所有者角色。');
      }
      if (target.roleUpdateRequestKey === input.requestKey) {
        if (target.roleUpdateRole !== input.role) {
          throw new ApiError(ERROR_CODES.DUPLICATE_REQUEST, '请求标识已用于其他角色变更。');
        }
        return;
      }
      if (target.status !== 'active') {
        throw new ApiError(ERROR_CODES.MEMBERSHIP_NOT_ACTIVE, '目标成员关系无效。');
      }
      if (!canChangeMemberRole(user._id, target, input.role)) {
        throw new ApiError(ERROR_CODES.INVALID_ROLE, '不允许执行该角色变更。');
      }
      const now = db.serverDate();
      await transaction.collection(COLLECTIONS.TEAM_MEMBERS).doc(target._id).update({
        data: {
          role: input.role,
          roleUpdateRequestKey: input.requestKey,
          roleUpdateRole: input.role,
          roleUpdatedBy: user._id,
          updatedAt: now
        }
      });
    }, 5);
    return { member: presentMemberOperation(await getDocument(db, COLLECTIONS.TEAM_MEMBERS, input.memberId)) };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '成员角色更新失败，请稍后重试。');
  }
}

async function removeMember(db, user, rawInput) {
  const input = validateMemberRemoveInput(rawInput);
  const access = await getOwnerAccess(db, user);
  try {
    await db.runTransaction(async (transaction) => {
      const owner = await requireOwnerInTransaction(transaction, user, access.team._id);
      const target = await getDocument(transaction, COLLECTIONS.TEAM_MEMBERS, input.memberId);
      if (!target || target.teamId !== owner.team._id) {
        throw new ApiError(ERROR_CODES.MEMBER_NOT_FOUND, '成员不存在。');
      }
      if (target.userId === user._id) {
        throw new ApiError(ERROR_CODES.CANNOT_REMOVE_SELF, '不能移除自己。');
      }
      if (target.role === 'owner') {
        throw new ApiError(ERROR_CODES.CANNOT_REMOVE_OWNER, '不能移除团队所有者。');
      }
      if (target.removeRequestKey === input.requestKey) {
        return;
      }
      if (target.status !== 'active') {
        throw new ApiError(ERROR_CODES.MEMBERSHIP_NOT_ACTIVE, '目标成员关系无效。');
      }
      if (!canRemoveMember(user._id, target)) {
        throw new ApiError(ERROR_CODES.FORBIDDEN, '当前成员不能被移除。');
      }
      const now = db.serverDate();
      await transaction.collection(COLLECTIONS.TEAM_MEMBERS).doc(target._id).update({
        data: {
          status: 'removed',
          removedAt: now,
          removalReason: input.reason,
          removeRequestKey: input.requestKey,
          removedBy: user._id,
          updatedAt: now
        }
      });
      const targetUser = await getDocument(transaction, COLLECTIONS.USERS, target.userId);
      if (targetUser && targetUser.currentTeamId === owner.team._id) {
        await transaction.collection(COLLECTIONS.USERS).doc(target.userId).update({
          data: { currentTeamId: '', currentWarehouseId: '', updatedAt: now }
        });
      }
    }, 5);
    return { member: presentMemberOperation(await getDocument(db, COLLECTIONS.TEAM_MEMBERS, input.memberId)) };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '成员移除失败，请稍后重试。');
  }
}

async function findCompletedLeave(db, userId, requestKey) {
  const result = await db.collection(COLLECTIONS.TEAM_MEMBERS)
    .where({ userId, status: 'removed' })
    .limit(100)
    .get();
  return (result.data || []).find((item) => item.leaveRequestKey === requestKey) || null;
}

async function leaveTeam(db, user, rawInput) {
  const input = validateLeaveInput(rawInput);
  try {
    const completed = await findCompletedLeave(db, user._id, input.requestKey);
    if (completed) {
      return { left: true, teamId: completed.teamId };
    }
    const access = await requireCurrentTeamAccess(db, user);
    if (!canLeaveTeam(access.membership.role)) {
      throw new ApiError(ERROR_CODES.OWNER_CANNOT_LEAVE, '团队所有者不能退出团队。');
    }
    await db.runTransaction(async (transaction) => {
      const membership = await getDocument(
        transaction,
        COLLECTIONS.TEAM_MEMBERS,
        createMembershipId(access.team._id, user._id)
      );
      const lockedUser = await getDocument(transaction, COLLECTIONS.USERS, user._id);
      if (membership && membership.leaveRequestKey === input.requestKey) {
        return;
      }
      if (!membership || membership.status !== 'active') {
        throw new ApiError(ERROR_CODES.MEMBERSHIP_NOT_ACTIVE, '当前团队成员关系无效。');
      }
      if (!canLeaveTeam(membership.role)) {
        throw new ApiError(ERROR_CODES.OWNER_CANNOT_LEAVE, '团队所有者不能退出团队。');
      }
      const now = db.serverDate();
      await transaction.collection(COLLECTIONS.TEAM_MEMBERS).doc(membership._id).update({
        data: {
          status: 'removed',
          removedAt: now,
          removalReason: 'left',
          leaveRequestKey: input.requestKey,
          updatedAt: now
        }
      });
      if (lockedUser && lockedUser.currentTeamId === access.team._id) {
        await transaction.collection(COLLECTIONS.USERS).doc(user._id).update({
          data: { currentTeamId: '', currentWarehouseId: '', updatedAt: now }
        });
      }
    }, 5);
    return { left: true, teamId: access.team._id };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '退出团队失败，请稍后重试。');
  }
}

module.exports = {
  requireOwnerInTransaction,
  listMembers,
  updateSelfProfile,
  updateAdminNote,
  reviewMember,
  updateMemberRole,
  removeMember,
  findCompletedLeave,
  leaveTeam
};
