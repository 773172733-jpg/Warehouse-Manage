const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { STOCK_ACTIONS } = require('../../common/stock-utils.js');
const { mutateStock } = require('./stock-service.js');

module.exports = async function stockAdjust({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return mutateStock(db, user, STOCK_ACTIONS.ADJUST, data);
};
