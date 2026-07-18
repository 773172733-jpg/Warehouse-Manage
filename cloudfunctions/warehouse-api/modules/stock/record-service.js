const crypto = require('crypto');
const { ApiError, ERROR_CODES, isApiError } = require('../../common/errors.js');
const { COLLECTIONS, getDocument } = require('../../common/database.js');
const { createMembershipId } = require('../../common/idempotency.js');
const { normalizeWhitespace } = require('../../common/product-utils.js');
const {
  requireProductAccess,
  assertWarehouseProductAccess
} = require('../product/product-service.js');
const {
  resolveProductImageAccessUrls
} = require('../../common/product-image-access.js');

const RECORD_TYPES = Object.freeze([
  'all',
  'initial',
  'inbound',
  'outbound',
  'adjustment'
]);
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const QUERY_CHUNK_SIZE = 50;
const MAX_SCAN_RECORDS = 500;
const MAX_DATE_RANGE_DAYS = 366;
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

function safeText(value, maxLength) {
  return Array.from(normalizeWhitespace(value)).slice(0, maxLength).join('');
}

function safeInteger(value, fallback) {
  return Number.isSafeInteger(value) ? value : fallback;
}

function getDateMillis(value) {
  if (value && typeof value.toDate === 'function') {
    return getDateMillis(value.toDate());
  }
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : NaN;
}

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function buildQueryHash(warehouseProductId, type) {
  return crypto
    .createHash('sha256')
    .update(`${warehouseProductId}\n${type}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

function buildWarehouseQueryHash(input, access) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      v: 1,
      warehouseId: access.warehouse._id,
      type: input.type,
      startAt: input.startAtIso,
      endAt: input.endAtIso,
      pageSize: input.pageSize
    }), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

function encodeRecordCursor(record, queryHash) {
  const createdAt = getDateMillis(record && record.createdAt);
  const id = record && record._id;
  if (!Number.isFinite(createdAt) || !RECORD_ID_PATTERN.test(id || '')) {
    return null;
  }
  return encodeBase64Url(JSON.stringify({
    v: 1,
    c: createdAt,
    i: id,
    s: 'created_desc',
    q: queryHash
  }));
}

function decodeRecordCursor(value, queryHash) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ApiError(ERROR_CODES.INVALID_CURSOR, '流水分页游标无效，请重新加载。');
  }
  try {
    const cursor = JSON.parse(decodeBase64Url(value));
    if (cursor.v !== 1 || cursor.s !== 'created_desc' ||
        cursor.q !== queryHash ||
        !Number.isSafeInteger(cursor.c) || cursor.c < 0 ||
        !RECORD_ID_PATTERN.test(cursor.i || '')) {
      throw new Error('invalid cursor');
    }
    return {
      createdAt: new Date(cursor.c),
      id: cursor.i
    };
  } catch (error) {
    throw new ApiError(ERROR_CODES.INVALID_CURSOR, '流水分页游标无效，请重新加载。');
  }
}

function parseOptionalIsoDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new ApiError(ERROR_CODES.INVALID_DATE_RANGE, `${fieldName} must be an ISO UTC timestamp.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ApiError(ERROR_CODES.INVALID_DATE_RANGE, `${fieldName} is invalid.`);
  }
  return date;
}

function normalizeIso(value) {
  return value instanceof Date ? value.toISOString() : '';
}

function validateWarehouseRecordListInput(rawInput) {
  const source = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
    ? rawInput
    : {};
  const allowed = ['type', 'startAt', 'endAt', 'cursor', 'pageSize'];
  const unknown = Object.keys(source).find((field) => !allowed.includes(field));
  if (unknown) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, 'Warehouse record list request contains forbidden fields.');
  }

  const type = normalizeWhitespace(source.type || 'all').toLowerCase();
  if (!RECORD_TYPES.includes(type)) {
    throw new ApiError(ERROR_CODES.INVALID_RECORD_TYPE, 'Stock record type is invalid.');
  }

  const startAt = parseOptionalIsoDate(source.startAt, 'startAt');
  const endAt = parseOptionalIsoDate(source.endAt, 'endAt');
  if (startAt && endAt && startAt.getTime() > endAt.getTime()) {
    throw new ApiError(ERROR_CODES.INVALID_DATE_RANGE, 'startAt must not be later than endAt.');
  }
  if (startAt && endAt) {
    const span = endAt.getTime() - startAt.getTime();
    if (span > MAX_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      throw new ApiError(ERROR_CODES.INVALID_DATE_RANGE, 'Date range is too large.');
    }
  }

  const pageSize = source.pageSize === undefined
    ? DEFAULT_PAGE_SIZE
    : Number(source.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new ApiError(ERROR_CODES.INVALID_PAGE_SIZE, 'Page size must be between 1 and 50.');
  }

  return {
    type,
    startAt,
    endAt,
    startAtIso: normalizeIso(startAt),
    endAtIso: normalizeIso(endAt),
    cursorSource: source.cursor,
    pageSize
  };
}

