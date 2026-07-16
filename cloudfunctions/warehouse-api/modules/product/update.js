const { getDatabase } = require('../../common/database.js');
const { requireUser } = require('../../common/auth.js');
const { updateProduct } = require('./product-service.js');

module.exports = async function productUpdate({ data, context, cloud }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return updateProduct(db, user, data);
};
