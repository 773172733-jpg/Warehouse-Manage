const { ERROR_CODES } = require('../../constants/errors.js');
const { createRequestKey } = require('../../utils/request-key.js');
const avatarCatalog = require('../../constants/member-avatars.js');

const ROLE_META = {
  owner: {
    label: '创建者',
    className: 'owner',
    description: '团队创建者，负责成员审核与团队管理。'
  },
  admin: {
    label: '管理员',
    className: 'admin',
    description: '管理员可参与后续仓库管理，也可以主动退出团队。'
  },
  viewer: {
    label: '普通成员',
    className: 'viewer',
    description: '普通成员可查看团队数据，也可以主动退出团队。'
  }
};

const INVITE_ERROR_MESSAGES = {
  [ERROR_CODES.FORBIDDEN]: '只有团队创建者可以管理邀请码',
  [ERROR_CODES.INVALID_REQUEST_KEY]: '操作状态异常，请重新尝试',
  [ERROR_CODES.INVALID_INVITE_EXPIRY]: '邀请码有效期设置不正确',
  [ERROR_CODES.INVALID_MAX_USES]: '邀请码使用次数设置不正确',
  [ERROR_CODES.INVITE_CODE_GENERATION_FAILED]: '邀请码生成失败，请稍后重试',
  [ERROR_CODES.DATABASE_ERROR]: '服务暂时不可用，请稍后重试',
  [ERROR_CODES.CLOUD_CALL_FAILED]: '网络连接失败，请检查网络后重试',
  [ERROR_CODES.CLOUD_NOT_AVAILABLE]: '网络连接失败，请检查网络后重试'
};

const REVIEW_ERROR_MESSAGES = {
  [ERROR_CODES.FORBIDDEN]: '你没有审核成员的权限',
  [ERROR_CODES.MEMBER_NOT_FOUND]: '该申请不存在或已被处理',
  [ERROR_CODES.MEMBERSHIP_NOT_PENDING]: '该申请已处理，请刷新列表',
  [ERROR_CODES.INVALID_REVIEW_DECISION]: '审核状态不正确',
  [ERROR_CODES.DUPLICATE_REQUEST]: '该操作已经提交，请刷新查看结果',
  [ERROR_CODES.DATABASE_ERROR]: '服务暂时不可用，请稍后重试',
  [ERROR_CODES.CLOUD_CALL_FAILED]: '网络连接失败，请检查网络后重试',
  [ERROR_CODES.CLOUD_NOT_AVAILABLE]: '网络连接失败，请检查网络后重试'
};

const ROLE_ACTION_ERROR_MESSAGES = {
  [ERROR_CODES.FORBIDDEN]: '你没有修改成员角色的权限',
  [ERROR_CODES.INVALID_ROLE]: '不支持设置该角色',
  [ERROR_CODES.CANNOT_CHANGE_OWNER]: '团队创建者角色不能修改',
  [ERROR_CODES.MEMBER_NOT_FOUND]: '该成员不存在或已不属于当前团队',
  [ERROR_CODES.MEMBERSHIP_NOT_ACTIVE]: '该成员当前不是有效成员',
  [ERROR_CODES.DUPLICATE_REQUEST]: '该操作已经提交，请刷新查看结果',
  [ERROR_CODES.DATABASE_ERROR]: '服务暂时不可用，请稍后重试',
  [ERROR_CODES.INTERNAL_ERROR]: '操作失败，请稍后重试',
  [ERROR_CODES.CLOUD_CALL_FAILED]: '网络连接失败，请检查网络后重试',
  [ERROR_CODES.CLOUD_NOT_AVAILABLE]: '网络连接失败，请检查网络后重试'
};

