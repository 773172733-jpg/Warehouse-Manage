const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { updateSelfProfile } = require('./member-service.js');

module.exports = async function memberProfileUpdate({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return updateSelfProfile(db, user, data);
};
