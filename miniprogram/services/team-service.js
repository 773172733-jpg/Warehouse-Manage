const cloudService = require('./cloud-service.js');
const { normalizeRequiredBootstrapResult } = require('./bootstrap-state.js');

function createTeam(input) {
  return cloudService.callApi('team.create', {
    name: input.name,
    warehouseName: input.warehouseName,
    requestKey: input.requestKey
  }, {
    loadingTitle: '正在创建'
  }).then(normalizeRequiredBootstrapResult);
}

function getCurrentTeam() {
  return cloudService.callApi('team.current')
    .then(normalizeRequiredBootstrapResult);
}

function getCurrentInvite() {
  return cloudService.callApi('team.invite.current');
}

function buildInviteRefreshPayload(input = {}) {
  return {
    requestKey: input.requestKey,
    expiresInHours: input.expiresInHours,
    maxUses: input.maxUses
  };
}

function refreshInvite(input) {
  return cloudService.callApi('team.invite.refresh', buildInviteRefreshPayload(input));
}

function buildJoinApplyPayload(input = {}) {
  return {
    code: input.code,
    requestKey: input.requestKey
  };
}

function applyToJoin(input) {
  return cloudService.callApi('team.join.apply', buildJoinApplyPayload(input));
}

function getJoinStatus() {
  return cloudService.callApi('team.join.status');
}

function listMembers(filters = {}) {
  return cloudService.callApi('team.member.list', {
    status: filters.status,
    role: filters.role,
    keyword: filters.keyword
  });
}

function buildMemberReviewPayload(input = {}) {
  return {
    memberId: input.memberId,
    decision: input.decision,
    remark: input.remark,
    requestKey: input.requestKey
  };
}

function reviewMember(input) {
  return cloudService.callApi('team.member.review', buildMemberReviewPayload(input));
}

function buildMemberRolePayload(input = {}) {
  const role = String(input.role || '');
  if (!['admin', 'viewer'].includes(role)) {
    const error = new Error('目标角色只能是管理员或普通成员。');
    error.code = 'INVALID_ROLE';
    throw error;
  }
  return {
    memberId: input.memberId,
    role,
    requestKey: input.requestKey
  };
}

function updateMemberRole(input) {
  try {
    return cloudService.callApi('team.member.role.update', buildMemberRolePayload(input));
  } catch (error) {
    return Promise.reject(error);
  }
}

function buildMemberRemovePayload(input = {}) {
  return {
    memberId: input.memberId,
    reason: input.reason,
    requestKey: input.requestKey
  };
}

function removeMember(input) {
  return cloudService.callApi('team.member.remove', buildMemberRemovePayload(input));
}

function buildLeavePayload(input = {}) {
  return { requestKey: input.requestKey };
}

function leaveTeam(input) {
  return cloudService.callApi('team.leave', buildLeavePayload(input));
}

function buildSelfProfilePayload(input = {}) {
  const payload = {};
  if (Object.prototype.hasOwnProperty.call(input, 'teamNickname')) {
    payload.teamNickname = input.teamNickname;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'avatarKey')) {
    payload.avatarKey = input.avatarKey;
  }
  return payload;
}

function updateSelfProfile(input) {
  return cloudService.callApi('team.member.profile.update', buildSelfProfilePayload(input));
}

function buildAdminNotePayload(input = {}) {
  return {
    targetMemberId: input.targetMemberId,
    adminNote: input.adminNote
  };
}

function updateAdminNote(input) {
  return cloudService.callApi('team.member.adminNote.update', buildAdminNotePayload(input));
}

function buildDisplayNamePayload(input = {}) {
  return { displayName: input.displayName };
}

function updateDisplayName(input) {
  return cloudService.callApi('team.displayName.update', buildDisplayNamePayload(input));
}

module.exports = {
  createTeam,
  getCurrentTeam,
  getCurrentInvite,
  buildInviteRefreshPayload,
  refreshInvite,
  buildJoinApplyPayload,
  applyToJoin,
  getJoinStatus,
  listMembers,
  buildMemberReviewPayload,
  reviewMember,
  buildMemberRolePayload,
  updateMemberRole,
  buildMemberRemovePayload,
  removeMember,
  buildLeavePayload,
  leaveTeam,
  buildSelfProfilePayload,
  updateSelfProfile,
  buildAdminNotePayload,
  updateAdminNote,
  buildDisplayNamePayload,
  updateDisplayName
};
