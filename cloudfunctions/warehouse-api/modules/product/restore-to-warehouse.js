const { getDatabase } = require('../../common/database.js');
const { requireUser } = require('../../common/auth.js');
const { restoreProductToWarehouse } = require('./product-service.js');

module.exports = async function productRestoreToWarehouse({ data, context, cloud }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return restoreProductToWarehouse(db, user, data);
};
