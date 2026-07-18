const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { listStockRecords } = require('./record-service.js');

module.exports = async function stockRecordsList({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return listStockRecords(db, user, data);
};
