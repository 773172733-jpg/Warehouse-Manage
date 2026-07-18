const { ApiError, ERROR_CODES, isApiError } = require('../../common/errors.js');
const { COLLECTIONS, getDocument } = require('../../common/database.js');
const {
  createMembershipId,
  createProductId,
  createWarehouseProductId,
  createStockRecordId
} = require('../../common/idempotency.js');
const { requireCurrentTeamAccess, requireRole } = require('../../common/permissions.js');
const {
  resolveProductImageAccessUrls
} = require('../../common/product-image-access.js');
const {
  sanitizeProductInput,
  sanitizeProductUpdateInput,
  sanitizeWarehouseMutationInput,
  sanitizeCatalogDeleteInput,
  sanitizeCatalogRestoreInput,
  createProductRequestHash,
  createMutationRequestHash,
  computeStockStatus,
  assertProductCountWithinLimit,
  buildCoverSummary,
  buildSearchKeywords,
  encodeProductCursor,
  normalizeProductName,
  normalizeProductCode,
  validateProductListInput,
  validateSearchRebuildInput,
  validateRemovedProductListInput,
  validateDeletedCatalogListInput,
  validateProductDetailInput,
  getProductPermissionFlags,
  presentProduct,
  presentWarehouseProduct,
  presentRemovedProduct,
  presentDeletedCatalogProduct,
  presentStockRecord
} = require('../../common/product-utils.js');
const {
  resolveImageCoverInTransaction,
  bindImageAssetInTransaction,
  orphanImageAssetInTransaction
} = require('./image-service.js');

const PRODUCT_CREATE_ACTION = 'product.create';
const PRODUCT_UPDATE_ACTION = 'product.update';
const PRODUCT_REMOVE_ACTION = 'product.removeFromWarehouse';
const PRODUCT_RESTORE_ACTION = 'product.restoreToWarehouse';
const PRODUCT_CATALOG_DELETE_ACTION = 'product.catalog.delete';
const PRODUCT_CATALOG_RESTORE_ACTION = 'product.catalog.restore';

function getImageAccess(accessByProductId, productId) {
  return accessByProductId instanceof Map ? accessByProductId.get(productId) : null;
}

function resolveImageAccess(db, options, teamId, products) {
  return resolveProductImageAccessUrls({
    cloud: options && options.cloud,
    db,
    teamId,
    products
  });
}

async function loadProductCoverSources(db, teamId, warehouseProducts) {
  const productIds = Array.from(new Set(
    (Array.isArray(warehouseProducts) ? warehouseProducts : [])
      .map((warehouseProduct) => warehouseProduct && warehouseProduct.productId)
      .filter(Boolean)
  ));
  if (!productIds.length) return new Map();
  const result = await db.collection(COLLECTIONS.PRODUCTS)
    .where({ _id: db.command.in(productIds) })
    .limit(productIds.length)
    .field({
      _id: true,
      teamId: true,
      status: true,
      coverType: true,
      coverText: true,
      coverEmoji: true,
      coverAssetKey: true,
      coverFileId: true,
      coverBackground: true
    })
    .get();
  return new Map((result.data || [])
    .filter((product) => product.teamId === teamId && product.status === 'active')
    .map((product) => [product._id, product]));
}

async function loadProductSearchSources(db, teamId, warehouseProducts) {
  const productIds = Array.from(new Set(
    (Array.isArray(warehouseProducts) ? warehouseProducts : [])
      .map((warehouseProduct) => warehouseProduct && warehouseProduct.productId)
      .filter(Boolean)
  ));
  if (!productIds.length) return new Map();
  const result = await db.collection(COLLECTIONS.PRODUCTS)
    .where({ _id: db.command.in(productIds) })
    .limit(productIds.length)
    .field({
      _id: true,
      teamId: true,
      status: true,
      name: true,
      normalizedName: true,
      productCode: true,
      normalizedCode: true,
      category: true,
      unit: true,
      brand: true,
      specification: true,
      searchKeywords: true,
      version: true
    })
    .get();
  return new Map((result.data || [])
    .filter((product) => product.teamId === teamId && product.status === 'active')
    .map((product) => [product._id, product]));
}

async function requireProductAccess(db, user, requiredRole) {
  const access = await requireCurrentTeamAccess(db, user);
  if (requiredRole) {
    requireRole(access.membership, requiredRole);
  }
  const warehouseId = user.currentWarehouseId || access.team.defaultWarehouseId;
  const warehouse = warehouseId
    ? await getDocument(db, COLLECTIONS.WAREHOUSES, warehouseId)
    : null;
  if (!warehouse || warehouse.teamId !== access.team._id) {
    throw new ApiError(ERROR_CODES.WAREHOUSE_NOT_FOUND, '当前仓库不存在。');
  }
  if (warehouse.status !== 'active') {
    throw new ApiError(ERROR_CODES.WAREHOUSE_NOT_ACTIVE, '当前仓库不可用。');
  }
  return Object.assign({}, access, { warehouse });
}

async function requireProductAccessInTransaction(transaction, user, access, requiredRole) {
  const lockedUser = await getDocument(transaction, COLLECTIONS.USERS, user._id);
  const team = await getDocument(transaction, COLLECTIONS.TEAMS, access.team._id);
  const membership = await getDocument(
    transaction,
    COLLECTIONS.TEAM_MEMBERS,
    createMembershipId(access.team._id, user._id)
  );
  const warehouse = await getDocument(
    transaction,
    COLLECTIONS.WAREHOUSES,
    access.warehouse._id
  );
  if (!lockedUser || lockedUser.status !== 'active') {
    throw new ApiError(ERROR_CODES.USER_DISABLED, '当前用户不可用。');
  }
  if (!team || team.status !== 'active') {
    throw new ApiError(ERROR_CODES.TEAM_NOT_ACTIVE, '当前团队不可用。');
  }
  if (lockedUser.currentTeamId !== team._id) {
    throw new ApiError(ERROR_CODES.NO_ACTIVE_TEAM, '当前团队上下文已经变化，请刷新后重试。');
  }
  requireRole(membership, requiredRole);
  if (!warehouse || warehouse.teamId !== team._id) {
    throw new ApiError(ERROR_CODES.WAREHOUSE_NOT_FOUND, '当前仓库不存在。');
  }
  if (warehouse.status !== 'active') {
    throw new ApiError(ERROR_CODES.WAREHOUSE_NOT_ACTIVE, '当前仓库不可用。');
  }
  const currentWarehouseId = lockedUser.currentWarehouseId || team.defaultWarehouseId;
  if (currentWarehouseId !== warehouse._id) {
    throw new ApiError(ERROR_CODES.WAREHOUSE_NOT_FOUND, '当前仓库上下文已经变化，请刷新后重试。');
  }
  return { user: lockedUser, team, membership, warehouse };
}

async function requireCatalogAccess(db, user) {
  const access = await requireCurrentTeamAccess(db, user);
  requireRole(access.membership, 'owner');
  return access;
}

