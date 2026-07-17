const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { getProductDetail } = require('./product-service.js');

module.exports = async function productDetail({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return getProductDetail(db, user, data, { cloud });
};
