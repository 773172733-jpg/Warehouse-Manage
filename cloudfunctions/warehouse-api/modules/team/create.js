const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { createTeam } = require('./team-service.js');

module.exports = async function create({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return createTeam(db, user, data);
};
