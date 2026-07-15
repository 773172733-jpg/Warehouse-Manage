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

function applyToJoin(input) {
  return cloudService.callApi('team.join.apply', {
    code: input.code,
    requestKey: input.requestKey
  });
}

function getJoinStatus() {
  return cloudService.callApi('team.join.status');
}

module.exports = {
  createTeam,
  getCurrentTeam,
  getCurrentInvite,
  refreshInvite,
  applyToJoin,
  getJoinStatus
};
