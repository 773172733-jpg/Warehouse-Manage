const { ApiError, ERROR_CODES, isApiError } = require('../../common/errors.js');
const { COLLECTIONS, getDocument } = require('../../common/database.js');
const {
  createMembershipId,
  createStockMutationRecordId
} = require('../../common/idempotency.js');
const { computeStockStatus } = require('../../common/product-utils.js');
const {
  STOCK_TYPES,
  sanitizeStockInput,
  createStockRequestHash,
  calculateStockMutation
} = require('../../common/stock-utils.js');
const {
  requireProductAccess,
  requireProductAccessInTransaction
} = require('../product/product-service.js');

function resolveStockVersion(warehouseProduct) {
  if (warehouseProduct.stockVersion === undefined || warehouseProduct.stockVersion === null) {
    return 1;
  }
  if (!Number.isSafeInteger(warehouseProduct.stockVersion) || warehouseProduct.stockVersion < 1) {
    throw new ApiError(ERROR_CODES.STOCK_RECORD_CONFLICT, 'Stock version data is invalid.');
  }
  return warehouseProduct.stockVersion;
}

function presentStockMutation(record, idempotent) {
  return {
    recordId: record._id,
    type: record.type,
    warehouseProductId: record.warehouseProductId,
    productId: record.productId,
    beforeStock: record.beforeStock,
    afterStock: record.afterStock,
    delta: record.delta,
    stockStatus: record.stockStatus,
    stockVersion: record.stockVersionAfter,
    createdAt: record.createdAt || null,
    idempotent: Boolean(idempotent)
  };
}

function assertIdempotentRecord(record, context) {
  if (record.teamId !== context.teamId ||
      record.warehouseId !== context.warehouseId ||
      record.warehouseProductId !== context.warehouseProductId) {
    throw new ApiError(ERROR_CODES.STOCK_RECORD_CONFLICT, 'Stock request record belongs to another resource.');
  }
  if (record.requestAction !== context.action || record.requestHash !== context.requestHash) {
    throw new ApiError(ERROR_CODES.REQUEST_KEY_CONFLICT, 'Request key was already used with different stock parameters.');
  }
  if (!Number.isSafeInteger(record.stockVersionAfter) ||
      !Number.isSafeInteger(record.beforeStock) ||
      !Number.isSafeInteger(record.afterStock) ||
      !Number.isSafeInteger(record.delta) ||
      typeof record.stockStatus !== 'string') {
    throw new ApiError(ERROR_CODES.STOCK_RECORD_CONFLICT, 'Stored stock request result is incomplete.');
  }
  return record;
}

function assertWarehouseProduct(warehouseProduct, access, warehouseProductId) {
  if (!warehouseProduct ||
      warehouseProduct._id !== warehouseProductId ||
      warehouseProduct.teamId !== access.team._id ||
      warehouseProduct.warehouseId !== access.warehouse._id) {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE, 'Warehouse product not found.');
  }
  if (warehouseProduct.status !== 'active') {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE, 'Product was removed from this warehouse.');
  }
  return warehouseProduct;
}

function assertProduct(product, teamId) {
  if (!product || product.teamId !== teamId) {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
  }
  if (product.status !== 'active') {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_ACTIVE, 'Product was deleted from the shared catalog.');
  }
  return product;
}

function buildStockRecord(action, input, mutation, context) {
  return {
    teamId: context.teamId,
    warehouseId: context.warehouseId,
    warehouseProductId: context.warehouseProductId,
    productId: context.product._id,
    productNameSnapshot: context.product.name || context.warehouseProduct.productNameSnapshot || '',
    productCodeSnapshot: context.product.productCode || context.warehouseProduct.productCodeSnapshot || '',
    unitSnapshot: context.product.unit || context.warehouseProduct.unitSnapshot || '',
    type: STOCK_TYPES[action],
    beforeStock: mutation.beforeStock,
    afterStock: mutation.afterStock,
    delta: mutation.delta,
    quantity: mutation.quantity,
    changeQuantity: mutation.delta,
    stockStatus: context.stockStatus,
    reason: input.reason,
    referenceNo: input.referenceNo,
    sourceOrDestination: input.referenceNo,
    remark: '',
    requestAction: action,
    requestKey: input.requestKey,
    requestHash: context.requestHash,
    operatorUserId: context.user._id,
    operatorId: context.user._id,
    operatorRole: context.membership.role,
    operatorMemberId: context.membership._id,
    operatorNameSnapshot: context.user.displayName || '',
    stockVersionBefore: context.stockVersionBefore,
    stockVersionAfter: context.stockVersionAfter,
    createdAt: context.now
  };
}

