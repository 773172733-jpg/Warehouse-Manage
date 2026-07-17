const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { listProducts } = require('./product-service.js');

module.exports = async function productList({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return listProducts(db, user, data, { cloud });
};
