const { createRequestKey } = require('../../utils/request-key.js');

const STOCK_MAX = 999999999;
const ALLOWED_ROLES = ['owner', 'admin'];
const CUSTOM_IMAGE_MESSAGE = '自定义图片上传将在后续阶段开放，请先使用文字或表情封面。';

const ERROR_MESSAGES = {
  FORBIDDEN: '你没有创建产品的权限',
  INVALID_PRODUCT_NAME: '请输入正确的产品名称',
  INVALID_PRODUCT_CODE: '产品编号格式不正确',
  INVALID_CATEGORY: '分类内容不正确',
  INVALID_UNIT: '请输入正确的单位',
  INVALID_BRAND: '品牌内容过长或格式不正确',
  INVALID_SPECIFICATION: '规格内容过长或格式不正确',
  INVALID_DESCRIPTION: '产品介绍内容过长',
  INVALID_COVER: '当前封面不可用，请重新选择',
  INVALID_STOCK_QUANTITY: '初始库存必须是非负整数',
  INVALID_MIN_STOCK: '最低库存必须是非负整数',
  PRODUCT_LIMIT_REACHED: '团队产品数量已达到上限',
  REQUEST_KEY_CONFLICT: '表单内容已经变化，请重新提交',
  DUPLICATE_REQUEST: '该创建操作已提交，正在确认结果',
  WAREHOUSE_NOT_FOUND: '当前仓库不存在，请重新进入小程序',
  WAREHOUSE_NOT_ACTIVE: '当前仓库暂不可用',
  NO_ACTIVE_TEAM: '你当前没有可用团队',
  DATABASE_ERROR: '服务暂时不可用，请稍后重试',
  INTERNAL_ERROR: '创建失败，请稍后重试',
  CLOUD_CALL_FAILED: '网络连接失败，请检查网络后重试',
  CLOUD_NOT_AVAILABLE: '网络连接失败，请检查网络后重试',
  CLOUD_ENV_NOT_CONFIGURED: '服务暂时不可用，请稍后重试'
};

function createLocalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseQuantity(value, code, message) {
  const text = typeof value === 'number' ? String(value) : normalizeText(value);
  if (!/^\d+$/.test(text)) {
    throw createLocalError(code, message);
  }
  const quantity = Number(text);
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > STOCK_MAX) {
    throw createLocalError(code, message);
  }
  return quantity;
}

function buildCoverPayload(form) {
  if (form.coverMode === 'custom') {
    throw createLocalError('CUSTOM_IMAGE_NOT_SUPPORTED', CUSTOM_IMAGE_MESSAGE);
  }
  if (form.coverMode === 'system') {
    const emoji = normalizeText(form.systemAssetEmoji);
    if (!emoji) {
      throw createLocalError('INVALID_COVER', ERROR_MESSAGES.INVALID_COVER);
    }
    return {
      coverType: 'emoji',
      coverText: '',
      coverEmoji: emoji,
      coverBackground: normalizeText(form.coverColor)
    };
  }
  if (form.coverMode === 'none') {
    return {
      coverType: 'none',
      coverText: '',
      coverEmoji: '',
      coverBackground: ''
    };
  }
  const coverText = normalizeText(form.displayText);
  if (!coverText) {
    throw createLocalError('INVALID_COVER', ERROR_MESSAGES.INVALID_COVER);
  }
  return {
    coverType: 'text',
    coverText,
    coverEmoji: '',
    coverBackground: normalizeText(form.coverColor)
  };
}

function buildCreateProductPayload(form) {
  const source = form && typeof form === 'object' ? form : {};
  const name = normalizeText(source.name);
  if (!name) {
    throw createLocalError('INVALID_PRODUCT_NAME', ERROR_MESSAGES.INVALID_PRODUCT_NAME);
  }
  const category = normalizeText(source.category);
  if (!category) {
    throw createLocalError('INVALID_CATEGORY', ERROR_MESSAGES.INVALID_CATEGORY);
  }
  const unit = source.unit === '其他'
    ? normalizeText(source.customUnit)
    : normalizeText(source.unit);
  if (!unit) {
    throw createLocalError('INVALID_UNIT', ERROR_MESSAGES.INVALID_UNIT);
  }

  const initialStock = parseQuantity(
    source.stock,
    'INVALID_STOCK_QUANTITY',
    ERROR_MESSAGES.INVALID_STOCK_QUANTITY
  );
  const minStock = source.lowStockEnabled === false ? 0 : parseQuantity(
    source.minStock,
    'INVALID_MIN_STOCK',
    ERROR_MESSAGES.INVALID_MIN_STOCK
  );

  return Object.assign({
    name,
    productCode: normalizeText(source.code),
    category,
    unit,
    brand: normalizeText(source.brand),
    specification: normalizeText(source.specification),
    description: normalizeText(source.description),
    minStock,
    initialStock
  }, buildCoverPayload(source));
}

function createPayloadSignature(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return JSON.stringify(Object.keys(source).sort().reduce((result, key) => {
    if (key !== 'requestKey') {
      result[key] = source[key];
    }
    return result;
  }, {}));
}

function resolveCreateIntent(payload, state, keyFactory) {
  const current = state && typeof state === 'object' ? state : {};
  const signature = createPayloadSignature(payload);
  const generateKey = typeof keyFactory === 'function' ? keyFactory : createRequestKey;
  let requestKey = current.createRequestKey;

  if (!requestKey || (current.submittedPayloadHash && current.submittedPayloadHash !== signature)) {
    requestKey = generateKey('product');
  }

  return { requestKey, signature };
}

function validateCreateResult(result, initialStock) {
  if (!result || !result.product || !result.warehouseProduct) {
    throw createLocalError('INVALID_CREATE_RESPONSE', '创建结果不完整，请刷新后确认');
  }
  if (initialStock > 0 && !result.initialRecord) {
    throw createLocalError('INVALID_CREATE_RESPONSE', '初始库存流水未返回，请刷新后确认');
  }
  return result;
}

function isCreateAllowed(role) {
  return ALLOWED_ROLES.indexOf(role) > -1;
}

function getCreateErrorMessage(error) {
  if (error && error.code === 'CUSTOM_IMAGE_NOT_SUPPORTED') {
    return CUSTOM_IMAGE_MESSAGE;
  }
  if (error && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code];
  }
  if (error && error.code === 'INVALID_CREATE_RESPONSE') {
    return error.message;
  }
  return '创建失败，请稍后重试';
}

function shouldRestartStartup(code) {
  return ['NO_ACTIVE_TEAM', 'WAREHOUSE_NOT_FOUND', 'WAREHOUSE_NOT_ACTIVE'].indexOf(code) > -1;
}

module.exports = {
  STOCK_MAX,
  CUSTOM_IMAGE_MESSAGE,
  buildCreateProductPayload,
  createPayloadSignature,
  resolveCreateIntent,
  validateCreateResult,
  isCreateAllowed,
  getCreateErrorMessage,
  shouldRestartStartup
};
