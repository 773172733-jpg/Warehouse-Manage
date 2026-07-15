const { createDocumentId } = require('./database.js');

function createUserId(openId) {
  return createDocumentId('usr', [openId]);
}

function createTeamId(userId, requestKey) {
  return createDocumentId('team', [userId, requestKey]);
}

function createWarehouseId(teamId) {
  return createDocumentId('wh', [teamId, 'default']);
}

function createMembershipId(teamId, userId) {
  return createDocumentId('member', [teamId, userId]);
}

function createInviteId(teamId, requestKey) {
  return createDocumentId('invite', [teamId, requestKey]);
}

module.exports = {
  createUserId,
  createTeamId,
  createWarehouseId,
  createMembershipId,
  createInviteId
};
