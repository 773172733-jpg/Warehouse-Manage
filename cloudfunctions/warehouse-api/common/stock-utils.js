const crypto = require('crypto');
const { ApiError, ERROR_CODES } = require('./errors.js');
const { validateRequestKey } = require('./validators.js');
const { STOCK_MAX, normalizeWhitespace } = require('./product-utils.js');

const STOCK_ACTIONS = {
  INBOUND: 'stock.inbound',
  OUTBOUND: 'stock.outbound',
  ADJUST: 'stock.adjust'
};

const STOCK_TYPES = {
  [STOCK_ACTIONS.INBOUND]: 'inbound',
  [STOCK_ACTIONS.OUTBOUND]: 'outbound',
  [STOCK_ACTIONS.ADJUST]: 'adjustment'
};

const COMMON_FIELDS = [
  'warehouseProductId',
  'expectedStockVersion',
  'reason',
  'referenceNo',
  'requestKey'
];

function hasOwn(source, field) {
  return Object.prototype.hasOwnProperty.call(source, field);
}

function validateText(value, options) {
  const text = normalizeWhitespace(value);
  if ((options.required && !text) || Array.from(text).length > options.maxLength) {
    throw new ApiError(options.code, options.message);
  }
  return text;
}

function validateWarehouseProductId(value) {
  const id = normalizeWhitespace(value);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE, 'Warehouse product not found.');
  }
  return id;
}

function validateExpectedStockVersion(value) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ApiError(ERROR_CODES.STOCK_VERSION_CONFLICT, 'Stock version is invalid. Refresh and retry.');
  }
  return version;
}

function validateQuantity(value) {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new ApiError(ERROR_CODES.INVALID_STOCK_QUANTITY, 'Quantity must be a positive integer.');
  }
  return quantity;
}

function validateTargetStock(value) {
  const targetStock = Number(value);
  if (!Number.isSafeInteger(targetStock) || targetStock < 0 || targetStock > STOCK_MAX) {
    throw new ApiError(ERROR_CODES.INVALID_TARGET_STOCK, 'Target stock must be an integer within the stock limit.');
  }
  return targetStock;
}

function sanitizeStockInput(action, rawInput) {
  if (!STOCK_TYPES[action]) {
    throw new ApiError(ERROR_CODES.UNKNOWN_ACTION, 'Unknown stock action.');
  }
  const source = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const valueField = action === STOCK_ACTIONS.ADJUST ? 'targetStock' : 'quantity';
  const allowed = COMMON_FIELDS.concat(valueField);
  const unknown = Object.keys(source).find((field) => !allowed.includes(field));
  if (unknown) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, 'Stock request contains a field that clients cannot set.');
  }

  const input = {
    warehouseProductId: validateWarehouseProductId(source.warehouseProductId),
    expectedStockVersion: validateExpectedStockVersion(source.expectedStockVersion),
    reason: validateText(source.reason, {
      required: action === STOCK_ACTIONS.ADJUST,
      maxLength: 100,
      code: ERROR_CODES.INVALID_INPUT,
      message: action === STOCK_ACTIONS.ADJUST
        ? 'Adjustment reason is required and must not exceed 100 characters.'
        : 'Reason must not exceed 100 characters.'
    }),
    referenceNo: validateText(source.referenceNo, {
      required: false,
      maxLength: 50,
      code: ERROR_CODES.INVALID_INPUT,
      message: 'Reference number must not exceed 50 characters.'
    }),
    requestKey: validateRequestKey(source.requestKey)
  };
  input[valueField] = action === STOCK_ACTIONS.ADJUST
    ? validateTargetStock(source[valueField])
    : validateQuantity(source[valueField]);
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

function createStockRequestHash(action, input) {
  const payload = {
    action,
    warehouseProductId: input.warehouseProductId,
    reason: input.reason,
    referenceNo: input.referenceNo,
    expectedStockVersion: input.expectedStockVersion
  };
  if (action === STOCK_ACTIONS.ADJUST) {
    payload.targetStock = input.targetStock;
  } else {
    payload.quantity = input.quantity;
  }
  return crypto.createHash('sha256').update(stableSerialize(payload)).digest('hex');
}

function calculateStockMutation(action, input, beforeStock) {
  if (!Number.isSafeInteger(beforeStock) || beforeStock < 0 || beforeStock > STOCK_MAX) {
    throw new ApiError(ERROR_CODES.STOCK_RECORD_CONFLICT, 'Current stock data is invalid.');
  }
  let afterStock;
  if (action === STOCK_ACTIONS.INBOUND) {
    afterStock = beforeStock + input.quantity;
    if (!Number.isSafeInteger(afterStock) || afterStock > STOCK_MAX) {
      throw new ApiError(ERROR_CODES.STOCK_LIMIT_EXCEEDED, 'Stock would exceed the allowed limit.');
    }
  } else if (action === STOCK_ACTIONS.OUTBOUND) {
    if (input.quantity > beforeStock) {
      throw new ApiError(ERROR_CODES.INSUFFICIENT_STOCK, 'Insufficient stock.');
    }
    afterStock = beforeStock - input.quantity;
  } else {
    afterStock = input.targetStock;
    if (afterStock === beforeStock) {
      throw new ApiError(ERROR_CODES.NO_STOCK_CHANGE, 'Target stock is unchanged.');
    }
  }
  return {
    beforeStock,
    afterStock,
    delta: afterStock - beforeStock,
    quantity: action === STOCK_ACTIONS.ADJUST
      ? Math.abs(afterStock - beforeStock)
      : input.quantity
  };
}

module.exports = {
  STOCK_ACTIONS,
  STOCK_TYPES,
  sanitizeStockInput,
  createStockRequestHash,
  calculateStockMutation
};
