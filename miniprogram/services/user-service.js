const ROLES = require('../constants/roles');

function bootstrap() {
  return Promise.resolve({
    user: {
      id: 'local-placeholder-user',
      displayName: '本地用户',
      isPlaceholder: true
    },
    currentTeam: null,
    currentRole: ROLES.VIEWER
  });
}

module.exports = {
  bootstrap
};
