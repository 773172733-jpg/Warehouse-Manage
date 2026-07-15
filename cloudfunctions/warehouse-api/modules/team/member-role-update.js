const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { updateMemberRole } = require('./member-service.js');

module.exports = async function memberRoleUpdate({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return updateMemberRole(db, user, data);
};
