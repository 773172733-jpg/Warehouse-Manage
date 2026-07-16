const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { prepareProductImage } = require('./image-service.js');

module.exports = async function productImageStagePrepare({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return prepareProductImage(db, user, data);
};
