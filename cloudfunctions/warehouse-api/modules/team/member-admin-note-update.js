const { requireUser } = require('../../common/auth.js');
const { getDatabase } = require('../../common/database.js');
const { updateAdminNote } = require('./member-service.js');

module.exports = async function memberAdminNoteUpdate({ data, cloud, context }) {
  const db = getDatabase(cloud);
  const user = await requireUser(db, context);
  return updateAdminNote(db, user, data);
};
