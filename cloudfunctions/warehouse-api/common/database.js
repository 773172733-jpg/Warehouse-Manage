const crypto = require('crypto');

const COLLECTIONS = {
  USERS: 'users',
  TEAMS: 'teams',
  TEAM_MEMBERS: 'team_members',
  WAREHOUSES: 'warehouses',
  INVITES: 'invites',
  PRODUCTS: 'products',
  WAREHOUSE_PRODUCTS: 'warehouse_products',
  STOCK_RECORDS: 'stock_records'
};

function getDatabase(cloud) {
  return cloud.database();
}

function createDocumentId(prefix, values) {
  const digest = crypto
    .createHash('sha256')
    .update(values.join(':'))
    .digest('hex')
    .slice(0, 32);

  return `${prefix}_${digest}`;
}

function isDocumentNotFound(error) {
  const message = error && (error.errMsg || error.message || '');
  return /not exist|not found|does not exist/i.test(message);
}

async function getDocument(source, collectionName, documentId) {
  try {
    const result = await source.collection(collectionName).doc(documentId).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    if (isDocumentNotFound(error)) {
      return null;
    }
    throw error;
  }
}

module.exports = {
  COLLECTIONS,
  getDatabase,
  createDocumentId,
  getDocument,
  isDocumentNotFound
};