function validateRecordListInput(rawInput) {
  const source = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
    ? rawInput
    : {};
  const allowed = ['warehouseProductId', 'type', 'cursor', 'pageSize'];
  const unknown = Object.keys(source).find((field) => !allowed.includes(field));
  if (unknown) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '库存流水请求包含不允许的字段。');
  }

  const warehouseProductId = normalizeWhitespace(source.warehouseProductId);
  if (!RECORD_ID_PATTERN.test(warehouseProductId)) {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE, '当前仓库没有该产品。');
  }
  const type = normalizeWhitespace(source.type || 'all').toLowerCase();
  if (!RECORD_TYPES.includes(type)) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, '库存流水类型无效。');
  }
  const pageSize = source.pageSize === undefined
    ? DEFAULT_PAGE_SIZE
    : Number(source.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new ApiError(ERROR_CODES.INVALID_PAGE_SIZE, '每页数量需要在1至50之间。');
  }
  const queryHash = buildQueryHash(warehouseProductId, type);

  return {
    warehouseProductId,
    type,
    pageSize,
    queryHash,
    cursor: decodeRecordCursor(source.cursor, queryHash)
  };
}

function buildRecordWhere(command, access, warehouseProductId, cursor) {
  const base = {
    teamId: access.team._id,
    warehouseId: access.warehouse._id,
    warehouseProductId
  };
  if (!cursor) return base;

  return command.or([
    Object.assign({}, base, {
      createdAt: command.lt(cursor.createdAt)
    }),
    Object.assign({}, base, {
      createdAt: command.eq(cursor.createdAt),
      _id: command.lt(cursor.id)
    })
  ]);
}

function buildCreatedAtCommand(command, input, cursorBranch) {
  const filters = [];
  if (input.startAt) filters.push(command.gte(input.startAt));
  if (input.endAt) filters.push(command.lte(input.endAt));
  if (cursorBranch === 'beforeCreatedAt') filters.push(command.lt(input.cursor.createdAt));
  if (cursorBranch === 'sameCreatedAt') filters.push(command.eq(input.cursor.createdAt));
  if (!filters.length) return undefined;
  return filters.reduce((current, next) => current ? current.and(next) : next, null);
}

function buildWarehouseRecordBase(access, input) {
  const base = {
    teamId: access.team._id,
    warehouseId: access.warehouse._id
  };
  if (input.type !== 'all') base.type = input.type;
  return base;
}

function buildWarehouseRecordWhere(command, access, input) {
  const base = buildWarehouseRecordBase(access, input);
  if (!input.cursor) {
    const createdAt = buildCreatedAtCommand(command, input);
    return createdAt ? Object.assign({}, base, { createdAt }) : base;
  }
  const beforeCreatedAt = buildCreatedAtCommand(command, input, 'beforeCreatedAt');
  const sameCreatedAt = buildCreatedAtCommand(command, input, 'sameCreatedAt');
  return command.or([
    Object.assign({}, base, {
      createdAt: beforeCreatedAt
    }),
    Object.assign({}, base, {
      createdAt: sameCreatedAt,
      _id: command.lt(input.cursor.id)
    })
  ]);
}

