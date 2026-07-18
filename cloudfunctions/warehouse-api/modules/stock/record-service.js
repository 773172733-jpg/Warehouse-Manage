const crypto = require('crypto');
const { ApiError, ERROR_CODES, isApiError } = require('../../common/errors.js');
const { COLLECTIONS, getDocument } = require('../../common/database.js');
const { normalizeWhitespace } = require('../../common/product-utils.js');
const {
  requireProductAccess,
  assertWarehouseProductAccess
} = require('../product/product-service.js');

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

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SCAN_RECORDS,
  RECORD_TYPES,
  encodeRecordCursor,
  decodeRecordCursor,
  validateRecordListInput,
  presentStockRecord,
  listStockRecords
};