const REMOVE_ACTION_ERROR_MESSAGES = {
  [ERROR_CODES.CANNOT_REMOVE_OWNER]: '不能移除团队创建者',
  [ERROR_CODES.CANNOT_REMOVE_SELF]: '不能将自己移出团队',
  [ERROR_CODES.MEMBER_NOT_FOUND]: '该成员不存在或已经被移除',
  [ERROR_CODES.MEMBERSHIP_NOT_ACTIVE]: '该成员当前不是有效成员',
  [ERROR_CODES.FORBIDDEN]: '你没有移除成员的权限',
  [ERROR_CODES.DUPLICATE_REQUEST]: '该操作已经提交，请刷新查看结果',
  [ERROR_CODES.DATABASE_ERROR]: '服务暂时不可用，请稍后重试',
  [ERROR_CODES.INTERNAL_ERROR]: '操作失败，请稍后重试',
  [ERROR_CODES.CLOUD_CALL_FAILED]: '网络连接失败，请检查网络后重试',
  [ERROR_CODES.CLOUD_NOT_AVAILABLE]: '网络连接失败，请检查网络后重试'
};

const LEAVE_ACTION_ERROR_MESSAGES = {
  [ERROR_CODES.OWNER_CANNOT_LEAVE]: '团队创建者暂不支持退出团队',
  [ERROR_CODES.NO_ACTIVE_TEAM]: '你当前已不在该团队中',
  [ERROR_CODES.MEMBERSHIP_NOT_ACTIVE]: '当前成员状态已发生变化',
  [ERROR_CODES.DATABASE_ERROR]: '服务暂时不可用，请稍后重试',
  [ERROR_CODES.INTERNAL_ERROR]: '操作失败，请稍后重试',
  [ERROR_CODES.CLOUD_CALL_FAILED]: '网络连接失败，请检查网络后重试',
  [ERROR_CODES.CLOUD_NOT_AVAILABLE]: '网络连接失败，请检查网络后重试'
};

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function getSafeText(value, fallback = '—') {
  const text = String(value || '').trim();
  return text || fallback;
}

function formatRole(role) {
  return ROLE_META[role] || {
    label: '未知角色',
    className: 'unknown',
    description: '当前角色信息暂不可用。'
  };
}