async function requireCatalogAccessInTransaction(transaction, user, access) {
  const lockedUser = await getDocument(transaction, COLLECTIONS.USERS, user._id);
  const team = await getDocument(transaction, COLLECTIONS.TEAMS, access.team._id);
  const membership = await getDocument(
    transaction,
    COLLECTIONS.TEAM_MEMBERS,
    createMembershipId(access.team._id, user._id)
  );
  if (!lockedUser || lockedUser.status !== 'active') {
    throw new ApiError(ERROR_CODES.USER_DISABLED, '当前用户不可用。');
  }
  if (!team || team.status !== 'active') {
    throw new ApiError(ERROR_CODES.TEAM_NOT_ACTIVE, '当前团队不可用。');
  }
  if (lockedUser.currentTeamId !== team._id) {
    throw new ApiError(ERROR_CODES.NO_ACTIVE_TEAM, '当前团队上下文已经变化，请刷新后重试。');
  }
  requireRole(membership, 'owner');
  return { user: lockedUser, team, membership };
}

function buildProductDocument(input, context) {
  return {
    teamId: context.teamId,
    name: input.name,
    normalizedName: input.normalizedName,
    productCode: input.productCode,
    normalizedCode: input.normalizedCode,
    category: input.category,
    unit: input.unit,
    brand: input.brand,
    specification: input.specification,
    description: input.description,
    searchKeywords: input.searchKeywords,
    coverType: input.coverType,
    coverText: input.coverText,
    coverEmoji: input.coverEmoji,
    coverAssetKey: input.coverAssetKey,
    coverFileId: input.coverFileId,
    coverBackground: input.coverBackground,
    status: 'active',
    version: 1,
    activeWarehouseCount: 1,
    createRequestKey: input.requestKey,
    createRequestHash: context.requestHash,
    lastMutationAction: PRODUCT_CREATE_ACTION,
    lastMutationRequestKey: input.requestKey,
    lastMutationInputHash: context.requestHash,
    createdBy: context.userId,
    updatedBy: context.userId,
    deletedBy: null,
    restoredBy: null,
    createdAt: context.now,
    updatedAt: context.now,
    deletedAt: null,
    restoredAt: null
  };
}

function buildWarehouseProductDocument(input, productId, context) {
  return {
    teamId: context.teamId,
    warehouseId: context.warehouseId,
    productId,
    status: 'active',
    stock: input.initialStock,
    minStock: input.minStock,
    stockStatus: computeStockStatus(input.initialStock, input.minStock),
    stockVersion: 1,
    productVersion: 1,
    productNameSnapshot: input.name,
    normalizedNameSnapshot: input.normalizedName,
    productCodeSnapshot: input.productCode,
    normalizedCodeSnapshot: input.normalizedCode,
    categorySnapshot: input.category,
    unitSnapshot: input.unit,
    brandSnapshot: input.brand,
    specificationSnapshot: input.specification,
    searchKeywordsSnapshot: input.searchKeywords,
    coverSummarySnapshot: buildCoverSummary(input),
    createRequestKey: input.requestKey,
    createRequestHash: context.requestHash,
    lastMutationAction: PRODUCT_CREATE_ACTION,
    lastMutationRequestKey: input.requestKey,
    lastMutationInputHash: context.requestHash,
    createdBy: context.userId,
    updatedBy: context.userId,
    removedBy: null,
    restoredBy: null,
    createdAt: context.now,
    updatedAt: context.now,
    removedAt: null,
    restoredAt: null
  };
}

function buildInitialRecordDocument(input, productId, warehouseProductId, context) {
  if (input.initialStock <= 0) {
    return null;
  }
  return {
    teamId: context.teamId,
    warehouseId: context.warehouseId,
    productId,
    warehouseProductId,
    productNameSnapshot: input.name,
    productCodeSnapshot: input.productCode,
    unitSnapshot: input.unit,
    type: 'initial',
    changeQuantity: input.initialStock,
    beforeStock: 0,
    afterStock: input.initialStock,
    reason: 'initial_stock',
    sourceOrDestination: '',
    remark: '',
    operatorId: context.userId,
    operatorMemberId: context.membershipId,
    operatorNameSnapshot: context.operatorName,
    requestAction: PRODUCT_CREATE_ACTION,
    requestKey: input.requestKey,
    requestHash: context.requestHash,
    createdAt: context.now
  };
}

function assertExistingCreate(existing, warehouseProduct, initialRecord, input, requestHash) {
  if (existing.teamId !== warehouseProduct.teamId ||
      existing.createRequestKey !== input.requestKey ||
      existing.createRequestHash !== requestHash) {
    throw new ApiError(ERROR_CODES.REQUEST_KEY_CONFLICT, '请求标识已用于其他产品参数。');
  }
  if (existing.status !== 'active' || warehouseProduct.status !== 'active' ||
      warehouseProduct.productId !== existing._id ||
      warehouseProduct.createRequestHash !== requestHash) {
    throw new ApiError(ERROR_CODES.DUPLICATE_REQUEST, '产品创建记录不完整，请联系管理员处理。');
  }
  if (input.initialStock > 0 && (!initialRecord || initialRecord.requestHash !== requestHash)) {
    throw new ApiError(ERROR_CODES.DUPLICATE_REQUEST, '初始库存流水不完整，请联系管理员处理。');
  }
}

function isDuplicateKeyError(error) {
  const message = error && (error.errMsg || error.message || '');
  return /duplicate|duplicated|E11000|unique/i.test(message);
}

async function loadCreateDocuments(source, ids) {
  const product = await getDocument(source, COLLECTIONS.PRODUCTS, ids.productId);
  const warehouseProduct = await getDocument(
    source,
    COLLECTIONS.WAREHOUSE_PRODUCTS,
    ids.warehouseProductId
  );
  const initialRecord = ids.initialRecordId
    ? await getDocument(source, COLLECTIONS.STOCK_RECORDS, ids.initialRecordId)
    : null;
  return { product, warehouseProduct, initialRecord };
}

