const { getDatabase } = require('../../common/database.js');
const { requireUser } = require('../../common/auth.js');
const { restoreCatalogProduct } = require('./product-service.js');

module.exports = async function catalogRestore({ data, context, cloud }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return restoreCatalogProduct(db, user, data, { cloud });
};
