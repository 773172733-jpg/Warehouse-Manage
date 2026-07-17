const { getDatabase } = require('../../common/database.js');
const { requireUser } = require('../../common/auth.js');
const { removeProductFromWarehouse } = require('./product-service.js');

module.exports = async function productRemoveFromWarehouse({ data, context, cloud }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return removeProductFromWarehouse(db, user, data, { cloud });
};