async function createProduct(db, user, rawInput, options) {
  const input = sanitizeProductInput(rawInput);
  const requestHash = createProductRequestHash(input);
  const access = await requireProductAccess(db, user, 'admin');
  const ids = {
    productId: createProductId(access.team._id, input.requestKey)
  };
  ids.warehouseProductId = createWarehouseProductId(
    access.team._id,
    access.warehouse._id,
    ids.productId
  );
  ids.initialRecordId = input.initialStock > 0
    ? createStockRecordId(access.team._id, access.warehouse._id, PRODUCT_CREATE_ACTION, input.requestKey)
    : '';
  let idempotent = false;

  try {
    await db.runTransaction(async (transaction) => {
      const locked = await requireProductAccessInTransaction(
        transaction,
        user,
        access,
        'admin'
      );
      const documents = await loadCreateDocuments(transaction, ids);
      if (documents.product) {
        if (!documents.warehouseProduct) {
          throw new ApiError(ERROR_CODES.DUPLICATE_REQUEST, '产品创建记录不完整，请联系管理员处理。');
        }
        assertExistingCreate(
          documents.product,
          documents.warehouseProduct,
          documents.initialRecord,
          input,
          requestHash
        );
        idempotent = true;
        return;
      }

      const activeProductCount = assertProductCountWithinLimit(locked.team.activeProductCount);

      const now = db.serverDate();
      const lifecycleNow = new Date();
      const documentContext = {
        teamId: locked.team._id,
        warehouseId: locked.warehouse._id,
        userId: locked.user._id,
        membershipId: locked.membership._id,
        operatorName: locked.user.displayName || '微信用户',
        requestHash,
        now
      };
      const resolvedCover = await resolveImageCoverInTransaction(
        transaction,
        input,
        documentContext,
        ids.productId,
        lifecycleNow
      );
      const resolvedInput = resolvedCover.input;
      const product = buildProductDocument(resolvedInput, documentContext);
      const warehouseProduct = buildWarehouseProductDocument(
        resolvedInput,
        ids.productId,
        documentContext
      );
      const initialRecord = buildInitialRecordDocument(
        resolvedInput,
        ids.productId,
        ids.warehouseProductId,
        documentContext
      );

      await transaction.collection(COLLECTIONS.PRODUCTS).doc(ids.productId).set({ data: product });
      await transaction.collection(COLLECTIONS.WAREHOUSE_PRODUCTS)
        .doc(ids.warehouseProductId)
        .set({ data: warehouseProduct });
      if (initialRecord) {
        await transaction.collection(COLLECTIONS.STOCK_RECORDS)
          .doc(ids.initialRecordId)
          .set({ data: initialRecord });
      }
      await transaction.collection(COLLECTIONS.TEAMS).doc(locked.team._id).update({
        data: {
          activeProductCount: activeProductCount + 1,
          updatedAt: now
        }
      });
      await bindImageAssetInTransaction(
        transaction,
        resolvedCover.asset,
        documentContext,
        ids.productId,
        lifecycleNow
      );
      idempotent = false;
    }, 5);

    const documents = await loadCreateDocuments(db, ids);
    if (!documents.product || !documents.warehouseProduct) {
      throw new ApiError(ERROR_CODES.DATABASE_ERROR, '产品创建结果读取失败，请稍后重试。');
    }
    const imageAccess = await resolveImageAccess(db, options, access.team._id, [documents.product]);
    return {
      product: presentProduct(
        documents.product,
        getImageAccess(imageAccess, documents.product._id)
      ),
      warehouseProduct: presentWarehouseProduct(
        documents.warehouseProduct,
        getImageAccess(imageAccess, documents.product._id)
      ),
      initialRecord: presentStockRecord(documents.initialRecord),
      idempotent
    };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    if (isDuplicateKeyError(error)) {
      try {
        const documents = await loadCreateDocuments(db, ids);
        if (documents.product && documents.warehouseProduct) {
          assertExistingCreate(
            documents.product,
            documents.warehouseProduct,
            documents.initialRecord,
            input,
            requestHash
          );
          const imageAccess = await resolveImageAccess(
            db,
            options,
            access.team._id,
            [documents.product]
          );
          return {
            product: presentProduct(
              documents.product,
              getImageAccess(imageAccess, documents.product._id)
            ),
            warehouseProduct: presentWarehouseProduct(
              documents.warehouseProduct,
              getImageAccess(imageAccess, documents.product._id)
            ),
            initialRecord: presentStockRecord(documents.initialRecord),
            idempotent: true
          };
        }
      } catch (recoveryError) {
        if (isApiError(recoveryError)) {
          throw recoveryError;
        }
      }
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '产品创建失败，请稍后使用原请求标识重试。');
  }
}

function createNamePrefixCommand(command, keyword) {
  return command.gte(keyword).and(command.lt(`${keyword}\uffff`));
}

function buildProductListWhere(command, input, access, status) {
  const base = {
    teamId: access.team._id,
    warehouseId: access.warehouse._id,
    status: status || 'active'
  };
  if (input.category) {
    base.categorySnapshot = input.category;
  }
  if (input.stockStatus) {
    base.stockStatus = input.stockStatus;
  }

  let branches = [base];
  if (input.keyword) {
    branches = [
      Object.assign({}, base, { normalizedCodeSnapshot: input.keyword }),
      Object.assign({}, base, {
        normalizedNameSnapshot: createNamePrefixCommand(command, input.keyword)
      })
    ];
    if (input.searchToken) {
      branches.push(Object.assign({}, base, { searchKeywordsSnapshot: input.searchToken }));
    }
  }

  if (input.cursor) {
    branches = branches.reduce((result, branch) => {
      result.push(Object.assign({}, branch, {
        updatedAt: command.lt(input.cursor.updatedAt)
      }));
      result.push(Object.assign({}, branch, {
        updatedAt: command.eq(input.cursor.updatedAt),
        _id: command.lt(input.cursor.id)
      }));
      return result;
    }, []);
  }
  return branches.length === 1 ? branches[0] : command.or(branches);
}

function buildDeletedCatalogListWhere(command, input, teamId) {
  const base = { teamId, status: 'deleted' };
  if (input.category) base.category = input.category;
  let branches = input.keyword ? [
    Object.assign({}, base, { normalizedCode: input.keyword }),
    Object.assign({}, base, { normalizedName: createNamePrefixCommand(command, input.keyword) }),
    Object.assign({}, base, { searchKeywords: input.keyword })
  ] : [base];

  if (input.cursor) {
    branches = branches.reduce((result, branch) => {
      result.push(Object.assign({}, branch, { updatedAt: command.lt(input.cursor.updatedAt) }));
      result.push(Object.assign({}, branch, {
        updatedAt: command.eq(input.cursor.updatedAt),
        _id: command.lt(input.cursor.id)
      }));
      return result;
    }, []);
  }
  return branches.length === 1 ? branches[0] : command.or(branches);
}

function buildProductMainUpdate(input, currentProduct) {
  const update = {
    name: input.name,
    normalizedName: input.normalizedName,
    productCode: input.productCode,
    normalizedCode: input.normalizedCode,
    category: input.category,
    unit: input.unit,
    brand: input.brand,
    specification: input.specification,
    description: input.description,
    searchKeywords: input.searchKeywords
  };
  if (!input.preserveCover) {
    Object.assign(update, {
      coverType: input.coverType,
      coverText: input.coverText,
      coverEmoji: input.coverEmoji,
      coverAssetKey: input.coverAssetKey,
      coverFileId: input.coverFileId,
      coverBackground: input.coverBackground
    });
  } else {
    Object.assign(update, {
      coverType: currentProduct.coverType || 'none',
      coverText: currentProduct.coverText || '',
      coverEmoji: currentProduct.coverEmoji || '',
      coverAssetKey: currentProduct.coverAssetKey || '',
      coverFileId: currentProduct.coverFileId || '',
      coverBackground: currentProduct.coverBackground || ''
    });
  }
  return update;
}

