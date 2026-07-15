const cloudService = require('./cloud-service.js');
const { normalizeRequiredBootstrapResult } = require('./bootstrap-state.js');

function bootstrap() {
  return cloudService.callApi('user.bootstrap')
    .then(normalizeRequiredBootstrapResult);
}

module.exports = {
  bootstrap
};
