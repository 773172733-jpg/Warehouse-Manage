const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { removeMember } = require('./member-service.js');

module.exports = async function memberRemove({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return removeMember(db, user, data);
};
