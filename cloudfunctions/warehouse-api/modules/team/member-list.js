const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { listMembers } = require('./member-service.js');

module.exports = async function memberList({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return listMembers(db, user, data);
};
