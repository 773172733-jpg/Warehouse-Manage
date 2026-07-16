const { ERROR_CODES } = require('../constants/errors.js');

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;
const STOCK_MAX = 999999999;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const STOCK_STATUSES = ['normal', 'low', 'out'];
const PRODUCT_CATEGORIES = ['全部', '瓷砖', '工具', '五金', '耗材', '办公用品', '其他'];

const LOAD_ERROR_MESSAGES = {
  [ERROR_CODES.PRODUCT_NOT_FOUND]: '产品不存在或已被移除',
  [ERROR_CODES.PRODUCT_NOT_ACTIVE]: '产品当前不可用',
  [ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE]: '该产品不在当前仓库中',
  [ERROR_CODES.INVALID_CURSOR]: '列表状态已失效，请重新刷新',
  [ERROR_CODES.INVALID_PAGE_SIZE]: '加载参数不正确，请刷新页面',
  [ERROR_CODES.INVALID_CATEGORY]: '分类筛选条件不正确',
  INVALID_STOCK_STATUS: '库存状态筛选不正确',
  [ERROR_CODES.WAREHOUSE_NOT_FOUND]: '当前仓库不存在，请重新进入小程序',
  [ERROR_CODES.WAREHOUSE_NOT_ACTIVE]: '当前仓库暂不可用',
  [ERROR_CODES.NO_ACTIVE_TEAM]: '你当前没有可用团队',
  [ERROR_CODES.FORBIDDEN]: '你没有访问当前产品的权限',
  [ERROR_CODES.DATABASE_ERROR]: '服务暂时不可用，请稍后重试',
  [ERROR_CODES.INTERNAL_ERROR]: '加载失败，请稍后重试',
  [ERROR_CODES.CLOUD_CALL_FAILED]: '网络连接失败，请检查网络后重试',
  [ERROR_CODES.CLOUD_NOT_AVAILABLE]: '网络连接失败，请检查网络后重试',
  [ERROR_CODES.CLOUD_ENV_NOT_CONFIGURED]: '服务暂时不可用，请稍后重试'
};