async function queryRecordChunk(db, access, input, cursor, limit) {
  const result = await db.collection(COLLECTIONS.STOCK_RECORDS)
    .where(buildRecordWhere(
      db.command,
      access,
      input.warehouseProductId,
      cursor
    ))
    .orderBy('createdAt', 'desc')
    .orderBy('_id', 'desc')
    .limit(limit)
    .field({
      _id: true,
      type: true,
      beforeStock: true,
      afterStock: true,
      delta: true,
      quantity: true,
      changeQuantity: true,
      stockStatus: true,
      reason: true,
      referenceNo: true,
      sourceOrDestination: true,
      remark: true,
      operatorRole: true,
      operatorNameSnapshot: true,
      stockVersionBefore: true,
      stockVersionAfter: true,
      createdAt: true
    })
    .get();
  return result.data || [];
}

function normalizeRecordType(value) {
  const type = normalizeWhitespace(value).toLowerCase();
  return RECORD_TYPES.includes(type) && type !== 'all' ? type : 'initial';
}

function getOperatorDisplayName(record) {
  const name = safeText(record && record.operatorNameSnapshot, 50);
  if (name) return name;
  if (record && record.operatorRole === 'owner') return '所有者';
  if (record && record.operatorRole === 'admin') return '管理员';
  return '系统记录';
}

function presentStockRecord(record) {
  const delta = safeInteger(
    record && record.delta,
    safeInteger(record && record.changeQuantity, 0)
  );
  const beforeStock = safeInteger(record && record.beforeStock, 0);
  const afterStock = safeInteger(record && record.afterStock, beforeStock + delta);
  const operatorRole = record && ['owner', 'admin'].includes(record.operatorRole)
    ? record.operatorRole
    : '';

  return {
    id: safeText(record && record._id, 80),
    type: normalizeRecordType(record && record.type),
    beforeStock,
    afterStock,
    delta,
    quantity: safeInteger(record && record.quantity, Math.abs(delta)),
    stockStatus: safeText(record && record.stockStatus, 20),
    reason: safeText(
      (record && record.reason) || (record && record.remark),
      100
    ),
    referenceNo: safeText(
      (record && record.referenceNo) || (record && record.sourceOrDestination),
      50
    ),
    operatorDisplayName: getOperatorDisplayName(record),
    operatorRole,
    stockVersionBefore: Number.isSafeInteger(record && record.stockVersionBefore)
      ? record.stockVersionBefore
      : null,
    stockVersionAfter: Number.isSafeInteger(record && record.stockVersionAfter)
      ? record.stockVersionAfter
      : null,
    createdAt: (record && record.createdAt) || null
  };
}

function getSnapshotName(record) {
  return safeText(record && record.productNameSnapshot, 80) || '历史商品';
}

function getProductCode(record, product, warehouseProduct) {
  return safeText(
    (product && product.productCode) ||
      (warehouseProduct && warehouseProduct.productCodeSnapshot) ||
      (record && record.productCodeSnapshot),
    50
  );
}

function getUnit(record, product, warehouseProduct) {
  return safeText(
    (product && product.unit) ||
      (warehouseProduct && warehouseProduct.unitSnapshot) ||
      (record && record.unitSnapshot),
    20
  );
}

function buildFallbackCover(source) {
  const type = source && source.type ? source.type : 'none';
  return {
    type,
    text: source && source.text ? source.text : '',
    emoji: source && source.emoji ? source.emoji : '',
    background: source && source.background ? source.background : '',
    imageUrl: '',
    imageUrlExpiresAt: null,
    imageAvailable: false
  };
}

function buildRecordCover(product, warehouseProduct, imageAccess) {
  const access = imageAccess && typeof imageAccess === 'object' ? imageAccess : {};
  if (product) {
    const type = product.coverType || 'none';
    return {
      type,
      text: product.coverText || '',
      emoji: product.coverEmoji || '',
      background: product.coverBackground || '',
      imageUrl: type === 'image' && access.imageAvailable ? access.imageUrl || '' : '',
      imageUrlExpiresAt: type === 'image' && access.imageAvailable
        ? access.imageUrlExpiresAt || null
        : null,
      imageAvailable: Boolean(type === 'image' && access.imageAvailable && access.imageUrl)
    };
  }
  const snapshot = warehouseProduct && warehouseProduct.coverSummarySnapshot;
  return buildFallbackCover(snapshot);
}

