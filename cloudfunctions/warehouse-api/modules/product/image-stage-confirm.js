const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { confirmProductImage } = require('./image-service.js');

module.exports = async function productImageStageConfirm({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return confirmProductImage(db, user, data, {
    cloud,
    envId: context.env
  });
};
