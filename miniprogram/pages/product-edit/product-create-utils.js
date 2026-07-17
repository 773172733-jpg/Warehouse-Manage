const { createRequestKey } = require('../../utils/request-key.js');
const { SYSTEM_ASSETS } = require('../../constants/product-cover-assets.js');

const STOCK_MAX = 999999999;
const ALLOWED_ROLES = ['owner', 'admin'];
const CUSTOM_IMAGE_MESSAGE = '图片尚未完成安全上传，请重新选择或重试。';
const DEFAULT_COVER_BACKGROUND = '#EAF6EF';
const SYSTEM_ASSET_EMOJIS = SYSTEM_ASSETS.map((item) => item.emoji);

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
  IMAGE_ASSET_NOT_FOUND: '图片上传状态已失效，请重新选择图片',
  IMAGE_ASSET_NOT_READY: '图片尚未完成安全确认，请重试',
  IMAGE_ASSET_EXPIRED: '图片上传已过期，请重新选择图片',
  IMAGE_ASSET_ALREADY_BOUND: '该图片已经用于其他产品，请重新选择',
  IMAGE_ASSET_STATE_CONFLICT: '图片上传状态异常，请重新选择图片',
  IMAGE_FILE_TOO_LARGE: '图片不能超过2 MiB',
  IMAGE_FILE_TYPE_INVALID: '请选择JPG、PNG或WebP图片',
  IMAGE_FILE_PATH_INVALID: '图片上传路径无效，请重新选择图片',
  IMAGE_FILE_DOWNLOAD_FAILED: '图片校验下载失败，请重新上传',
  IMAGE_FILE_CONFIRM_FAILED: '图片安全确认失败，请稍后重试',
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

const UPDATE_ERROR_MESSAGES = Object.assign({}, ERROR_MESSAGES, {
  FORBIDDEN: '你没有编辑产品的权限',
  PRODUCT_VERSION_CONFLICT: '产品已被其他成员修改，请刷新后重新编辑',
  PRODUCT_NOT_FOUND: '产品不存在，请返回库存页刷新',
  PRODUCT_NOT_ACTIVE: '产品当前不可编辑',
  PRODUCT_NOT_IN_WAREHOUSE: '该产品已不在当前仓库',
  INVALID_PRODUCT_VERSION: '产品版本无效，请重新加载',
  INTERNAL_ERROR: '更新失败，请稍后重试'
});