function formatDateTime(value) {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function mapMember(member, expectedStatus) {
  if (!member || !member.id) {
    return null;
  }
  const status = member.status || '';
  if (expectedStatus && status !== expectedStatus) {
    return null;
  }
  const role = ['owner', 'admin', 'viewer'].includes(member.role) ? member.role : 'viewer';
  const roleMeta = formatRole(role);
  const name = getSafeText(member.displayName, '微信用户');

  return {
    id: String(member.id),
    name,
    teamNickname: member.teamNickname || '',
    avatarKey: avatarCatalog.normalizeAvatarKey(member.avatarKey, member.id),
    avatarPath: avatarCatalog.getAvatarPath(member.avatarKey, member.id),
    role,
    roleLabel: roleMeta.label,
    roleClass: roleMeta.className,
    roleDescription: roleMeta.description,
    status,
    statusLabel: status === 'pending' ? '待审核' : '已加入',
    joinedAtText: formatDateTime(member.joinedAt),
    appliedAtText: formatDateTime(member.appliedAt),
    isCurrentUser: Boolean(member.isCurrentUser),
    hasAdminNoteAccess: Object.prototype.hasOwnProperty.call(member, 'adminNote'),
    adminNote: Object.prototype.hasOwnProperty.call(member, 'adminNote') ? member.adminNote : ''
  };
}

function mapMemberResponse(response, expectedStatus) {
  const members = response && Array.isArray(response.members) ? response.members : [];
  return members.map((member) => mapMember(member, expectedStatus)).filter(Boolean);
}

function filterMembers(members, filters = {}) {
  const keyword = normalizeText(filters.keyword);
  const role = filters.role || 'all';
  return members.filter((member) => {
    const matchesKeyword = !keyword ||
      normalizeText(member.name).includes(keyword) ||
      normalizeText(member.adminNote).includes(keyword);
    const matchesRole = role === 'all' || member.role === role;
    return matchesKeyword && matchesRole;
  });
}

function getMemberStatistics(activeMembers, pendingMembers, isOwner) {
  const stats = { all: activeMembers.length, owner: 0, admin: 0, viewer: 0, pending: 0 };
  activeMembers.forEach((member) => {
    if (Object.prototype.hasOwnProperty.call(stats, member.role)) {
      stats[member.role] += 1;
    }
  });
  stats.pending = isOwner ? pendingMembers.length : 0;
  return stats;
}

function getPagePermissionFlags(currentRole) {
  const isOwner = currentRole === 'owner';
  const canLeaveTeam = currentRole === 'admin' || currentRole === 'viewer';
  const canManageAdminNotes = currentRole === 'owner' || currentRole === 'admin';
  return {
    isOwner,
    canManageInvites: isOwner,
    canViewPending: isOwner,
    canReviewMembers: isOwner,
    canManageMembers: isOwner,
    canManageAdminNotes,
    canEditTeamName: isOwner,
    canLeaveTeam,
    canSeeReadonlyNotice: canLeaveTeam
  };
}

function getMemberDetailActions(currentRole, member) {
  const manageable = Boolean(
    currentRole === 'owner' && member && member.status === 'active' &&
    !member.isCurrentUser && ['admin', 'viewer'].includes(member.role)
  );
  const targetRole = manageable && member.role === 'viewer' ? 'admin' :
    (manageable && member.role === 'admin' ? 'viewer' : '');
  const actions = {
    canChangeRole: Boolean(targetRole),
    canRemove: manageable,
    targetRole,
    roleActionLabel: targetRole === 'admin' ? '设为管理员' :
      (targetRole === 'viewer' ? '取消管理员' : ''),
    isOwnerSelf: Boolean(member && member.isCurrentUser && member.role === 'owner')
  };
  if (member && member.status === 'active' && !member.isCurrentUser &&
      ['owner', 'admin'].includes(currentRole)) {
    actions.canEditAdminNote = true;
  }
  return actions;
}

function getRoleOptions() {
  return [
    { value: 'all', label: '全部' },
    { value: 'owner', label: '创建者' },
    { value: 'admin', label: '管理员' },
    { value: 'viewer', label: '普通成员' }
  ];
}

function mapInviteResponse(response) {
  const invite = response && response.invite;
  if (!invite || !invite.code) {
    return {
      hasInvite: false,
      code: '',
      expiresAtText: '—',
      usedCount: 0,
      maxUses: 0,
      remainingUses: 0,
      requiresApproval: true,
      approvalLabel: '需要审核'
    };
  }
  const maxUses = Number(invite.maxUses || 0);
  const usedCount = Number(invite.usedCount || 0);
  const remainingUses = Number.isFinite(Number(invite.remainingUses))
    ? Number(invite.remainingUses)
    : Math.max(0, maxUses - usedCount);
  return {
    hasInvite: true,
    code: String(invite.code),
    expiresAtText: formatDateTime(invite.expiresAt),
    usedCount,
    maxUses,
    remainingUses,
    requiresApproval: invite.requiresApproval !== false,
    approvalLabel: invite.requiresApproval === false ? '无需审核' : '需要审核'
  };
}

function ensureActionIntent(signature, currentIntent, prefix, keyFactory = createRequestKey) {
  if (currentIntent && currentIntent.signature === signature && currentIntent.requestKey) {
    return currentIntent;
  }
  return {
    signature,
    requestKey: keyFactory(prefix)
  };
}

function getInviteErrorMessage(error) {
  return INVITE_ERROR_MESSAGES[error && error.code] || '邀请码操作失败，请稍后重试';
}

function getReviewErrorMessage(error) {
  return REVIEW_ERROR_MESSAGES[error && error.code] || '审核操作失败，请稍后重试';
}

function getMembershipActionErrorMessage(action, error) {
  const mappings = {
    role: ROLE_ACTION_ERROR_MESSAGES,
    remove: REMOVE_ACTION_ERROR_MESSAGES,
    leave: LEAVE_ACTION_ERROR_MESSAGES
  };
  const fallback = action === 'leave' ? '退出团队失败，请稍后重试' : '操作失败，请稍后重试';
  const messages = mappings[action] || {};
  return messages[error && error.code] || fallback;
}

function getTeamLoadErrorMessage(error) {
  if (error && [ERROR_CODES.CLOUD_CALL_FAILED, ERROR_CODES.CLOUD_NOT_AVAILABLE].includes(error.code)) {
    return '网络连接失败，请检查网络后重试';
  }
  if (error && error.code === ERROR_CODES.DATABASE_ERROR) {
    return '服务暂时不可用，请稍后重试';
  }
  return '团队数据加载失败，请稍后重试';
}

function shouldRefreshAfterReviewError(error) {
  return Boolean(error && [
    ERROR_CODES.MEMBER_NOT_FOUND,
    ERROR_CODES.MEMBERSHIP_NOT_PENDING,
    ERROR_CODES.DUPLICATE_REQUEST
  ].includes(error.code));
}

function shouldReuseInviteRequestKey(error) {
  return Boolean(error && [
    ERROR_CODES.CLOUD_CALL_FAILED,
    ERROR_CODES.DATABASE_ERROR,
    ERROR_CODES.INTERNAL_ERROR
  ].includes(error.code));
}

function shouldReuseReviewRequestKey(error) {
  return Boolean(error && [
    ERROR_CODES.CLOUD_CALL_FAILED,
    ERROR_CODES.DATABASE_ERROR,
    ERROR_CODES.INTERNAL_ERROR
  ].includes(error.code));
}

function shouldReuseMembershipRequestKey(error) {
  return Boolean(error && [
    ERROR_CODES.CLOUD_CALL_FAILED,
    ERROR_CODES.DATABASE_ERROR,
    ERROR_CODES.INTERNAL_ERROR
  ].includes(error.code));
}

function shouldRefreshAfterMembershipActionError(error) {
  return Boolean(error && [
    ERROR_CODES.CLOUD_CALL_FAILED,
    ERROR_CODES.DATABASE_ERROR,
    ERROR_CODES.INTERNAL_ERROR,
    ERROR_CODES.DUPLICATE_REQUEST,
    ERROR_CODES.MEMBER_NOT_FOUND,
    ERROR_CODES.MEMBERSHIP_NOT_ACTIVE,
    ERROR_CODES.NO_ACTIVE_TEAM
  ].includes(error.code));
}

function isMembershipContextInvalid(error) {
  return Boolean(error && [
    ERROR_CODES.NO_ACTIVE_TEAM,
    ERROR_CODES.MEMBERSHIP_NOT_ACTIVE,
    ERROR_CODES.TEAM_NOT_ACTIVE
  ].includes(error.code));
}

module.exports = {
  INVITE_ERROR_MESSAGES,
  REVIEW_ERROR_MESSAGES,
  ROLE_ACTION_ERROR_MESSAGES,
  REMOVE_ACTION_ERROR_MESSAGES,
  LEAVE_ACTION_ERROR_MESSAGES,
  formatRole,
  formatDateTime,
  mapMember,
  mapMemberResponse,
  filterMembers,
  getMemberStatistics,
  getPagePermissionFlags,
  getMemberDetailActions,
  getRoleOptions,
  mapInviteResponse,
  ensureActionIntent,
  getInviteErrorMessage,
  getReviewErrorMessage,
  getMembershipActionErrorMessage,
  getTeamLoadErrorMessage,
  shouldRefreshAfterReviewError,
  shouldReuseInviteRequestKey,
  shouldReuseReviewRequestKey,
  shouldReuseMembershipRequestKey,
  shouldRefreshAfterMembershipActionError,
  isMembershipContextInvalid,
  getSafeText
};
