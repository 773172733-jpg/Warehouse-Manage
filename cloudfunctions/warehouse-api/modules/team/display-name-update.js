const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { updateDisplayName } = require('./team-service.js');

module.exports = async function displayNameUpdate({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return updateDisplayName(db, user, data);
};
