const { getDatabase } = require('../../common/database.js');
const { requireUser } = require('../../common/auth.js');
const { listDeletedCatalogProducts } = require('./product-service.js');

module.exports = async function catalogDeletedList({ data, context, cloud }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return listDeletedCatalogProducts(db, user, data);
};