async function assertStockMembershipState(db, user) {
  if (!user.currentTeamId) {
    return;
  }
  try {
    const membership = await getDocument(
      db,
      COLLECTIONS.TEAM_MEMBERS,
      createMembershipId(user.currentTeamId, user._id)
    );
    if (membership && membership.status !== 'active') {
      throw new ApiError(ERROR_CODES.FORBIDDEN, 'Current membership cannot operate stock.');
    }
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, 'Membership state could not be verified.');
  }
}

async function mutateStock(db, user, action, rawInput) {
  const input = sanitizeStockInput(action, rawInput);
  const requestHash = createStockRequestHash(action, input);
  await assertStockMembershipState(db, user);
  const access = await requireProductAccess(db, user, 'admin');
  const recordId = createStockMutationRecordId(
    access.team._id,
    access.warehouse._id,
    input.requestKey
  );
  let result;

  try {
    await db.runTransaction(async (transaction) => {
      const locked = await requireProductAccessInTransaction(
        transaction,
        user,
        access,
        'admin'
      );
      const existingRecord = await getDocument(
        transaction,
        COLLECTIONS.STOCK_RECORDS,
        recordId
      );
      if (existingRecord) {
        result = presentStockMutation(assertIdempotentRecord(existingRecord, {
          action,
          requestHash,
          teamId: locked.team._id,
          warehouseId: locked.warehouse._id,
          warehouseProductId: input.warehouseProductId
        }), true);
        return;
      }

      const warehouseProduct = assertWarehouseProduct(
        await getDocument(
          transaction,
          COLLECTIONS.WAREHOUSE_PRODUCTS,
          input.warehouseProductId
        ),
        locked,
        input.warehouseProductId
      );
      const product = assertProduct(
        await getDocument(transaction, COLLECTIONS.PRODUCTS, warehouseProduct.productId),
        locked.team._id
      );
      const stockVersionBefore = resolveStockVersion(warehouseProduct);
      if (input.expectedStockVersion !== stockVersionBefore) {
        throw new ApiError(ERROR_CODES.STOCK_VERSION_CONFLICT, 'Stock changed. Refresh and retry.');
      }

      const mutation = calculateStockMutation(action, input, warehouseProduct.stock);
      const stockStatus = computeStockStatus(mutation.afterStock, warehouseProduct.minStock);
      const stockVersionAfter = stockVersionBefore + 1;
      if (!Number.isSafeInteger(stockVersionAfter)) {
        throw new ApiError(ERROR_CODES.STOCK_VERSION_CONFLICT, 'Stock version cannot be incremented.');
      }
      const now = db.serverDate();
      const recordData = buildStockRecord(action, input, mutation, {
        teamId: locked.team._id,
        warehouseId: locked.warehouse._id,
        warehouseProductId: input.warehouseProductId,
        warehouseProduct,
        product,
        user: locked.user,
        membership: locked.membership,
        requestHash,
        stockStatus,
        stockVersionBefore,
        stockVersionAfter,
        now
      });
      const record = Object.assign({ _id: recordId }, recordData);

      await transaction.collection(COLLECTIONS.WAREHOUSE_PRODUCTS)
        .doc(input.warehouseProductId)
        .update({
          data: {
            stock: mutation.afterStock,
            stockStatus,
            stockVersion: stockVersionAfter,
            lastMutationAction: action,
            lastMutationRequestKey: input.requestKey,
            lastMutationInputHash: requestHash,
            updatedBy: locked.user._id,
            updatedAt: now
          }
        });
      await transaction.collection(COLLECTIONS.STOCK_RECORDS)
        .doc(recordId)
        .set({ data: recordData });
      result = presentStockMutation(record, false);
    });
    return result;
  } catch (error) {
    if (error && error.code === ERROR_CODES.MEMBERSHIP_NOT_ACTIVE) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, 'Current membership cannot operate stock.');
    }
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, 'Stock transaction failed. Please retry.');
  }
}

module.exports = {
  resolveStockVersion,
  presentStockMutation,
  assertIdempotentRecord,
  assertWarehouseProduct,
  assertProduct,
  buildStockRecord,
  assertStockMembershipState,
  mutateStock
};
