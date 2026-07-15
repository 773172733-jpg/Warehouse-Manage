const { getDatabase } = require('../../common/database.js');
const { bootstrapCurrentUser } = require('./user-service.js');

module.exports = async function bootstrap({ cloud, context }) {
  const db = getDatabase(cloud);
  return bootstrapCurrentUser(db, context);
};