function buildProductSnapshotUpdate(product, version, context) {
  return {
    productNameSnapshot: product.name,
    normalizedNameSnapshot: product.normalizedName,
    productCodeSnapshot: product.productCode,
    normalizedCodeSnapshot: product.normalizedCode,
    categorySnapshot: product.category,
    unitSnapshot: product.unit,
    brandSnapshot: product.brand,
    specificationSnapshot: product.specification,
    searchKeywordsSnapshot: product.searchKeywords,
    coverSummarySnapshot: buildCoverSummary(product),
    productVersion: version,
    updatedBy: context.userId,
    updatedAt: context.now
  };
}

function assertWarehouseProductScope(warehouseProduct, access) {
  if (!warehouseProduct || warehouseProduct.teamId !== access.team._id ||
      warehouseProduct.warehouseId !== access.warehouse._id) {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE, '当前仓库没有该产品。');
  }
  return warehouseProduct;
}

async function updateProduct(db, user, rawInput, options) {
  const input = sanitizeProductUpdateInput(rawInput);
  const access = await requireProductAccess(db, user, 'admin');
  const warehouseProductId = createWarehouseProductId(
    access.team._id,
    access.warehouse._id,
    input.productId
  );
  const requestHash = createMutationRequestHash(PRODUCT_UPDATE_ACTION, {
    teamId: access.team._id,
    productId: input.productId
  }, input);
  let idempotent = false;

  try {
    await db.runTransaction(async (transaction) => {
      const locked = await requireProductAccessInTransaction(transaction, user, access, 'admin');
      const product = await getDocument(transaction, COLLECTIONS.PRODUCTS, input.productId);
      assertProductAccess(product, locked.team._id);
      const warehouseProduct = await getDocument(
        transaction,
        COLLECTIONS.WAREHOUSE_PRODUCTS,
        warehouseProductId
      );
      assertWarehouseProductAccess(warehouseProduct, locked, input.productId);

      if (product.lastUpdateRequestKey === input.requestKey) {
        if (product.lastUpdateRequestHash !== requestHash) {
          throw new ApiError(ERROR_CODES.REQUEST_KEY_CONFLICT, '请求标识已用于其他产品更新参数。');
        }
        idempotent = true;
        return;
      }
      if (!Number.isSafeInteger(product.version) || product.version !== input.expectedVersion) {
        throw new ApiError(ERROR_CODES.PRODUCT_VERSION_CONFLICT, '产品已被其他成员修改，请刷新后重新编辑。');
      }

      const now = db.serverDate();
      const lifecycleNow = new Date();
      const nextVersion = product.version + 1;
      const imageContext = {
        teamId: locked.team._id,
        userId: locked.user._id
      };
      const resolvedCover = await resolveImageCoverInTransaction(
        transaction,
        input,
        imageContext,
        product._id,
        lifecycleNow
      );
      const mainUpdate = buildProductMainUpdate(resolvedCover.input, product);
      const replacesOldImage = product.coverType === 'image' && product.coverAssetKey &&
        !resolvedCover.input.preserveCover &&
        (mainUpdate.coverType !== 'image' || mainUpdate.coverAssetKey !== product.coverAssetKey);
      await transaction.collection(COLLECTIONS.PRODUCTS).doc(product._id).update({
        data: Object.assign({}, mainUpdate, {
          version: nextVersion,
          updatedBy: locked.user._id,
          updatedAt: now,
          lastUpdateRequestKey: input.requestKey,
          lastUpdateRequestHash: requestHash,
          lastUpdateResultVersion: nextVersion,
          lastUpdateAt: now,
          lastMutationAction: PRODUCT_UPDATE_ACTION,
          lastMutationRequestKey: input.requestKey,
          lastMutationInputHash: requestHash
        })
      });
      await transaction.collection(COLLECTIONS.WAREHOUSE_PRODUCTS).doc(warehouseProduct._id).update({
        data: Object.assign(buildProductSnapshotUpdate(mainUpdate, nextVersion, {
          userId: locked.user._id,
          now
        }), {
          lastMutationAction: PRODUCT_UPDATE_ACTION,
          lastMutationRequestKey: input.requestKey,
          lastMutationInputHash: requestHash
        })
      });
      await bindImageAssetInTransaction(
        transaction,
        resolvedCover.asset,
        imageContext,
        product._id,
        lifecycleNow
      );
      if (replacesOldImage) {
        await orphanImageAssetInTransaction(
          transaction,
          product.coverAssetKey,
          imageContext,
          product._id,
          lifecycleNow
        );
      }
      idempotent = false;
    }, 5);

    const product = await getDocument(db, COLLECTIONS.PRODUCTS, input.productId);
    const warehouseProduct = await getDocument(db, COLLECTIONS.WAREHOUSE_PRODUCTS, warehouseProductId);
    if (!product || !warehouseProduct) {
      throw new ApiError(ERROR_CODES.DATABASE_ERROR, '产品更新结果读取失败，请稍后重试。');
    }
    const imageAccess = await resolveImageAccess(db, options, access.team._id, [product]);
    return {
      product: presentProduct(product, getImageAccess(imageAccess, product._id)),
      warehouseProduct: presentWarehouseProduct(
        warehouseProduct,
        getImageAccess(imageAccess, product._id)
      ),
      permissions: getProductPermissionFlags(access.membership.role),
      idempotent
    };
  } catch (error) {
    if (isApiError(error)) throw error;
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '产品更新失败，请稍后使用原请求标识重试。');
  }
}