function presentWarehouseStockRecord(record, maps) {
  const productsById = maps.productsById;
  const warehouseProductsById = maps.warehouseProductsById;
  const imageAccessByProductId = maps.imageAccessByProductId;
  const product = productsById.get(record.productId);
  const warehouseProduct = warehouseProductsById.get(record.warehouseProductId);
  const activeProduct = product && product.status === 'active' ? product : null;
  const activeWarehouseProduct = warehouseProduct && warehouseProduct.status === 'active'
    ? warehouseProduct
    : null;
  const imageAccess = imageAccessByProductId.get(record.productId);
  const base = presentStockRecord(record);
  const name = safeText(
    (activeProduct && activeProduct.name) ||
      (warehouseProduct && warehouseProduct.productNameSnapshot) ||
      getSnapshotName(record),
    80
  );
  return Object.assign({}, base, {
    productId: safeText(record.productId, 80),
    warehouseProductId: safeText(record.warehouseProductId, 80),
    productName: name || '历史商品',
    productCode: getProductCode(record, activeProduct, warehouseProduct),
    unit: getUnit(record, activeProduct, warehouseProduct),
    cover: buildRecordCover(activeProduct, warehouseProduct, imageAccess),
    canNavigate: Boolean(
      activeProduct &&
      activeWarehouseProduct &&
      activeWarehouseProduct.teamId === maps.teamId &&
      activeWarehouseProduct.warehouseId === maps.warehouseId &&
      activeWarehouseProduct.productId === activeProduct._id
    ),
    productStatus: activeProduct ? 'active' : 'historical'
  });
}

function recordMatchesType(record, type) {
  return type === 'all' || normalizeRecordType(record && record.type) === type;
}

async function listStockRecords(db, user, rawInput) {
  const input = validateRecordListInput(rawInput);
  try {
    const access = await requireProductAccess(db, user);
    const warehouseProduct = await getDocument(
      db,
      COLLECTIONS.WAREHOUSE_PRODUCTS,
      input.warehouseProductId
    );
    assertWarehouseProductAccess(warehouseProduct, access);

    const matches = [];
    let scanCursor = input.cursor;
    let scanned = 0;
    let sourceExhausted = false;
    let lastScannedRecord = null;

    while (matches.length <= input.pageSize &&
           scanned < MAX_SCAN_RECORDS &&
           !sourceExhausted) {
      const limit = Math.min(QUERY_CHUNK_SIZE, MAX_SCAN_RECORDS - scanned);
      const records = await queryRecordChunk(db, access, input, scanCursor, limit);
      if (records.length < limit) sourceExhausted = true;
      if (!records.length) break;

      for (const record of records) {
        scanned += 1;
        lastScannedRecord = record;
        scanCursor = {
          createdAt: new Date(getDateMillis(record.createdAt)),
          id: record._id
        };
        if (recordMatchesType(record, input.type)) {
          matches.push(record);
          if (matches.length > input.pageSize) break;
        }
      }
    }

    const page = matches.slice(0, input.pageSize);
    const hasExtraMatch = matches.length > input.pageSize;
    const scanContinues = !sourceExhausted && scanned >= MAX_SCAN_RECORDS;
    const hasMore = hasExtraMatch || scanContinues;
    const cursorRecord = hasExtraMatch
      ? page[page.length - 1]
      : lastScannedRecord;

    return {
      items: page.map(presentStockRecord),
      nextCursor: hasMore && cursorRecord
        ? encodeRecordCursor(cursorRecord, input.queryHash)
        : null,
      hasMore,
      pageSize: input.pageSize
    };
  } catch (error) {
    if (isApiError(error)) throw error;
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '库存流水读取失败，请稍后重试。');
  }
}

async function assertWarehouseLedgerMembershipState(db, user) {
  if (!user || !user.currentTeamId || !user._id) return;
  const membership = await getDocument(
    db,
    COLLECTIONS.TEAM_MEMBERS,
    createMembershipId(user.currentTeamId, user._id)
  );
  if (membership && membership.status !== 'active') {
    throw new ApiError(ERROR_CODES.FORBIDDEN, 'Current membership cannot view stock records.');
  }
}

