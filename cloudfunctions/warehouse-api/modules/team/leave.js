const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { leaveTeam } = require('./member-service.js');

module.exports = async function leave({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return leaveTeam(db, user, data);
};