function safeText(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function safeQuantity(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= STOCK_MAX ? number : null;
}

function getCoverView(cover, name) {
  const source = cover && typeof cover === 'object' ? cover : {};
  const type = safeText(source.type).toLowerCase();
  const background = safeText(source.background, '#F2F4F2');
  if (type === 'text' && safeText(source.text)) {
    return { type: 'text', content: safeText(source.text), background };
  }
  if (type === 'emoji' && safeText(source.emoji)) {
    return { type: 'emoji', content: safeText(source.emoji), background };
  }
  const fallback = Array.from(safeText(name, '仓'))[0] || '仓';
  return { type: 'none', content: fallback, background: '#F2F4F2' };
}

function normalizeStockStatus(value) {
  const status = safeText(value).toLowerCase();
  return STOCK_STATUSES.includes(status) ? status : 'unknown';
}

function mapInventoryItem(item) {
  if (!item || !PRODUCT_ID_PATTERN.test(safeText(item.id))) {
    return null;
  }
  const name = safeText(item.name, '未命名产品');
  const stock = safeQuantity(item.stock);
  const minStock = safeQuantity(item.minStock);
  return {
    warehouseProductId: safeText(item.id),
    productId: safeText(item.productId),
    name,
    productCode: safeText(item.productCode),
    category: safeText(item.category, '其他'),
    unit: safeText(item.unit),
    brand: safeText(item.brand),
    specification: safeText(item.specification),
    cover: getCoverView(item.cover, name),
    stock,
    stockText: stock === null ? '—' : String(stock),
    minStock,
    stockStatus: normalizeStockStatus(item.stockStatus),
    updatedAt: item.updatedAt || null,
    updatedAtText: formatDateTime(item.updatedAt)
  };
}

function normalizeListResponse(response) {
  const source = response && typeof response === 'object' ? response : {};
  const items = Array.isArray(source.items)
    ? source.items.map(mapInventoryItem).filter(Boolean)
    : [];
  const hasMore = Boolean(source.hasMore);
  return {
    items,
    hasMore,
    nextCursor: hasMore && typeof source.nextCursor === 'string' ? source.nextCursor : null
  };
}

function mergeInventoryItems(currentItems, incomingItems) {
  const merged = [];
  const positions = new Map();
  const append = (item) => {
    if (!item || !item.warehouseProductId) return;
    const existingIndex = positions.get(item.warehouseProductId);
    if (existingIndex === undefined) {
      positions.set(item.warehouseProductId, merged.length);
      merged.push(item);
    } else {
      merged[existingIndex] = item;
    }
  };
  (Array.isArray(currentItems) ? currentItems : []).forEach(append);
  (Array.isArray(incomingItems) ? incomingItems : []).forEach(append);
  return merged;
}

function getLoadedSummary(items) {
  const list = Array.isArray(items) ? items : [];
  return list.reduce((summary, item) => {
    summary.total += 1;
    if (item.stockStatus === 'low') summary.lowCount += 1;
    if (item.stockStatus === 'out') summary.outCount += 1;
    return summary;
  }, { total: 0, lowCount: 0, outCount: 0 });
}

function buildListParams(state, cursor) {
  const source = state && typeof state === 'object' ? state : {};
  const params = {
    pageSize: PAGE_SIZE,
    sort: 'updated_desc'
  };
  const keyword = safeText(source.keyword);
  const category = safeText(source.selectedCategory);
  const stockStatus = safeText(source.selectedStockStatus).toLowerCase();
  if (keyword) params.keyword = keyword;
  if (category && category !== '全部') params.category = category;
  if (STOCK_STATUSES.includes(stockStatus)) params.stockStatus = stockStatus;
  if (typeof cursor === 'string' && cursor) params.cursor = cursor;
  return params;
}

function formatDateTime(value) {
  if (!value) return '—';
  const source = value && typeof value === 'object' && value.$date ? value.$date : value;
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function mapProductDetail(response) {
  const product = response && response.product;
  const warehouseProduct = response && response.warehouseProduct;
  if (!product || !warehouseProduct ||
      !PRODUCT_ID_PATTERN.test(safeText(product.id)) ||
      !PRODUCT_ID_PATTERN.test(safeText(warehouseProduct.id))) {
    const error = new Error('产品详情响应不完整');
    error.code = ERROR_CODES.PRODUCT_NOT_FOUND;
    throw error;
  }
  const permissions = response.permissions && typeof response.permissions === 'object'
    ? response.permissions
    : {};
  const name = safeText(product.name, safeText(warehouseProduct.name, '未命名产品'));
  const stock = safeQuantity(warehouseProduct.stock);
  const minStock = safeQuantity(warehouseProduct.minStock);
  return {
    product: {
      id: safeText(product.id),
      name,
      productCode: safeText(product.productCode),
      category: safeText(product.category, '其他'),
      unit: safeText(product.unit),
      brand: safeText(product.brand),
      specification: safeText(product.specification),
      description: safeText(product.description),
      cover: getCoverView(product.cover, name),
      createdAtText: formatDateTime(product.createdAt),
      updatedAtText: formatDateTime(product.updatedAt)
    },
    warehouseProduct: {
      id: safeText(warehouseProduct.id),
      productId: safeText(warehouseProduct.productId),
      stock,
      stockText: stock === null ? '—' : String(stock),
      minStock,
      minStockText: minStock === null ? '—' : String(minStock),
      stockStatus: normalizeStockStatus(warehouseProduct.stockStatus),
      updatedAtText: formatDateTime(warehouseProduct.updatedAt)
    },
    permissions: {
      canEdit: Boolean(permissions.canEdit),
      canOperateStock: Boolean(permissions.canOperateStock),
      canRemove: Boolean(permissions.canRemove)
    }
  };
}

function getWarehouseProductId(query) {
  const source = query && typeof query === 'object' ? query : {};
  const selected = safeText(source.warehouseProductId) || safeText(source.id);
  return PRODUCT_ID_PATTERN.test(selected) ? selected : '';
}

function getLoadErrorMessage(error) {
  if (error && error.code === ERROR_CODES.INVALID_INPUT) {
    return '筛选或加载参数不正确，请刷新页面';
  }
  return LOAD_ERROR_MESSAGES[error && error.code] || '加载失败，请稍后重试';
}

function isContextInvalid(error) {
  return Boolean(error && [
    ERROR_CODES.NO_ACTIVE_TEAM,
    ERROR_CODES.MEMBERSHIP_NOT_ACTIVE,
    ERROR_CODES.TEAM_NOT_ACTIVE,
    ERROR_CODES.WAREHOUSE_NOT_FOUND,
    ERROR_CODES.WAREHOUSE_NOT_ACTIVE
  ].includes(error.code));
}

module.exports = {
  PAGE_SIZE,
  SEARCH_DEBOUNCE_MS,
  PRODUCT_CATEGORIES,
  safeQuantity,
  getCoverView,
  normalizeStockStatus,
  mapInventoryItem,
  normalizeListResponse,
  mergeInventoryItems,
  getLoadedSummary,
  buildListParams,
  formatDateTime,
  mapProductDetail,
  getWarehouseProductId,
  getLoadErrorMessage,
  isContextInvalid
};
