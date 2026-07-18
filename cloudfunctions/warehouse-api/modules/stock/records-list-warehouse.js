const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { listWarehouseStockRecords } = require('./record-service.js');

module.exports = async function stockRecordsListWarehouse({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return listWarehouseStockRecords(db, user, data, { cloud });
};