async function removeProductFromWarehouse(db, user, rawInput, options) {
  const input = sanitizeWarehouseMutationInput(rawInput, true);
  const access = await requireProductAccess(db, user, 'admin');
  const requestHash = createMutationRequestHash(PRODUCT_REMOVE_ACTION, {
    teamId: access.team._id,
    warehouseId: access.warehouse._id,
    warehouseProductId: input.warehouseProductId
  }, input);
  let idempotent = false;

  try {
    await db.runTransaction(async (transaction) => {
      const locked = await requireProductAccessInTransaction(transaction, user, access, 'admin');
      const warehouseProduct = assertWarehouseProductScope(
        await getDocument(transaction, COLLECTIONS.WAREHOUSE_PRODUCTS, input.warehouseProductId),
        locked
      );
      if (warehouseProduct.removeRequestKey === input.requestKey &&
          warehouseProduct.removeRequestHash !== requestHash) {
        throw new ApiError(ERROR_CODES.REQUEST_KEY_CONFLICT, '请求标识已用于其他移除参数。');
      }
      if (warehouseProduct.status === 'removed') {
        if (warehouseProduct.removeRequestKey === input.requestKey &&
            warehouseProduct.removeRequestHash === requestHash) {
          idempotent = true;
          return;
        }
        throw new ApiError(ERROR_CODES.PRODUCT_ALREADY_REMOVED, '该产品已经从当前仓库移除。');
      }
      if (warehouseProduct.removeRequestKey === input.requestKey) {
        throw new ApiError(ERROR_CODES.DUPLICATE_REQUEST, '该移除请求已完成且产品状态已变化，请刷新确认。');
      }
      if (warehouseProduct.status !== 'active') {
        throw new ApiError(ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE, '当前仓库没有该产品。');
      }
      if (warehouseProduct.stock !== 0) {
        throw new ApiError(ERROR_CODES.PRODUCT_HAS_STOCK, '当前库存不为0，请先完成出库或库存调整。');
      }
      const product = await getDocument(transaction, COLLECTIONS.PRODUCTS, warehouseProduct.productId);
      assertProductAccess(product, locked.team._id);
      const now = db.serverDate();
      const activeWarehouseCount = assertStrictCount(
        product.activeWarehouseCount,
        ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT,
        '产品仓库状态异常，请刷新后重试。'
      );
      if (activeWarehouseCount < 1) {
        throw new ApiError(
          ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT,
          '产品仓库状态异常，请刷新后重试。'
        );
      }
      await transaction.collection(COLLECTIONS.WAREHOUSE_PRODUCTS).doc(warehouseProduct._id).update({
        data: {
          status: 'removed',
          removalReason: input.reason,
          removeRequestKey: input.requestKey,
          removeRequestHash: requestHash,
          removedBy: locked.user._id,
          removedAt: now,
          updatedBy: locked.user._id,
          updatedAt: now,
          lastMutationAction: PRODUCT_REMOVE_ACTION,
          lastMutationRequestKey: input.requestKey,
          lastMutationInputHash: requestHash
        }
      });
      await transaction.collection(COLLECTIONS.PRODUCTS).doc(product._id).update({
        data: { activeWarehouseCount: activeWarehouseCount - 1 }
      });
      idempotent = false;
    }, 5);
    const warehouseProduct = await getDocument(
      db,
      COLLECTIONS.WAREHOUSE_PRODUCTS,
      input.warehouseProductId
    );
    const product = warehouseProduct
      ? await getDocument(db, COLLECTIONS.PRODUCTS, warehouseProduct.productId)
      : null;
    if (!warehouseProduct) {
      throw new ApiError(ERROR_CODES.DATABASE_ERROR, '产品移除结果读取失败，请稍后重试。');
    }
    const imageSource = product || warehouseProduct;
    const imageAccess = await resolveImageAccess(db, options, access.team._id, [imageSource]);
    return {
      item: presentRemovedProduct(
        product,
        warehouseProduct,
        access.membership.role,
        getImageAccess(imageAccess, warehouseProduct.productId)
      ),
      idempotent
    };
  } catch (error) {
    if (isApiError(error)) throw error;
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '产品移除失败，请稍后使用原请求标识重试。');
  }
}

async function listRemovedProducts(db, user, rawInput, options) {
  const input = validateRemovedProductListInput(rawInput);
  try {
    const access = await requireProductAccess(db, user, 'admin');
    const where = buildProductListWhere(db.command, input, access, 'removed');
    const result = await db.collection(COLLECTIONS.WAREHOUSE_PRODUCTS)
      .where(where)
      .orderBy('updatedAt', 'desc')
      .orderBy('_id', 'desc')
      .limit(input.pageSize + 1)
      .field({
        _id: true,
        productId: true,
        teamId: true,
        warehouseId: true,
        status: true,
        productNameSnapshot: true,
        productCodeSnapshot: true,
        categorySnapshot: true,
        unitSnapshot: true,
        coverSummarySnapshot: true,
        stock: true,
        removedAt: true,
        removalReason: true,
        updatedAt: true
      })
      .get();
    const documents = result.data || [];
    const hasMore = documents.length > input.pageSize;
    const page = documents.slice(0, input.pageSize);
    const products = await Promise.all(page.map((item) => {
      return getDocument(db, COLLECTIONS.PRODUCTS, item.productId);
    }));
    const imageSources = page.map((item, index) => {
      return products[index] && products[index].status === 'active' ? products[index] : item;
    });
    const imageAccess = await resolveImageAccess(db, options, access.team._id, imageSources);
    return {
      items: page.map((item, index) => {
        return presentRemovedProduct(
          products[index],
          item,
          access.membership.role,
          getImageAccess(imageAccess, item.productId)
        );
      }),
      nextCursor: hasMore && page.length ? encodeProductCursor(page[page.length - 1]) : null,
      hasMore,
      pageSize: input.pageSize
    };
  } catch (error) {
    if (isApiError(error)) throw error;
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '产品回收站读取失败，请稍后重试。');
  }
}

async function restoreProductToWarehouse(db, user, rawInput, options) {
  const input = sanitizeWarehouseMutationInput(rawInput, false);
  const access = await requireProductAccess(db, user, 'admin');
  const requestHash = createMutationRequestHash(PRODUCT_RESTORE_ACTION, {
    teamId: access.team._id,
    warehouseId: access.warehouse._id,
    warehouseProductId: input.warehouseProductId
  }, input);
  let idempotent = false;

  try {
    await db.runTransaction(async (transaction) => {
      const locked = await requireProductAccessInTransaction(transaction, user, access, 'admin');
      const warehouseProduct = assertWarehouseProductScope(
        await getDocument(transaction, COLLECTIONS.WAREHOUSE_PRODUCTS, input.warehouseProductId),
        locked
      );
      if (warehouseProduct.restoreRequestKey === input.requestKey &&
          warehouseProduct.restoreRequestHash !== requestHash) {
        throw new ApiError(ERROR_CODES.REQUEST_KEY_CONFLICT, '请求标识已用于其他恢复参数。');
      }
      if (warehouseProduct.status === 'active') {
        if (warehouseProduct.restoreRequestKey === input.requestKey &&
            warehouseProduct.restoreRequestHash === requestHash) {
          idempotent = true;
          return;
        }
        throw new ApiError(ERROR_CODES.PRODUCT_ALREADY_ACTIVE, '该产品已经恢复到当前仓库。');
      }
      if (warehouseProduct.restoreRequestKey === input.requestKey) {
        throw new ApiError(ERROR_CODES.DUPLICATE_REQUEST, '该恢复请求已完成且产品状态已变化，请刷新确认。');
      }
      if (warehouseProduct.status !== 'removed') {
        throw new ApiError(ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE, '当前仓库没有可恢复的产品。');
      }
      if (warehouseProduct.stock !== 0) {
        throw new ApiError(ERROR_CODES.PRODUCT_HAS_STOCK, '回收站产品库存异常，无法恢复。');
      }
      const product = await getDocument(transaction, COLLECTIONS.PRODUCTS, warehouseProduct.productId);
      if (!product || product.teamId !== locked.team._id) {
        throw new ApiError(ERROR_CODES.PRODUCT_NOT_FOUND, '产品不存在。');
      }
      if (product.status !== 'active') {
        throw new ApiError(ERROR_CODES.PRODUCT_CATALOG_DELETED, '共享产品目录已删除，暂时无法恢复。');
      }
      const now = db.serverDate();
      const activeWarehouseCount = assertStrictCount(
        product.activeWarehouseCount,
        ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT,
        '产品仓库状态异常，请刷新后重试。'
      );
      await transaction.collection(COLLECTIONS.WAREHOUSE_PRODUCTS).doc(warehouseProduct._id).update({
        data: Object.assign(buildProductSnapshotUpdate(product, product.version, {
          userId: locked.user._id,
          now
        }), {
          status: 'active',
          stock: 0,
          stockStatus: computeStockStatus(0, warehouseProduct.minStock),
          removalReason: '',
          removedAt: null,
          restoreRequestKey: input.requestKey,
          restoreRequestHash: requestHash,
          restoredBy: locked.user._id,
          restoredAt: now,
          lastMutationAction: PRODUCT_RESTORE_ACTION,
          lastMutationRequestKey: input.requestKey,
          lastMutationInputHash: requestHash
        })
      });
      await transaction.collection(COLLECTIONS.PRODUCTS).doc(product._id).update({
        data: { activeWarehouseCount: activeWarehouseCount + 1 }
      });
      idempotent = false;
    }, 5);
    const warehouseProduct = await getDocument(
      db,
      COLLECTIONS.WAREHOUSE_PRODUCTS,
      input.warehouseProductId
    );
    const product = warehouseProduct
      ? await getDocument(db, COLLECTIONS.PRODUCTS, warehouseProduct.productId)
      : null;
    if (!warehouseProduct || !product) {
      throw new ApiError(ERROR_CODES.DATABASE_ERROR, '产品恢复结果读取失败，请稍后重试。');
    }
    const imageAccess = await resolveImageAccess(db, options, access.team._id, [product]);
    return {
      product: presentProduct(product, getImageAccess(imageAccess, product._id)),
      warehouseProduct: presentWarehouseProduct(
        warehouseProduct,
        getImageAccess(imageAccess, product._id)
      ),
      permissions: getProductPermissionFlags(access.membership.role),
      idempotent
    };
  } catch (error) {
    if (isApiError(error)) throw error;
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '产品恢复失败，请稍后使用原请求标识重试。');
  }
}

