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

function buildCreateProductPayload(input = {}) {
  return copyDefined(input, [
    'name',
    'productCode',
    'category',
    'unit',
    'brand',
    'specification',
    'description',
    'coverType',
    'coverText',
    'coverEmoji',
    'coverBackground',
    'minStock',
    'initialStock',
    'requestKey'
  ]);
}

function buildListProductsPayload(input = {}) {
  return copyDefined(input, [
    'keyword',
    'category',
    'stockStatus',
    'cursor',
    'pageSize',
    'sort'
  ]);
}

function buildProductDetailPayload(input = {}) {
  return copyDefined(input, ['productId', 'warehouseProductId']);
}

function buildUpdateProductPayload(input = {}) {
  return copyDefined(input, [
    'productId',
    'expectedVersion',
    'name',
    'productCode',
    'category',
    'unit',
    'brand',
    'specification',
    'description',
    'coverType',
    'coverText',
    'coverEmoji',
    'coverBackground',
    'requestKey'
  ]);
}

function buildRemoveProductPayload(input = {}) {
  return copyDefined(input, ['warehouseProductId', 'reason', 'requestKey']);
}

function buildRemovedProductsPayload(input = {}) {
  return copyDefined(input, ['keyword', 'category', 'cursor', 'pageSize', 'sort']);
}

function buildRestoreProductPayload(input = {}) {
  return copyDefined(input, ['warehouseProductId', 'requestKey']);
}

function createProduct(input) {
  return cloudService.callApi('product.create', buildCreateProductPayload(input));
}

function listProducts(input) {
  return cloudService.callApi('product.list', buildListProductsPayload(input));
}

function getProductDetail(input) {
  return cloudService.callApi('product.detail', buildProductDetailPayload(input));
}

function updateProduct(input) {
  return cloudService.callApi('product.update', buildUpdateProductPayload(input));
}

function removeProductFromWarehouse(input) {
  return cloudService.callApi('product.removeFromWarehouse', buildRemoveProductPayload(input));
}

function listRemovedProducts(input) {
  return cloudService.callApi('product.removed.list', buildRemovedProductsPayload(input));
}

function restoreProductToWarehouse(input) {
  return cloudService.callApi('product.restoreToWarehouse', buildRestoreProductPayload(input));
}

module.exports = {
  buildCreateProductPayload,
  buildListProductsPayload,
  buildProductDetailPayload,
  buildUpdateProductPayload,
  buildRemoveProductPayload,
  buildRemovedProductsPayload,
  buildRestoreProductPayload,
  createProduct,
  listProducts,
  getProductDetail,
  updateProduct,
  removeProductFromWarehouse,
  listRemovedProducts,
  restoreProductToWarehouse
};
