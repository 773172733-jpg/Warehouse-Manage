var ROLE_META = {
  owner: { label: '创建者', className: 'owner' },
  admin: { label: '管理员', className: 'admin' },
  viewer: { label: '普通成员', className: 'viewer' }
};

var STATUS_META = {
  active: { label: '已加入', className: 'active' },
  pending: { label: '待审核', className: 'pending' },
  removed: { label: '已移除', className: 'removed' }
};

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function formatRole(role) {
  return ROLE_META[role] || { label: '未知角色', className: 'unknown' };
}

function formatMemberStatus(status) {
  return STATUS_META[status] || { label: '状态未知', className: 'unknown' };
}

function getSafeText(value) {
  var text = String(value || '').trim();
  return text || '—';
}

function getPermissionFlags(currentRole, member) {
  var isOwnerUser = currentRole === 'owner';
  var isAdminUser = currentRole === 'admin';
  var targetIsOwner = member.role === 'owner';
  var targetIsCurrentUser = Boolean(member.isCurrentUser);
  var targetIsPending = member.status === 'pending';

  // These flags are UI hints only. Real permissions must be verified by later cloud functions.
  return {
    canManageMember: isOwnerUser && !targetIsCurrentUser,
    canChangeRole: isOwnerUser && !targetIsCurrentUser && !targetIsOwner && !targetIsPending,
    canRemoveMember: isOwnerUser && !targetIsCurrentUser && !targetIsOwner && !targetIsPending,
    canApproveMember: isOwnerUser && targetIsPending,
    canEditRemark: (isOwnerUser || isAdminUser) && !targetIsOwner && !targetIsPending
  };
}

function decorateMember(member, currentRole) {
  var roleMeta = formatRole(member.role);
  var statusMeta = formatMemberStatus(member.status);
  var permission = getPermissionFlags(currentRole, member);

  return {
    id: member.id,
    name: getSafeText(member.name),
    avatarText: getSafeText(member.avatarText),
    avatarColor: member.avatarColor || '#8A9690',
    role: member.role,
    roleLabel: roleMeta.label,
    roleClass: roleMeta.className,
    status: member.status,
    statusLabel: statusMeta.label,
    statusClass: statusMeta.className,
    joinedAt: getSafeText(member.joinedAt),
    lastActiveAt: getSafeText(member.lastActiveAt),
    remark: getSafeText(member.remark),
    rawRemark: member.remark || '',
    isCurrentUser: Boolean(member.isCurrentUser),
    canManage: permission.canManageMember,
    canChangeRole: permission.canChangeRole,
    canRemove: permission.canRemoveMember,
    canApprove: permission.canApproveMember,
    canEditRemark: permission.canEditRemark
  };
}

function filterMembers(members, filters) {
  var keyword = normalizeText(filters.keyword);
  var roleFilter = filters.role || 'all';

  return members.filter(function (member) {
    var matchKeyword = true;
    var matchRole = true;

    if (keyword) {
      matchKeyword = normalizeText(member.name).indexOf(keyword) >= 0 ||
        normalizeText(member.rawRemark).indexOf(keyword) >= 0;
    }

    if (roleFilter === 'pending') {
      matchRole = member.status === 'pending';
    } else if (roleFilter !== 'all') {
      matchRole = member.role === roleFilter && member.status !== 'pending';
    }

    return matchKeyword && matchRole;
  });
}

function getMemberStatistics(members) {
  var stats = { all: members.length, owner: 0, admin: 0, viewer: 0, pending: 0 };

  members.forEach(function (member) {
    if (member.status === 'pending') {
      stats.pending += 1;
      return;
    }

    if (member.role === 'owner') stats.owner += 1;
    if (member.role === 'admin') stats.admin += 1;
    if (member.role === 'viewer') stats.viewer += 1;
  });

  return stats;
}

function getPagePermissionFlags(currentRole) {
  return {
    canInviteMembers: currentRole === 'owner',
    canViewManageEntry: currentRole === 'owner',
    canSeeReadonlyNotice: currentRole === 'viewer'
  };
}

function getRoleOptions() {
  return [
    { value: 'all', label: '全部' },
    { value: 'owner', label: '创建者' },
    { value: 'admin', label: '管理员' },
    { value: 'viewer', label: '普通成员' },
    { value: 'pending', label: '待审核' }
  ];
}

module.exports = {
  decorateMember: decorateMember,
  filterMembers: filterMembers,
  formatMemberStatus: formatMemberStatus,
  formatRole: formatRole,
  getMemberStatistics: getMemberStatistics,
  getPagePermissionFlags: getPagePermissionFlags,
  getPermissionFlags: getPermissionFlags,
  getRoleOptions: getRoleOptions,
  getSafeText: getSafeText
};
