const { getDatabase } = require('../../common/database.js');
const { requireUser } = require('../../common/auth.js');
const { listRemovedProducts } = require('./product-service.js');

module.exports = async function productRemovedList({ data, context, cloud }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return listRemovedProducts(db, user, data, { cloud });
};
