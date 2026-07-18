const cloudService = require('./cloud-service.js');

function copyDefined(source, fields) {
  const input = source && typeof source === 'object' ? source : {};
  return fields.reduce((result, field) => {
    if (input[field] !== undefined) {
      result[field] = input[field];
    }
    return result;
  }, {});
}

function buildQuantityPayload(input) {
  return copyDefined(input, [
    'warehouseProductId',
    'quantity',
    'expectedStockVersion',
    'reason',
    'referenceNo',
    'requestKey'
  ]);
}

function buildAdjustmentPayload(input) {
  return copyDefined(input, [
    'warehouseProductId',
    'targetStock',
    'expectedStockVersion',
    'reason',
    'referenceNo',
    'requestKey'
  ]);
}

function buildRecordListPayload(input) {
  return copyDefined(input, [
    'warehouseProductId',
    'type',
    'cursor',
    'pageSize'
  ]);
}

function buildWarehouseRecordListPayload(input) {
  return copyDefined(input, [
    'type',
    'startAt',
    'endAt',
    'cursor',
    'pageSize'
  ]);
}

function inboundStock(input) {
  return cloudService.callApi('stock.inbound', buildQuantityPayload(input));
}

function outboundStock(input) {
  return cloudService.callApi('stock.outbound', buildQuantityPayload(input));
}

function adjustStock(input) {
  return cloudService.callApi('stock.adjust', buildAdjustmentPayload(input));
}

function listStockRecords(input) {
  return cloudService.callApi('stock.records.list', buildRecordListPayload(input));
}

function listWarehouseStockRecords(input) {
  return cloudService.callApi('stock.records.listWarehouse', buildWarehouseRecordListPayload(input));
}

module.exports = {
  buildQuantityPayload,
  buildAdjustmentPayload,
  buildRecordListPayload,
  buildWarehouseRecordListPayload,
  inboundStock,
  outboundStock,
  adjustStock,
  listStockRecords,
  listWarehouseStockRecords
};