const STAGE_ERROR_MESSAGES = {
  prepare: '图片上传准备失败，请稍后重试',
  upload: '图片上传失败，请检查网络后重试',
  confirm: '图片安全校验失败，请重新选择后重试',
  create: '产品创建失败，请稍后重试'
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
    const assetKey = normalizeText(form.coverAssetKey);
    if (!/^product_image_[a-f0-9]{32}$/.test(assetKey)) {
      throw createLocalError('IMAGE_ASSET_NOT_READY', CUSTOM_IMAGE_MESSAGE);
    }
    return {
      coverType: 'image',
      coverText: '',
      coverEmoji: '',
      coverAssetKey: assetKey,
      coverBackground: ''
    };
  }
  if (form.coverMode === 'system') {
    const emoji = normalizeText(form.systemAssetEmoji);
    if (!emoji) {
      throw createLocalError('INVALID_COVER', ERROR_MESSAGES.INVALID_COVER);
    }
    if (SYSTEM_ASSET_EMOJIS.indexOf(emoji) === -1) {
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

function normalizeOriginalCover(cover) {
  const source = cover && typeof cover === 'object' ? cover : {};
  const type = normalizeText(source.type || source.coverType || 'none').toLowerCase();
  const hasBackground = type === 'text' || type === 'emoji';
  return {
    type,
    text: type === 'text' ? normalizeText(source.text || source.coverText) : '',
    emoji: type === 'emoji' ? normalizeText(source.emoji || source.coverEmoji) : '',
    background: hasBackground
      ? (normalizeText(source.background || source.coverBackground).toUpperCase() || DEFAULT_COVER_BACKGROUND)
      : ''
  };
}

function getFormCoverSnapshot(form) {
  const source = form && typeof form === 'object' ? form : {};
  if (source.coverMode === 'existing-image' || source.coverMode === 'custom') {
    return { type: 'image', text: '', emoji: '', background: '' };
  }
  if (source.coverMode === 'system') {
    return {
      type: 'emoji',
      text: '',
      emoji: normalizeText(source.systemAssetEmoji),
      background: normalizeText(source.coverColor).toUpperCase() || DEFAULT_COVER_BACKGROUND
    };
  }
  if (source.coverMode === 'none') {
    return { type: 'none', text: '', emoji: '', background: '' };
  }
  return {
    type: 'text',
    text: normalizeText(source.displayText),
    emoji: '',
    background: normalizeText(source.coverColor).toUpperCase() || DEFAULT_COVER_BACKGROUND
  };
}

function isCoverUnchanged(form, originalCover) {
  if (!originalCover || typeof originalCover !== 'object') return false;
  if (form && form.coverMode === 'custom') return false;
  const current = getFormCoverSnapshot(form);
  const original = normalizeOriginalCover(originalCover);
  if (current.type === 'image' || original.type === 'image') {
    return current.type === original.type;
  }
  return current.type === original.type &&
    current.text === original.text &&
    current.emoji === original.emoji &&
    current.background === original.background;
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

function buildProductMainPayload(form, options) {
  const source = form && typeof form === 'object' ? form : {};
  const settings = options && typeof options === 'object' ? options : {};
  const name = normalizeText(source.name);
  if (!name) throw createLocalError('INVALID_PRODUCT_NAME', ERROR_MESSAGES.INVALID_PRODUCT_NAME);
  const category = normalizeText(source.category);
  if (!category) throw createLocalError('INVALID_CATEGORY', ERROR_MESSAGES.INVALID_CATEGORY);
  const unit = source.unit === '其他' ? normalizeText(source.customUnit) : normalizeText(source.unit);
  if (!unit) throw createLocalError('INVALID_UNIT', ERROR_MESSAGES.INVALID_UNIT);
  const payload = {
    name,
    productCode: normalizeText(source.code),
    category,
    unit,
    brand: normalizeText(source.brand),
    specification: normalizeText(source.specification),
    description: normalizeText(source.description)
  };
  if (source.coverMode !== 'existing-image' && !isCoverUnchanged(source, settings.originalCover)) {
    Object.assign(payload, buildCoverPayload(source));
  }
  return payload;
}

function buildUpdateProductPayload(form, context) {
  const state = context && typeof context === 'object' ? context : {};
  const productId = normalizeText(state.productId);
  const expectedVersion = Number(state.expectedVersion);
  if (!productId) throw createLocalError('PRODUCT_NOT_FOUND', UPDATE_ERROR_MESSAGES.PRODUCT_NOT_FOUND);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw createLocalError('INVALID_PRODUCT_VERSION', UPDATE_ERROR_MESSAGES.INVALID_PRODUCT_VERSION);
  }
  return Object.assign({ productId, expectedVersion }, buildProductMainPayload(form, {
    originalCover: state.originalCover
  }));
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

function resolveUpdateIntent(payload, state, keyFactory) {
  const current = state && typeof state === 'object' ? state : {};
  const signature = createPayloadSignature(payload);
  const generateKey = typeof keyFactory === 'function' ? keyFactory : createRequestKey;
  let requestKey = current.updateRequestKey;
  if (!requestKey || (current.submittedPayloadHash && current.submittedPayloadHash !== signature)) {
    requestKey = generateKey('product_update');
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
  if (error && error.code === 'IMAGE_ASSET_NOT_READY') return CUSTOM_IMAGE_MESSAGE;
  const genericStageCodes = [
    'CLOUD_CALL_FAILED',
    'CLOUD_NOT_AVAILABLE',
    'BUSINESS_ERROR',
    'INTERNAL_ERROR'
  ];
  if (error && STAGE_ERROR_MESSAGES[error.stage] &&
      genericStageCodes.indexOf(error.code) > -1) {
    return STAGE_ERROR_MESSAGES[error.stage];
  }
  if (error && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code];
  }
  if (error && error.code === 'INVALID_CREATE_RESPONSE') {
    return error.message;
  }
  if (error && typeof error.message === 'string') {
    const message = error.message.trim();
    const containsSensitiveValue = /cloud:\/\/|product_image_|requestKey|assetKey|fileID/i.test(message);
    if (message && message.length <= 100 && !containsSensitiveValue) {
      if (error.stage === 'prepare') return `图片上传准备失败：${message}`;
      if (error.stage === 'upload') return `图片上传失败：${message}`;
      if (error.stage === 'confirm') return `图片安全校验失败：${message}`;
      if (error.stage === 'create') return `产品创建失败：${message}`;
      return message;
    }
  }
  if (error && STAGE_ERROR_MESSAGES[error.stage]) return STAGE_ERROR_MESSAGES[error.stage];
  return '创建失败，请稍后重试';
}

function getUpdateErrorMessage(error) {
  if (error && error.code === 'IMAGE_ASSET_NOT_READY') return CUSTOM_IMAGE_MESSAGE;
  if (error && UPDATE_ERROR_MESSAGES[error.code]) return UPDATE_ERROR_MESSAGES[error.code];
  return '更新失败，请稍后重试';
}

function shouldRestartStartup(code) {
  return ['NO_ACTIVE_TEAM', 'WAREHOUSE_NOT_FOUND', 'WAREHOUSE_NOT_ACTIVE'].indexOf(code) > -1;
}

module.exports = {
  STOCK_MAX,
  CUSTOM_IMAGE_MESSAGE,
  buildCreateProductPayload,
  buildProductMainPayload,
  buildUpdateProductPayload,
  isCoverUnchanged,
  createPayloadSignature,
  resolveCreateIntent,
  resolveUpdateIntent,
  validateCreateResult,
  isCreateAllowed,
  getCreateErrorMessage,
  getUpdateErrorMessage,
  shouldRestartStartup
};
