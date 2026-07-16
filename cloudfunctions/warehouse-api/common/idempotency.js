const { createDocumentId } = require('./database.js');

function createUserId(openId) {
  return createDocumentId('usr', [openId]);
}

function createTeamId(userId, requestKey) {
  return createDocumentId('team', [userId, requestKey]);
}

function createWarehouseId(teamId) {
  return createDocumentId('wh', [teamId, 'default']);
}

function createMembershipId(teamId, userId) {
  return createDocumentId('member', [teamId, userId]);
}

function createInviteId(teamId, userId, requestKey) {
  return createDocumentId('invite', [teamId, userId, requestKey]);
}

function createProductId(teamId, requestKey) {
  return createDocumentId('product', [teamId, 'product.create', requestKey]);
}

function createProductImageAssetId(teamId, requestKey) {
  return createDocumentId('product_image', [teamId, 'product.image.stage.prepare', requestKey]);
}

function createWarehouseProductId(teamId, warehouseId, productId) {
  return createDocumentId('warehouse_product', [teamId, warehouseId, productId]);
}

function createStockRecordId(teamId, warehouseId, action, requestKey) {
  return createDocumentId('stock_record', [teamId, warehouseId, action, requestKey]);
}

module.exports = {
  createUserId,
  createTeamId,
  createWarehouseId,
  createMembershipId,
  createInviteId,
  createProductId,
  createProductImageAssetId,
  createWarehouseProductId,
  createStockRecordId
};
