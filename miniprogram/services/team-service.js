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

function refreshInvite(input) {
  return cloudService.callApi('team.invite.refresh', {
    requestKey: input.requestKey,
    expiresInHours: input.expiresInHours,
    maxUses: input.maxUses
  });
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

function reviewMember(input) {
  return cloudService.callApi('team.member.review', {
    memberId: input.memberId,
    decision: input.decision,
    remark: input.remark,
    requestKey: input.requestKey
  });
}

function updateMemberRole(input) {
  return cloudService.callApi('team.member.role.update', {
    memberId: input.memberId,
    role: input.role,
    requestKey: input.requestKey
  });
}

function removeMember(input) {
  return cloudService.callApi('team.member.remove', {
    memberId: input.memberId,
    reason: input.reason,
    requestKey: input.requestKey
  });
}

function leaveTeam(requestKey) {
  return cloudService.callApi('team.leave', { requestKey });
}

module.exports = {
  createTeam,
  getCurrentTeam,
  getCurrentInvite,
  refreshInvite,
  buildJoinApplyPayload,
  applyToJoin,
  getJoinStatus,
  listMembers,
  reviewMember,
  updateMemberRole,
  removeMember,
  leaveTeam
};
