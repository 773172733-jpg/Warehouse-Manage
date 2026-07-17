const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { createProduct } = require('./product-service.js');

module.exports = async function productCreate({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return createProduct(db, user, data, { cloud });
};
