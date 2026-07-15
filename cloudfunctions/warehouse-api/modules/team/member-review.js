const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { reviewMember } = require('./member-service.js');

module.exports = async function memberReview({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return reviewMember(db, user, data);
};
