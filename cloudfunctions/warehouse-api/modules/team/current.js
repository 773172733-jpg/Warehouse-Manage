const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { getCurrentTeam } = require('./team-service.js');

module.exports = async function current({ cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return getCurrentTeam(db, user);
};
