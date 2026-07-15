const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { getJoinStatus } = require('./invite-service.js');

module.exports = async function joinStatus({ cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return getJoinStatus(db, user);
};
