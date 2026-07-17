const { getDatabase } = require('../../common/database.js');
const { requireUser } = require('../../common/auth.js');
const { deleteCatalogProduct } = require('./product-service.js');

module.exports = async function catalogDelete({ data, context, cloud }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return deleteCatalogProduct(db, user, data, { cloud });
};
