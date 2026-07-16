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

function createProduct(input) {
  return cloudService.callApi('product.create', buildCreateProductPayload(input));
}

function listProducts(input) {
  return cloudService.callApi('product.list', buildListProductsPayload(input));
}

function getProductDetail(input) {
  return cloudService.callApi('product.detail', buildProductDetailPayload(input));
}

module.exports = {
  buildCreateProductPayload,
  buildListProductsPayload,
  buildProductDetailPayload,
  createProduct,
  listProducts,
  getProductDetail
};
