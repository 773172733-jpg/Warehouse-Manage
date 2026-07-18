const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { rebuildProductSearch } = require('./product-service.js');

module.exports = async function handleProductSearchRebuild({ data, context, cloud }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return rebuildProductSearch(db, user, data);
};
