const crypto = require('crypto');
const { ApiError, ERROR_CODES } = require('./errors.js');
const { validateRequestKey } = require('./validators.js');

const PRODUCT_LIMIT = 99999;
const STOCK_MAX = 999999999;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const STOCK_STATUSES = ['normal', 'low', 'out'];
const COVER_TYPES = ['none', 'text', 'emoji'];
const COVER_BACKGROUNDS = [
  '#EAF6EF',
  '#F7F2E8',
  '#E9EDF5',
  '#F7EAEE',
  '#EDE8F2',
  '#EFEDE8',
  '#E6F0ED',
  '#F3EFE6'
];
const COVER_EMOJIS = ['📦', '🔧', '🧱', '🔩', '🪣', '📎'];
const SERVER_GENERATED_FIELDS = ['normalizedName', 'normalizedCode', 'searchKeywords'];
const FORBIDDEN_PRODUCT_FIELDS = [
  'teamId',
  'warehouseId',
  'userId',
  'openId',
  'role',
  'createdBy',
  'updatedBy',
  'operatorId',
  'stock',
  'stockStatus',
  'stockVersion',
  'version',
  'productId',
  'warehouseProductId',
  'activeProductCount'
];
const CREATE_FIELDS = [
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
];

function hasOwn(source, field) {
  return Object.prototype.hasOwnProperty.call(source, field);
}

