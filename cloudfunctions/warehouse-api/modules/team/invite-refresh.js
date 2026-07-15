const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { refreshInvite } = require('./invite-service.js');

module.exports = async function inviteRefresh({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return refreshInvite(db, user, data);
};
