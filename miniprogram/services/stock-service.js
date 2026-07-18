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

function inboundStock(input) {
  return cloudService.callApi('stock.inbound', buildQuantityPayload(input));
}

function outboundStock(input) {
  return cloudService.callApi('stock.outbound', buildQuantityPayload(input));
}

function adjustStock(input) {
  return cloudService.callApi('stock.adjust', buildAdjustmentPayload(input));
}

module.exports = {
  buildQuantityPayload,
  buildAdjustmentPayload,
  inboundStock,
  outboundStock,
  adjustStock
};