function normalizeWhitespace(value) {
  const text = typeof value === 'string' ? value : '';
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function normalizeProductName(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeProductCode(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function getCharacterLength(value) {
  return Array.from(value || '').length;
}

function validateText(value, options) {
  const text = normalizeWhitespace(value);
  const length = getCharacterLength(text);
  if ((options.required && !length) || length > options.maxLength) {
    throw new ApiError(options.code, options.message);
  }
  return text;
}

function validateSafeQuantity(value, code, message) {
  const number = value === '' || value === undefined || value === null ? 0 : Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > STOCK_MAX) {
    throw new ApiError(code, message);
  }
  return number;
}

function buildSearchKeywords(source) {
  const candidates = [
    source.name,
    source.productCode,
    source.category,
    source.brand,
    source.specification
  ];
  const result = [];
  const seen = new Set();

  function append(value) {
    const keyword = Array.from(value || '').slice(0, 20).join('');
    if (!keyword || seen.has(keyword) || result.length >= 10) {
      return;
    }
    seen.add(keyword);
    result.push(keyword);
  }

  candidates.forEach((value) => {
    const normalized = normalizeProductName(value);
    append(normalized);
  });
  candidates.forEach((value) => {
    normalizeProductName(value).split(/[\s,，/|;；]+/).forEach(append);
  });

  return result;
}

function sanitizeCover(source, name) {
  const coverType = normalizeWhitespace(source.coverType || 'none').toLowerCase();
  if (!COVER_TYPES.includes(coverType)) {
    throw new ApiError(ERROR_CODES.INVALID_COVER, '自定义图片上传尚未接入，请选择文字、emoji或默认封面。');
  }
  if (hasOwn(source, 'coverFileId') || hasOwn(source, 'localImagePath')) {
    throw new ApiError(ERROR_CODES.INVALID_COVER, '当前阶段不接受图片路径或fileID。');
  }

  if (coverType === 'none') {
    return {
      coverType,
      coverText: '',
      coverEmoji: '',
      coverAssetKey: '',
      coverFileId: '',
      coverBackground: ''
    };
  }

  const coverBackground = normalizeWhitespace(source.coverBackground || COVER_BACKGROUNDS[0]).toUpperCase();
  if (!COVER_BACKGROUNDS.includes(coverBackground)) {
    throw new ApiError(ERROR_CODES.INVALID_COVER, '请选择系统支持的封面背景色。');
  }

  if (coverType === 'text') {
    const defaultText = Array.from(name)[0] || '';
    const coverText = normalizeWhitespace(source.coverText || defaultText);
    const length = getCharacterLength(coverText);
    if (length < 1 || length > 6) {
      throw new ApiError(ERROR_CODES.INVALID_COVER, '文字封面需要1至6个字符。');
    }
    return {
      coverType,
      coverText,
      coverEmoji: '',
      coverAssetKey: '',
      coverFileId: '',
      coverBackground
    };
  }

  const coverEmoji = normalizeWhitespace(source.coverEmoji);
  if (!COVER_EMOJIS.includes(coverEmoji)) {
    throw new ApiError(ERROR_CODES.INVALID_COVER, '请选择系统支持的emoji封面。');
  }
  return {
    coverType,
    coverText: '',
    coverEmoji,
    coverAssetKey: '',
    coverFileId: '',
    coverBackground
  };
}

function sanitizeProductInput(rawInput) {
  const source = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const forbidden = FORBIDDEN_PRODUCT_FIELDS.find((field) => hasOwn(source, field));
  if (forbidden) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '请求包含不能由客户端指定的身份或库存字段。');
  }
  const unknown = Object.keys(source).find((field) => {
    return !CREATE_FIELDS.includes(field) &&
      !SERVER_GENERATED_FIELDS.includes(field) &&
      field !== 'coverFileId' && field !== 'localImagePath';
  });
  if (unknown) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '请求包含不允许的产品字段。');
  }

  const name = validateText(source.name, {
    required: true,
    maxLength: 40,
    code: ERROR_CODES.INVALID_PRODUCT_NAME,
    message: '产品名称需要1至40个字符。'
  });
  const productCode = validateText(source.productCode, {
    required: false,
    maxLength: 40,
    code: ERROR_CODES.INVALID_PRODUCT_CODE,
    message: '产品编号不能超过40个字符。'
  });
  const category = validateText(source.category || '其他', {
    required: true,
    maxLength: 20,
    code: ERROR_CODES.INVALID_CATEGORY,
    message: '产品分类需要1至20个字符。'
  });
  const unit = validateText(source.unit || '个', {
    required: true,
    maxLength: 10,
    code: ERROR_CODES.INVALID_UNIT,
    message: '产品单位需要1至10个字符。'
  });
  const brand = validateText(source.brand, {
    required: false,
    maxLength: 40,
    code: ERROR_CODES.INVALID_BRAND,
    message: '产品品牌不能超过40个字符。'
  });
  const specification = validateText(source.specification, {
    required: false,
    maxLength: 80,
    code: ERROR_CODES.INVALID_SPECIFICATION,
    message: '产品规格不能超过80个字符。'
  });
  const description = validateText(source.description, {
    required: false,
    maxLength: 200,
    code: ERROR_CODES.INVALID_DESCRIPTION,
    message: '产品介绍不能超过200个字符。'
  });
  const requestKey = validateRequestKey(source.requestKey);
  const cover = sanitizeCover(source, name);
  const minStock = validateSafeQuantity(
    source.minStock,
    ERROR_CODES.INVALID_MIN_STOCK,
    '最低库存必须是非负安全整数。'
  );
  const initialStock = validateSafeQuantity(
    source.initialStock,
    ERROR_CODES.INVALID_STOCK_QUANTITY,
    '初始库存必须是非负安全整数。'
  );
  const input = Object.assign({
    name,
    normalizedName: normalizeProductName(name),
    productCode,
    normalizedCode: normalizeProductCode(productCode),
    category,
    unit,
    brand,
    specification,
    description,
    minStock,
    initialStock,
    requestKey
  }, cover);
  input.searchKeywords = buildSearchKeywords(input);
  return input;
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableSerialize(value[key])}`;
    }).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createProductRequestHash(input) {
  const payload = Object.assign({}, input);
  delete payload.requestKey;
  return crypto.createHash('sha256').update(stableSerialize(payload)).digest('hex');
}

function computeStockStatus(stock, minStock) {
  if (!Number.isSafeInteger(stock) || stock < 0 || !Number.isSafeInteger(minStock) || minStock < 0) {
    throw new ApiError(ERROR_CODES.INVALID_STOCK_QUANTITY, '库存和最低库存必须是非负安全整数。');
  }
  if (stock <= 0) {
    return 'out';
  }
  if (stock <= minStock) {
    return 'low';
  }
  return 'normal';
}

function assertProductCountWithinLimit(value) {
  const activeProductCount = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  if (activeProductCount >= PRODUCT_LIMIT) {
    throw new ApiError(ERROR_CODES.PRODUCT_LIMIT_REACHED, '团队产品数量已达到99,999个上限。');
  }
  return activeProductCount;
}

function buildCoverSummary(product) {
  return {
    type: product.coverType || 'none',
    text: product.coverText || '',
    emoji: product.coverEmoji || '',
    assetKey: product.coverAssetKey || '',
    fileId: product.coverFileId || '',
    background: product.coverBackground || ''
  };
}

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function getDateMillis(value) {
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : NaN;
}

function encodeProductCursor(document) {
  const updatedAt = getDateMillis(document && document.updatedAt);
  const id = document && document._id;
  if (!Number.isFinite(updatedAt) || !PRODUCT_ID_PATTERN.test(id || '')) {
    return null;
  }
  return encodeBase64Url(JSON.stringify({ v: 1, u: updatedAt, i: id, s: 'updated_desc' }));
}

function decodeProductCursor(value) {
  if (!value) {
    return null;
  }
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ApiError(ERROR_CODES.INVALID_CURSOR, '分页游标无效，请重新加载。');
  }
  try {
    const cursor = JSON.parse(decodeBase64Url(value));
    if (cursor.v !== 1 || cursor.s !== 'updated_desc' ||
        !Number.isSafeInteger(cursor.u) || cursor.u < 0 ||
        !PRODUCT_ID_PATTERN.test(cursor.i || '')) {
      throw new Error('invalid cursor');
    }
    return { updatedAt: new Date(cursor.u), id: cursor.i };
  } catch (error) {
    throw new ApiError(ERROR_CODES.INVALID_CURSOR, '分页游标无效，请重新加载。');
  }
}

function validateProductListInput(rawInput) {
  const source = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const allowed = ['keyword', 'category', 'stockStatus', 'cursor', 'pageSize', 'sort'];
  const unknown = Object.keys(source).find((field) => !allowed.includes(field));
  if (unknown) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '产品列表请求包含不允许的字段。');
  }
  const pageSize = source.pageSize === undefined ? DEFAULT_PAGE_SIZE : Number(source.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new ApiError(ERROR_CODES.INVALID_PAGE_SIZE, '每页数量需要在1至50之间。');
  }
  const keyword = normalizeProductName(source.keyword);
  if (getCharacterLength(keyword) > 40) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, '搜索关键词不能超过40个字符。');
  }
  const category = normalizeWhitespace(source.category);
  if (getCharacterLength(category) > 20) {
    throw new ApiError(ERROR_CODES.INVALID_CATEGORY, '产品分类不能超过20个字符。');
  }
  const stockStatus = normalizeWhitespace(source.stockStatus).toLowerCase();
  if (stockStatus && !STOCK_STATUSES.includes(stockStatus)) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, '库存状态筛选值无效。');
  }
  const sort = normalizeWhitespace(source.sort || 'updated_desc');
  if (sort !== 'updated_desc') {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, '当前仅支持按更新时间倒序。');
  }
  return {
    keyword,
    category,
    stockStatus,
    cursor: decodeProductCursor(source.cursor),
    pageSize,
    sort
  };
}

function validateProductDetailInput(rawInput) {
  const source = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const allowed = ['productId', 'warehouseProductId'];
  const unknown = Object.keys(source).find((field) => !allowed.includes(field));
  if (unknown) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '产品详情请求包含不允许的字段。');
  }
  const productId = normalizeWhitespace(source.productId);
  const warehouseProductId = normalizeWhitespace(source.warehouseProductId);
  if (Boolean(productId) === Boolean(warehouseProductId)) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, '请且仅请提供一个产品标识。');
  }
  const selected = productId || warehouseProductId;
  if (!PRODUCT_ID_PATTERN.test(selected)) {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_FOUND, '产品不存在。');
  }
  return { productId, warehouseProductId };
}

function getProductPermissionFlags(role) {
  const canWrite = role === 'owner' || role === 'admin';
  return {
    canEdit: canWrite,
    canOperateStock: canWrite,
    canRemove: canWrite
  };
}

function presentProduct(product) {
  return product ? {
    id: product._id,
    name: product.name,
    productCode: product.productCode || '',
    category: product.category || '',
    unit: product.unit || '',
    brand: product.brand || '',
    specification: product.specification || '',
    description: product.description || '',
    cover: buildCoverSummary(product),
    version: product.version,
    status: product.status,
    createdAt: product.createdAt || null,
    updatedAt: product.updatedAt || null
  } : null;
}

function presentWarehouseProduct(warehouseProduct) {
  if (!warehouseProduct) {
    return null;
  }
  return {
    id: warehouseProduct._id,
    productId: warehouseProduct.productId,
    name: warehouseProduct.productNameSnapshot,
    productCode: warehouseProduct.productCodeSnapshot || '',
    category: warehouseProduct.categorySnapshot || '',
    unit: warehouseProduct.unitSnapshot || '',
    brand: warehouseProduct.brandSnapshot || '',
    specification: warehouseProduct.specificationSnapshot || '',
    cover: warehouseProduct.coverSummarySnapshot || buildCoverSummary({}),
    stock: warehouseProduct.stock,
    minStock: warehouseProduct.minStock,
    stockStatus: computeStockStatus(warehouseProduct.stock, warehouseProduct.minStock),
    productVersion: warehouseProduct.productVersion,
    stockVersion: warehouseProduct.stockVersion,
    updatedAt: warehouseProduct.updatedAt || null
  };
}

function presentStockRecord(record) {
  return record ? {
    id: record._id,
    productId: record.productId,
    warehouseProductId: record.warehouseProductId,
    productName: record.productNameSnapshot,
    productCode: record.productCodeSnapshot || '',
    unit: record.unitSnapshot || '',
    type: record.type,
    changeQuantity: record.changeQuantity,
    beforeStock: record.beforeStock,
    afterStock: record.afterStock,
    reason: record.reason || '',
    sourceOrDestination: record.sourceOrDestination || '',
    remark: record.remark || '',
    operatorName: record.operatorNameSnapshot || '',
    createdAt: record.createdAt || null
  } : null;
}

module.exports = {
  PRODUCT_LIMIT,
  STOCK_MAX,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizeWhitespace,
  normalizeProductName,
  normalizeProductCode,
  buildSearchKeywords,
  sanitizeProductInput,
  createProductRequestHash,
  computeStockStatus,
  assertProductCountWithinLimit,
  buildCoverSummary,
  encodeProductCursor,
  decodeProductCursor,
  validateProductListInput,
  validateProductDetailInput,
  getProductPermissionFlags,
  presentProduct,
  presentWarehouseProduct,
  presentStockRecord
};
