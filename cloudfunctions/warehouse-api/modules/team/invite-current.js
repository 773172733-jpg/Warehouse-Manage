const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { getCurrentInvite } = require('./invite-service.js');

module.exports = async function currentInvite({ cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return getCurrentInvite(db, user);
};
