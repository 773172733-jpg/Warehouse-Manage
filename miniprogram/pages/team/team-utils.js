const { ERROR_CODES } = require('../../constants/errors.js');
const { createRequestKey } = require('../../utils/request-key.js');

const ROLE_META = {
  owner: { label: '创建者', className: 'owner' },
  admin: { label: '管理员', className: 'admin' },
  viewer: { label: '普通成员', className: 'viewer' }
};

const AVATAR_COLORS = ['#078B4B', '#3F7D66', '#56758A', '#8A6F4D', '#7A668B'];

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

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function getSafeText(value, fallback = '—') {
  const text = String(value || '').trim();
  return text || fallback;
}

function formatRole(role) {
  return ROLE_META[role] || { label: '未知角色', className: 'unknown' };
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

function getAvatarText(name) {
  const text = getSafeText(name, '微');
  return text.charAt(0);
}

function getAvatarColor(id) {
  const text = String(id || 'member');
  let total = 0;
  for (let index = 0; index < text.length; index += 1) {
    total += text.charCodeAt(index);
  }
  return AVATAR_COLORS[total % AVATAR_COLORS.length];
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
    avatarText: getAvatarText(name),
    avatarColor: getAvatarColor(member.id),
    role,
    roleLabel: roleMeta.label,
    roleClass: roleMeta.className,
    status,
    statusLabel: status === 'pending' ? '待审核' : '已加入',
    joinedAtText: formatDateTime(member.joinedAt),
    appliedAtText: formatDateTime(member.appliedAt),
    remark: getSafeText(member.memberRemark),
    isCurrentUser: Boolean(member.isCurrentUser)
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
      normalizeText(member.remark).includes(keyword);
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
  return {
    isOwner,
    canManageInvites: isOwner,
    canViewPending: isOwner,
    canReviewMembers: isOwner,
    canSeeReadonlyNotice: currentRole === 'admin' || currentRole === 'viewer'
  };
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

module.exports = {
  INVITE_ERROR_MESSAGES,
  REVIEW_ERROR_MESSAGES,
  formatRole,
  formatDateTime,
  mapMember,
  mapMemberResponse,
  filterMembers,
  getMemberStatistics,
  getPagePermissionFlags,
  getRoleOptions,
  mapInviteResponse,
  ensureActionIntent,
  getInviteErrorMessage,
  getReviewErrorMessage,
  getTeamLoadErrorMessage,
  shouldRefreshAfterReviewError,
  shouldReuseInviteRequestKey,
  shouldReuseReviewRequestKey,
  getSafeText
};