function assertStrictCount(value, code, message) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(code, message);
  }
  return value;
}

function assertCatalogWarehouseCount(product) {
  const activeWarehouseCount = assertStrictCount(
    product.activeWarehouseCount,
    ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT,
    '产品仓库状态异常，请刷新后重试。'
  );
  if (activeWarehouseCount > 0) {
    throw new ApiError(
      ERROR_CODES.PRODUCT_STILL_IN_WAREHOUSE,
      '该产品仍存在于仓库中，请先从所有仓库移除。'
    );
  }
  return activeWarehouseCount;
}

function assertCatalogProductScope(product, teamId) {
  if (!product || product.teamId !== teamId) {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_FOUND, '产品不存在。');
  }
  return product;
}

async function deleteCatalogProduct(db, user, rawInput, options) {
  const input = sanitizeCatalogDeleteInput(rawInput);
  const access = await requireCatalogAccess(db, user);
  const requestHash = createMutationRequestHash(PRODUCT_CATALOG_DELETE_ACTION, {
    teamId: access.team._id,
    productId: input.productId
  }, input);
  let idempotent = false;

  try {
    const preflightProduct = assertCatalogProductScope(
      await getDocument(db, COLLECTIONS.PRODUCTS, input.productId),
      access.team._id
    );
    assertCatalogWarehouseCount(preflightProduct);
    await db.runTransaction(async (transaction) => {
      const locked = await requireCatalogAccessInTransaction(transaction, user, access);
      const product = assertCatalogProductScope(
        await getDocument(transaction, COLLECTIONS.PRODUCTS, input.productId),
        locked.team._id
      );
      if (product.catalogDeleteRequestKey === input.requestKey &&
          product.catalogDeleteRequestHash !== requestHash) {
        throw new ApiError(ERROR_CODES.REQUEST_KEY_CONFLICT, '请求标识已用于其他目录删除参数。');
      }
      if (product.status === 'deleted') {
        if (product.catalogDeleteRequestKey === input.requestKey &&
            product.catalogDeleteRequestHash === requestHash) {
          idempotent = true;
          return;
        }
        throw new ApiError(ERROR_CODES.PRODUCT_ALREADY_DELETED, '该共享产品目录已经删除。');
      }
      if (product.catalogDeleteRequestKey === input.requestKey) {
        throw new ApiError(ERROR_CODES.DUPLICATE_REQUEST, '该目录删除请求已完成且产品状态已变化。');
      }
      if (product.status !== 'active') {
        throw new ApiError(ERROR_CODES.PRODUCT_NOT_ACTIVE, '产品当前不可删除。');
      }
      if (!Number.isSafeInteger(product.version) || product.version !== input.expectedVersion) {
        throw new ApiError(ERROR_CODES.PRODUCT_VERSION_CONFLICT, '产品状态已被其他成员修改，请刷新后重试。');
      }

      assertCatalogWarehouseCount(product);
      const activeProductCount = assertStrictCount(
        locked.team.activeProductCount,
        ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT,
        '团队产品计数异常，请稍后重试。'
      );
      if (activeProductCount < 1) {
        throw new ApiError(ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT, '团队产品计数异常，请稍后重试。');
      }

      const now = db.serverDate();
      const nextVersion = product.version + 1;
      await transaction.collection(COLLECTIONS.PRODUCTS).doc(product._id).update({
        data: {
          status: 'deleted',
          version: nextVersion,
          activeWarehouseCount: 0,
          deletedAt: now,
          deletedBy: locked.user._id,
          deletionReason: input.reason,
          updatedAt: now,
          updatedBy: locked.user._id,
          catalogDeleteRequestKey: input.requestKey,
          catalogDeleteRequestHash: requestHash,
          catalogDeleteResultVersion: nextVersion,
          lastMutationAction: PRODUCT_CATALOG_DELETE_ACTION,
          lastMutationRequestKey: input.requestKey,
          lastMutationInputHash: requestHash
        }
      });
      await transaction.collection(COLLECTIONS.TEAMS).doc(locked.team._id).update({
        data: { activeProductCount: activeProductCount - 1, updatedAt: now }
      });
      idempotent = false;
    }, 5);

    const product = await getDocument(db, COLLECTIONS.PRODUCTS, input.productId);
    if (!product || product.teamId !== access.team._id || product.status !== 'deleted') {
      throw new ApiError(ERROR_CODES.DATABASE_ERROR, '共享目录删除结果读取失败，请稍后重试。');
    }
    const imageAccess = await resolveImageAccess(db, options, access.team._id, [product]);
    return {
      item: presentDeletedCatalogProduct(
        product,
        access.membership.role,
        getImageAccess(imageAccess, product._id)
      ),
      idempotent
    };
  } catch (error) {
    if (isApiError(error)) throw error;
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '共享目录删除失败，请稍后使用原请求标识重试。');
  }
}

