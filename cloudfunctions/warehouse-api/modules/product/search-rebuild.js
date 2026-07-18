const { getDatabase } = require('../../common/database.js');
const { rebuildProductSearch } = require('./product-service.js');

module.exports = async function handleProductSearchRebuild({ data, context, cloud }) {
  const db = getDatabase(cloud);
  return rebuildProductSearch(db, context.user, data);
};
