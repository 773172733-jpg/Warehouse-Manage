const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { applyToJoin } = require('./invite-service.js');

module.exports = async function joinApply({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return applyToJoin(db, user, data);
};