async function queryWarehouseRecordPage(db, access, input) {
  const result = await db.collection(COLLECTIONS.STOCK_RECORDS)
    .where(buildWarehouseRecordWhere(db.command, access, input))
    .orderBy('createdAt', 'desc')
    .orderBy('_id', 'desc')
    .limit(input.pageSize + 1)
    .field({
      _id: true,
      productId: true,
      warehouseProductId: true,
      productNameSnapshot: true,
      productCodeSnapshot: true,
      unitSnapshot: true,
      type: true,
      beforeStock: true,
      afterStock: true,
      delta: true,
      quantity: true,
      changeQuantity: true,
      stockStatus: true,
      reason: true,
      referenceNo: true,
      sourceOrDestination: true,
      remark: true,
      operatorRole: true,
      operatorNameSnapshot: true,
      stockVersionBefore: true,
      stockVersionAfter: true,
      createdAt: true
    })
    .get();
  return result.data || [];
}

async function loadDocumentsByIds(db, collectionName, ids, fields) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return new Map();
  const result = await db.collection(collectionName)
    .where({ _id: db.command.in(uniqueIds) })
    .limit(uniqueIds.length)
    .field(fields)
    .get();
  return new Map((result.data || []).map((document) => [document._id, document]));
}

async function loadRecordProductMaps(db, access, records, options) {
  const productIds = records.map((record) => record && record.productId);
  const warehouseProductIds = records.map((record) => record && record.warehouseProductId);
  const productsById = await loadDocumentsByIds(db, COLLECTIONS.PRODUCTS, productIds, {
    _id: true,
    teamId: true,
    status: true,
    name: true,
    productCode: true,
    unit: true,
    coverType: true,
    coverText: true,
    coverEmoji: true,
    coverAssetKey: true,
    coverFileId: true,
    coverBackground: true
  });
  const warehouseProductsById = await loadDocumentsByIds(
    db,
    COLLECTIONS.WAREHOUSE_PRODUCTS,
    warehouseProductIds,
    {
      _id: true,
      teamId: true,
      warehouseId: true,
      productId: true,
      status: true,
      productNameSnapshot: true,
      productCodeSnapshot: true,
      unitSnapshot: true,
      coverSummarySnapshot: true
    }
  );
  for (const [id, product] of productsById.entries()) {
    if (product.teamId !== access.team._id) productsById.delete(id);
  }
  for (const [id, warehouseProduct] of warehouseProductsById.entries()) {
    if (warehouseProduct.teamId !== access.team._id ||
        warehouseProduct.warehouseId !== access.warehouse._id) {
      warehouseProductsById.delete(id);
    }
  }
  const coverSources = Array.from(productsById.values()).filter((product) => {
    return product && product.status === 'active';
  });
  const imageAccessByProductId = await resolveProductImageAccessUrls({
    cloud: options && options.cloud,
    db,
    teamId: access.team._id,
    products: coverSources
  });
  return {
    teamId: access.team._id,
    warehouseId: access.warehouse._id,
    productsById,
    warehouseProductsById,
    imageAccessByProductId
  };
}

async function listWarehouseStockRecords(db, user, rawInput, options) {
  const raw = validateWarehouseRecordListInput(rawInput);
  try {
    await assertWarehouseLedgerMembershipState(db, user);
    const access = await requireProductAccess(db, user);
    const queryHash = buildWarehouseQueryHash(raw, access);
    const input = Object.assign({}, raw, {
      queryHash,
      cursor: decodeRecordCursor(raw.cursorSource, queryHash)
    });
    const documents = await queryWarehouseRecordPage(db, access, input);
    const hasMore = documents.length > input.pageSize;
    const page = documents.slice(0, input.pageSize);
    const maps = await loadRecordProductMaps(db, access, page, options);
    return {
      items: page.map((record) => presentWarehouseStockRecord(record, maps)),
      nextCursor: hasMore && page.length
        ? encodeRecordCursor(page[page.length - 1], queryHash)
        : null,
      hasMore,
      pageSize: input.pageSize
    };
  } catch (error) {
    if (isApiError(error)) throw error;
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, 'Warehouse stock records could not be loaded.');
  }
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SCAN_RECORDS,
  RECORD_TYPES,
  encodeRecordCursor,
  decodeRecordCursor,
  validateRecordListInput,
  validateWarehouseRecordListInput,
  presentStockRecord,
  presentWarehouseStockRecord,
  listStockRecords,
  listWarehouseStockRecords
};