async function listDeletedCatalogProducts(db, user, rawInput, options) {
  const input = validateDeletedCatalogListInput(rawInput);
  try {
    const access = await requireCatalogAccess(db, user);
    const where = buildDeletedCatalogListWhere(db.command, input, access.team._id);
    const result = await db.collection(COLLECTIONS.PRODUCTS)
      .where(where)
      .orderBy('updatedAt', 'desc')
      .orderBy('_id', 'desc')
      .limit(input.pageSize + 1)
      .field({
        _id: true,
        name: true,
        productCode: true,
        category: true,
        unit: true,
        brand: true,
        specification: true,
        coverType: true,
        coverText: true,
        coverEmoji: true,
        coverAssetKey: true,
        coverFileId: true,
        coverBackground: true,
        status: true,
        version: true,
        activeWarehouseCount: true,
        deletionReason: true,
        deletedAt: true,
        updatedAt: true
      })
      .get();
    const documents = result.data || [];
    const hasMore = documents.length > input.pageSize;
    const page = documents.slice(0, input.pageSize);
    const imageAccess = await resolveImageAccess(db, options, access.team._id, page);
    return {
      items: page.map((product) => presentDeletedCatalogProduct(
        product,
        access.membership.role,
        getImageAccess(imageAccess, product._id)
      )),
      nextCursor: hasMore && page.length ? encodeProductCursor(page[page.length - 1]) : null,
      hasMore,
      pageSize: input.pageSize
    };
  } catch (error) {
    if (isApiError(error)) throw error;
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '共享目录回收站读取失败，请稍后重试。');
  }
}

async function restoreCatalogProduct(db, user, rawInput, options) {
  const input = sanitizeCatalogRestoreInput(rawInput);
  const access = await requireCatalogAccess(db, user);
  const requestHash = createMutationRequestHash(PRODUCT_CATALOG_RESTORE_ACTION, {
    teamId: access.team._id,
    productId: input.productId
  }, input);
  let idempotent = false;

  try {
    const preflightProduct = assertCatalogProductScope(
      await getDocument(db, COLLECTIONS.PRODUCTS, input.productId),
      access.team._id
    );
    assertCatalogWarehouseCount(preflightProduct);
    await db.runTransaction(async (transaction) => {
      const locked = await requireCatalogAccessInTransaction(transaction, user, access);
      const product = assertCatalogProductScope(
        await getDocument(transaction, COLLECTIONS.PRODUCTS, input.productId),
        locked.team._id
      );
      if (product.catalogRestoreRequestKey === input.requestKey &&
          product.catalogRestoreRequestHash !== requestHash) {
        throw new ApiError(ERROR_CODES.REQUEST_KEY_CONFLICT, '请求标识已用于其他目录恢复参数。');
      }
      if (product.status === 'active') {
        if (product.catalogRestoreRequestKey === input.requestKey &&
            product.catalogRestoreRequestHash === requestHash) {
          idempotent = true;
          return;
        }
        throw new ApiError(ERROR_CODES.PRODUCT_ALREADY_ACTIVE, '该共享产品目录已经恢复。');
      }
      if (product.catalogRestoreRequestKey === input.requestKey) {
        throw new ApiError(ERROR_CODES.DUPLICATE_REQUEST, '该目录恢复请求已完成且产品状态已变化。');
      }
      if (product.status !== 'deleted') {
        throw new ApiError(ERROR_CODES.PRODUCT_NOT_ACTIVE, '产品当前不可恢复。');
      }
      if (!Number.isSafeInteger(product.version) || product.version !== input.expectedVersion) {
        throw new ApiError(ERROR_CODES.PRODUCT_VERSION_CONFLICT, '产品状态已被其他成员修改，请刷新后重试。');
      }

      assertCatalogWarehouseCount(product);
      const activeProductCount = assertStrictCount(
        locked.team.activeProductCount,
        ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT,
        '团队产品计数异常，请稍后重试。'
      );
      assertProductCountWithinLimit(activeProductCount);

      const now = db.serverDate();
      const nextVersion = product.version + 1;
      await transaction.collection(COLLECTIONS.PRODUCTS).doc(product._id).update({
        data: {
          status: 'active',
          version: nextVersion,
          activeWarehouseCount: 0,
          deletedAt: null,
          deletedBy: null,
          deletionReason: '',
          restoredAt: now,
          restoredBy: locked.user._id,
          updatedAt: now,
          updatedBy: locked.user._id,
          catalogRestoreRequestKey: input.requestKey,
          catalogRestoreRequestHash: requestHash,
          catalogRestoreResultVersion: nextVersion,
          lastMutationAction: PRODUCT_CATALOG_RESTORE_ACTION,
          lastMutationRequestKey: input.requestKey,
          lastMutationInputHash: requestHash
        }
      });
      await transaction.collection(COLLECTIONS.TEAMS).doc(locked.team._id).update({
        data: { activeProductCount: activeProductCount + 1, updatedAt: now }
      });
      idempotent = false;
    }, 5);

    const product = await getDocument(db, COLLECTIONS.PRODUCTS, input.productId);
    if (!product || product.teamId !== access.team._id || product.status !== 'active') {
      throw new ApiError(ERROR_CODES.DATABASE_ERROR, '共享目录恢复结果读取失败，请稍后重试。');
    }
    const imageAccess = await resolveImageAccess(db, options, access.team._id, [product]);
    return {
      product: presentProduct(product, getImageAccess(imageAccess, product._id)),
      idempotent
    };
  } catch (error) {
    if (isApiError(error)) throw error;
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '共享目录恢复失败，请稍后使用原请求标识重试。');
  }
}

function assertWarehouseProductAccess(warehouseProduct, access, requestedProductId) {
  if (!warehouseProduct || warehouseProduct.teamId !== access.team._id ||
      warehouseProduct.warehouseId !== access.warehouse._id) {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE, '当前仓库没有该产品。');
  }
  if (warehouseProduct.status !== 'active') {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE, '产品已从当前仓库移除。');
  }
  if (requestedProductId && warehouseProduct.productId !== requestedProductId) {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE, '当前仓库没有该产品。');
  }
  return warehouseProduct;
}

function assertProductAccess(product, teamId) {
  if (!product || product.teamId !== teamId) {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_FOUND, '产品不存在。');
  }
  if (product.status !== 'active') {
    throw new ApiError(ERROR_CODES.PRODUCT_NOT_ACTIVE, '产品已从共享目录删除。');
  }
  return product;
}

async function listProducts(db, user, rawInput, options) {
  const input = validateProductListInput(rawInput);
  try {
    const access = await requireProductAccess(db, user);
    const where = buildProductListWhere(db.command, input, access);
    const result = await db.collection(COLLECTIONS.WAREHOUSE_PRODUCTS)
      .where(where)
      .orderBy('updatedAt', 'desc')
      .orderBy('_id', 'desc')
      .limit(input.pageSize + 1)
      .field({
        _id: true,
        productId: true,
        productNameSnapshot: true,
        productCodeSnapshot: true,
        categorySnapshot: true,
        unitSnapshot: true,
        brandSnapshot: true,
        specificationSnapshot: true,
        coverSummarySnapshot: true,
        stock: true,
        minStock: true,
        stockStatus: true,
        productVersion: true,
        stockVersion: true,
        updatedAt: true
      })
      .get();
    const documents = result.data || [];
    const hasMore = documents.length > input.pageSize;
    const page = documents.slice(0, input.pageSize);
    const productsById = await loadProductCoverSources(db, access.team._id, page);
    const coverSources = page.map((warehouseProduct) => {
      return productsById.get(warehouseProduct.productId) || warehouseProduct;
    });
    const imageAccess = await resolveImageAccess(db, options, access.team._id, coverSources);
    return {
      items: page.map((warehouseProduct) => {
        const product = productsById.get(warehouseProduct.productId);
        return presentWarehouseProduct(
          warehouseProduct,
          getImageAccess(imageAccess, warehouseProduct.productId),
          product
        );
      }),
      nextCursor: hasMore && page.length
        ? encodeProductCursor(page[page.length - 1], input.queryHash)
        : null,
      hasMore,
      pageSize: input.pageSize
    };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '产品列表读取失败，请稍后重试。');
  }
}

function arraysEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function buildSearchMetadata(product) {
  return {
    normalizedName: normalizeProductName(product.name),
    normalizedCode: normalizeProductCode(product.productCode),
    searchKeywords: buildSearchKeywords(product)
  };
}

function buildSearchSnapshot(product, metadata) {
  return {
    productNameSnapshot: product.name || '',
    normalizedNameSnapshot: metadata.normalizedName,
    productCodeSnapshot: product.productCode || '',
    normalizedCodeSnapshot: metadata.normalizedCode,
    categorySnapshot: product.category || '',
    unitSnapshot: product.unit || '',
    brandSnapshot: product.brand || '',
    specificationSnapshot: product.specification || '',
    searchKeywordsSnapshot: metadata.searchKeywords,
    productVersion: product.version
  };
}

function hasSearchMetadataChanges(product, metadata) {
  return product.normalizedName !== metadata.normalizedName ||
    product.normalizedCode !== metadata.normalizedCode ||
    !arraysEqual(product.searchKeywords, metadata.searchKeywords);
}

function hasSearchSnapshotChanges(warehouseProduct, snapshot) {
  return Object.keys(snapshot).some((field) => {
    if (field === 'searchKeywordsSnapshot') {
      return !arraysEqual(warehouseProduct[field], snapshot[field]);
    }
    return warehouseProduct[field] !== snapshot[field];
  });
}

async function rebuildProductSearch(db, user, rawInput) {
  const input = validateSearchRebuildInput(rawInput);
  try {
    const access = await requireProductAccess(db, user, 'admin');
    const where = buildProductListWhere(db.command, {
      keyword: '',
      searchToken: '',
      category: '',
      stockStatus: '',
      cursor: input.cursor
    }, access);
    const result = await db.collection(COLLECTIONS.WAREHOUSE_PRODUCTS)
      .where(where)
      .orderBy('updatedAt', 'desc')
      .orderBy('_id', 'desc')
      .limit(input.pageSize + 1)
      .field({
        _id: true,
        productId: true,
        teamId: true,
        warehouseId: true,
        status: true,
        productNameSnapshot: true,
        normalizedNameSnapshot: true,
        productCodeSnapshot: true,
        normalizedCodeSnapshot: true,
        categorySnapshot: true,
        unitSnapshot: true,
        brandSnapshot: true,
        specificationSnapshot: true,
        searchKeywordsSnapshot: true,
        productVersion: true,
        updatedAt: true
      })
      .get();
    const documents = result.data || [];
    const hasMore = documents.length > input.pageSize;
    const page = documents.slice(0, input.pageSize);
    const productsById = await loadProductSearchSources(db, access.team._id, page);
    let updatedProducts = 0;
    let updatedWarehouseProducts = 0;
    let skipped = 0;

    for (const warehouseProduct of page) {
      const product = productsById.get(warehouseProduct.productId);
      if (!product) {
        skipped += 1;
        continue;
      }
      const metadata = buildSearchMetadata(product);
      const snapshot = buildSearchSnapshot(product, metadata);
      const updates = [];
      if (hasSearchMetadataChanges(product, metadata)) {
        updates.push(db.collection(COLLECTIONS.PRODUCTS).doc(product._id).update({
          data: metadata
        }).then(() => {
          updatedProducts += 1;
        }));
      }
      if (hasSearchSnapshotChanges(warehouseProduct, snapshot)) {
        updates.push(db.collection(COLLECTIONS.WAREHOUSE_PRODUCTS).doc(warehouseProduct._id).update({
          data: snapshot
        }).then(() => {
          updatedWarehouseProducts += 1;
        }));
      }
      await Promise.all(updates);
    }

    return {
      scanned: page.length,
      updatedProducts,
      updatedWarehouseProducts,
      skipped,
      nextCursor: hasMore && page.length ? encodeProductCursor(page[page.length - 1]) : null,
      hasMore,
      pageSize: input.pageSize
    };
  } catch (error) {
    if (isApiError(error)) throw error;
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '搜索字段重建失败，请稍后重试。');
  }
}

async function getProductDetail(db, user, rawInput, options) {
  const input = validateProductDetailInput(rawInput);
  try {
    const access = await requireProductAccess(db, user);
    const warehouseProductId = input.warehouseProductId || createWarehouseProductId(
      access.team._id,
      access.warehouse._id,
      input.productId
    );
    const warehouseProduct = await getDocument(
      db,
      COLLECTIONS.WAREHOUSE_PRODUCTS,
      warehouseProductId
    );
    assertWarehouseProductAccess(warehouseProduct, access, input.productId);
    const product = await getDocument(db, COLLECTIONS.PRODUCTS, warehouseProduct.productId);
    assertProductAccess(product, access.team._id);
    const imageAccess = await resolveImageAccess(db, options, access.team._id, [product]);
    return {
      product: presentProduct(product, getImageAccess(imageAccess, product._id)),
      warehouseProduct: presentWarehouseProduct(
        warehouseProduct,
        getImageAccess(imageAccess, product._id),
        product
      ),
      permissions: getProductPermissionFlags(access.membership.role)
    };
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '产品详情读取失败，请稍后重试。');
  }
}

module.exports = {
  PRODUCT_CREATE_ACTION,
  PRODUCT_UPDATE_ACTION,
  PRODUCT_REMOVE_ACTION,
  PRODUCT_RESTORE_ACTION,
  PRODUCT_CATALOG_DELETE_ACTION,
  PRODUCT_CATALOG_RESTORE_ACTION,
  requireProductAccess,
  requireProductAccessInTransaction,
  requireCatalogAccess,
  requireCatalogAccessInTransaction,
  buildProductDocument,
  buildWarehouseProductDocument,
  buildInitialRecordDocument,
  assertExistingCreate,
  buildProductListWhere,
  loadProductCoverSources,
  loadProductSearchSources,
  buildDeletedCatalogListWhere,
  buildProductMainUpdate,
  buildProductSnapshotUpdate,
  assertWarehouseProductScope,
  assertWarehouseProductAccess,
  assertProductAccess,
  createProduct,
  updateProduct,
  removeProductFromWarehouse,
  listRemovedProducts,
  restoreProductToWarehouse,
  assertCatalogWarehouseCount,
  deleteCatalogProduct,
  listDeletedCatalogProducts,
  restoreCatalogProduct,
  listProducts,
  buildSearchMetadata,
  buildSearchSnapshot,
  rebuildProductSearch,
  getProductDetail
};
