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

module.exports = {
  createTeam,
  getCurrentTeam
};
