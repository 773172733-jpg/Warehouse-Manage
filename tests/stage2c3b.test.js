const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ERROR_CODES } = require('../cloudfunctions/warehouse-api/common/errors.js');
const { createMembershipId } = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const {
  sanitizeCatalogDeleteInput,
  sanitizeCatalogRestoreInput,
  validateDeletedCatalogListInput
} = require('../cloudfunctions/warehouse-api/common/product-utils.js');
const {
  deleteCatalogProduct,
  listDeletedCatalogProducts,
  restoreCatalogProduct,
  removeProductFromWarehouse,
  restoreProductToWarehouse
} = require('../cloudfunctions/warehouse-api/modules/product/product-service.js');
const clientService = require('../miniprogram/services/product-service.js');
const profileUtils = require('../miniprogram/pages/profile/profile-utils.js');

const TEAM_ID = 'team_stage2c3b_12345678';
const USER_ID = 'user_stage2c3b_12345678';
const WAREHOUSE_ID = 'warehouse_stage2c3b_12345678';
const PRODUCT_ID = 'product_stage2c3b_12345678';
const WAREHOUSE_PRODUCT_ID = 'warehouse_product_stage2c3b_12345678';

function expectCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

async function expectAsyncCode(callback, code) {
  await assert.rejects(callback, (error) => error && error.code === code);
}

function compare(left, right) {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function matchesOperation(value, operation) {
  if (operation.__operation === 'lt') return compare(value, operation.value) < 0;
  if (operation.__operation === 'gt') return compare(value, operation.value) > 0;
  if (operation.__operation === 'gte') return compare(value, operation.value) >= 0;
  if (operation.__operation === 'eq') return compare(value, operation.value) === 0;
  if (operation.__operation === 'neq') return compare(value, operation.value) !== 0;
  if (operation.__operation === 'and') {
    return operation.items.every((item) => matchesOperation(value, item));
  }
  return false;
}

function matchesValue(value, expected) {
  if (expected && expected.__operation) return matchesOperation(value, expected);
  if (Array.isArray(value)) return value.includes(expected);
  return value === expected;
}

function matchesWhere(document, where) {
  if (where && where.__operation === 'or') {
    return where.branches.some((branch) => matchesWhere(document, branch));
  }
  return Object.keys(where || {}).every((field) => matchesValue(document[field], where[field]));
}

function createFixture(role = 'owner') {
  const membershipId = createMembershipId(TEAM_ID, USER_ID);
  const now = new Date(Date.UTC(2026, 6, 16, 8, 0, 0));
  const documents = {
    users: new Map([[USER_ID, {
      _id: USER_ID,
      status: 'active',
      displayName: '测试用户',
      currentTeamId: TEAM_ID,
      currentWarehouseId: WAREHOUSE_ID
    }]]),
    teams: new Map([[TEAM_ID, {
      _id: TEAM_ID,
      status: 'active',
      defaultWarehouseId: WAREHOUSE_ID,
      activeProductCount: 1
    }]]),
    team_members: new Map([[membershipId, {
      _id: membershipId,
      teamId: TEAM_ID,
      userId: USER_ID,
      role,
      status: 'active'
    }]]),
    warehouses: new Map([[WAREHOUSE_ID, {
      _id: WAREHOUSE_ID,
      teamId: TEAM_ID,
      status: 'active'
    }]]),
    products: new Map([[PRODUCT_ID, {
      _id: PRODUCT_ID,
      teamId: TEAM_ID,
      name: '工业扳手',
      normalizedName: '工业扳手',
      productCode: 'TOOL-01',
      normalizedCode: 'tool-01',
      category: '工具',
      unit: '把',
      brand: '轻仓',
      specification: '12寸',
      description: '',
      searchKeywords: ['工业扳手', 'tool-01', '工具'],
      coverType: 'text',
      coverText: '扳',
      coverEmoji: '',
      coverAssetKey: '',
      coverFileId: '',
      coverBackground: '#EAF6EF',
      status: 'active',
      version: 2,
      activeWarehouseCount: 0,
      updatedAt: now
    }]]),
    warehouse_products: new Map([[WAREHOUSE_PRODUCT_ID, {
      _id: WAREHOUSE_PRODUCT_ID,
      teamId: TEAM_ID,
      warehouseId: WAREHOUSE_ID,
      productId: PRODUCT_ID,
      status: 'removed',
      stock: 0,
      minStock: 2,
      stockStatus: 'out',
      stockVersion: 1,
      productVersion: 2,
      productNameSnapshot: '工业扳手',
      productCodeSnapshot: 'TOOL-01',
      categorySnapshot: '工具',
      unitSnapshot: '把',
      coverSummarySnapshot: { type: 'text', text: '扳', background: '#EAF6EF' },
      removedAt: now,
      removalReason: '暂不使用',
      updatedAt: now
    }]]),
    stock_records: new Map([['record_stage2c3b_12345678', {
      _id: 'record_stage2c3b_12345678',
      teamId: TEAM_ID,
      warehouseId: WAREHOUSE_ID,
      productId: PRODUCT_ID,
      warehouseProductId: WAREHOUSE_PRODUCT_ID,
      type: 'initial',
      changeQuantity: 1
    }]])
  };
  const queryCalls = [];

  function operation(type, value) {
    return {
      __operation: type,
      value,
      and(other) { return { __operation: 'and', items: [this, other] }; }
    };
  }

  const command = {
    lt: (value) => operation('lt', value),
    gt: (value) => operation('gt', value),
    gte: (value) => operation('gte', value),
    eq: (value) => operation('eq', value),
    neq: (value) => operation('neq', value),
    or: (branches) => ({ __operation: 'or', branches })
  };

  function source(allowQuery) {
    return {
      collection(name) {
        const collection = documents[name];
        assert.ok(collection, `unknown collection ${name}`);
        const query = { where: {}, orders: [], limit: Infinity };
        const api = {
          doc(id) {
            return {
              async get() { return { data: collection.get(id) || null }; },
              async set({ data }) { collection.set(id, Object.assign({ _id: id }, data)); },
              async update({ data }) {
                const current = collection.get(id);
                assert.ok(current, `missing ${name}/${id}`);
                collection.set(id, Object.assign({}, current, data));
              }
            };
          },
          where(where) {
            if (!allowQuery) throw new Error('transaction where queries are not supported');
            query.where = where;
            return api;
          },
          orderBy(field, direction) { query.orders.push({ field, direction }); return api; },
          limit(value) { query.limit = value; return api; },
          field() { return api; },
          async get() {
            queryCalls.push({ collection: name, where: query.where, orders: query.orders.slice() });
            let result = Array.from(collection.values()).filter((item) => matchesWhere(item, query.where));
            result.sort((left, right) => {
              for (const order of query.orders) {
                const value = compare(left[order.field], right[order.field]);
                if (value) return order.direction === 'desc' ? -value : value;
              }
              return 0;
            });
            return { data: result.slice(0, query.limit) };
          }
        };
        return api;
      }
    };
  }

  const db = source(true);
  db.command = command;
  let tick = 0;
  db.serverDate = () => new Date(Date.UTC(2026, 6, 16, 9, 0, tick++));
  db.runTransaction = async (callback) => callback(source(false));
  return {
    db,
    documents,
    queryCalls,
    user: documents.users.get(USER_ID),
    membership: documents.team_members.get(membershipId)
  };
}

function deleteInput(overrides = {}) {
  return Object.assign({
    productId: PRODUCT_ID,
    expectedVersion: 2,
    reason: '目录停用',
    requestKey: 'catalog_delete_12345678'
  }, overrides);
}

function restoreInput(overrides = {}) {
  return Object.assign({
    productId: PRODUCT_ID,
    expectedVersion: 3,
    requestKey: 'catalog_restore_12345678'
  }, overrides);
}

function testValidatorsAndClientWhitelists() {
  assert.deepStrictEqual(sanitizeCatalogDeleteInput(deleteInput()), deleteInput());
  assert.deepStrictEqual(sanitizeCatalogRestoreInput(restoreInput()), restoreInput());
  assert.strictEqual(validateDeletedCatalogListInput({}).pageSize, 20);
  ['teamId', 'warehouseId', 'userId', 'openId', 'role', 'status', 'activeWarehouseCount',
    'activeProductCount', 'deletedBy', 'deletedAt', 'stock', 'warehouseProductIds', 'requestHash']
    .forEach((field) => {
      expectCode(() => sanitizeCatalogDeleteInput(Object.assign({}, deleteInput(), {
        [field]: 'forged'
      })), ERROR_CODES.FORBIDDEN);
    });
  expectCode(() => sanitizeCatalogDeleteInput(deleteInput({ expectedVersion: 0 })),
    ERROR_CODES.INVALID_PRODUCT_VERSION);
  expectCode(() => sanitizeCatalogDeleteInput(deleteInput({ reason: '长'.repeat(101) })),
    ERROR_CODES.INVALID_DELETE_REASON);
  expectCode(() => validateDeletedCatalogListInput({ role: 'owner' }), ERROR_CODES.FORBIDDEN);

  const forged = Object.assign({}, deleteInput(), {
    teamId: 'forged', warehouseId: 'forged', openId: 'forged', requestHash: 'forged'
  });
  assert.deepStrictEqual(clientService.buildDeleteCatalogProductPayload(forged), deleteInput());
  assert.deepStrictEqual(clientService.buildRestoreCatalogProductPayload(Object.assign({}, forged, {
    expectedVersion: 3,
    requestKey: 'catalog_restore_12345678'
  })), restoreInput());
  assert.deepStrictEqual(clientService.buildDeletedCatalogProductsPayload({
    keyword: '工具', category: '工具', cursor: 'cursor', pageSize: 10, role: 'owner'
  }), { keyword: '工具', category: '工具', cursor: 'cursor', pageSize: 10 });
}

async function testDeleteRestoreTransactionsAndIdempotency() {
  const fixture = createFixture();
  const warehouseBefore = JSON.stringify(fixture.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID));
  const recordsBefore = JSON.stringify(Array.from(fixture.documents.stock_records.entries()));
  const deleted = await deleteCatalogProduct(fixture.db, fixture.user, deleteInput());
  assert.strictEqual(deleted.idempotent, false);
  assert.strictEqual(deleted.item.productId, PRODUCT_ID);
  assert.strictEqual(deleted.item.version, 3);
  assert.strictEqual(deleted.item.activeWarehouseCount, 0);
  assert.strictEqual(fixture.documents.products.get(PRODUCT_ID).status, 'deleted');
  assert.strictEqual(fixture.documents.teams.get(TEAM_ID).activeProductCount, 0);
  assert.strictEqual(JSON.stringify(fixture.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID)), warehouseBefore);
  assert.strictEqual(JSON.stringify(Array.from(fixture.documents.stock_records.entries())), recordsBefore);
  assert.strictEqual(fixture.queryCalls.some((item) => item.collection === 'warehouse_products'), false);

  const deleteRetry = await deleteCatalogProduct(fixture.db, fixture.user, deleteInput());
  assert.strictEqual(deleteRetry.idempotent, true);
  assert.strictEqual(fixture.documents.products.get(PRODUCT_ID).version, 3);
  assert.strictEqual(fixture.documents.teams.get(TEAM_ID).activeProductCount, 0);
  await expectAsyncCode(() => deleteCatalogProduct(fixture.db, fixture.user, deleteInput({
    reason: '异参'
  })), ERROR_CODES.REQUEST_KEY_CONFLICT);
  await expectAsyncCode(() => deleteCatalogProduct(fixture.db, fixture.user, deleteInput({
    requestKey: 'catalog_delete_other_123', expectedVersion: 3
  })), ERROR_CODES.PRODUCT_ALREADY_DELETED);

  const restored = await restoreCatalogProduct(fixture.db, fixture.user, restoreInput());
  assert.strictEqual(restored.idempotent, false);
  assert.strictEqual(restored.product.id, PRODUCT_ID);
  assert.strictEqual(restored.product.version, 4);
  assert.strictEqual(fixture.documents.products.get(PRODUCT_ID).activeWarehouseCount, 0);
  assert.strictEqual(fixture.documents.teams.get(TEAM_ID).activeProductCount, 1);
  assert.strictEqual(fixture.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).status, 'removed');
  assert.strictEqual(JSON.stringify(Array.from(fixture.documents.stock_records.entries())), recordsBefore);
  assert.strictEqual(fixture.queryCalls.some((item) => item.collection === 'warehouse_products'), false);

  const restoreRetry = await restoreCatalogProduct(fixture.db, fixture.user, restoreInput());
  assert.strictEqual(restoreRetry.idempotent, true);
  assert.strictEqual(fixture.documents.products.get(PRODUCT_ID).version, 4);
  assert.strictEqual(fixture.documents.teams.get(TEAM_ID).activeProductCount, 1);
  await expectAsyncCode(() => restoreCatalogProduct(fixture.db, fixture.user, restoreInput({
    expectedVersion: 4
  })), ERROR_CODES.REQUEST_KEY_CONFLICT);
  await expectAsyncCode(() => restoreCatalogProduct(fixture.db, fixture.user, restoreInput({
    requestKey: 'catalog_restore_other_123', expectedVersion: 4
  })), ERROR_CODES.PRODUCT_ALREADY_ACTIVE);
}

async function testPermissionsVersionsAndWarehouseGuards() {
  for (const role of ['admin', 'viewer']) {
    const fixture = createFixture(role);
    await expectAsyncCode(() => deleteCatalogProduct(fixture.db, fixture.user, deleteInput()),
      ERROR_CODES.FORBIDDEN);
    await expectAsyncCode(() => listDeletedCatalogProducts(fixture.db, fixture.user, {}),
      ERROR_CODES.FORBIDDEN);
    fixture.documents.products.get(PRODUCT_ID).status = 'deleted';
    await expectAsyncCode(() => restoreCatalogProduct(fixture.db, fixture.user, restoreInput({
      expectedVersion: 2
    })), ERROR_CODES.FORBIDDEN);
  }

  const countFixture = createFixture();
  countFixture.documents.products.get(PRODUCT_ID).activeWarehouseCount = 1;
  await expectAsyncCode(() => deleteCatalogProduct(countFixture.db, countFixture.user, deleteInput()),
    ERROR_CODES.PRODUCT_STILL_IN_WAREHOUSE);

  const invalidCountFixture = createFixture();
  invalidCountFixture.documents.products.get(PRODUCT_ID).activeWarehouseCount = -1;
  await expectAsyncCode(() => deleteCatalogProduct(
    invalidCountFixture.db,
    invalidCountFixture.user,
    deleteInput()
  ), ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT);

  const activeCountConflict = createFixture();
  activeCountConflict.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).status = 'active';
  await expectAsyncCode(() => removeProductFromWarehouse(activeCountConflict.db, activeCountConflict.user, {
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    reason: '计数异常',
    requestKey: 'remove_count_conflict_123'
  }), ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT);

  const missingCountFixture = createFixture();
  delete missingCountFixture.documents.products.get(PRODUCT_ID).activeWarehouseCount;
  await expectAsyncCode(() => restoreProductToWarehouse(missingCountFixture.db, missingCountFixture.user, {
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    requestKey: 'restore_count_conflict_123'
  }), ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT);

  const nonIntegerCountFixture = createFixture();
  nonIntegerCountFixture.documents.products.get(PRODUCT_ID).activeWarehouseCount = 0.5;
  await expectAsyncCode(() => deleteCatalogProduct(
    nonIntegerCountFixture.db,
    nonIntegerCountFixture.user,
    deleteInput()
  ), ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT);

  const missingCatalogCountFixture = createFixture();
  delete missingCatalogCountFixture.documents.products.get(PRODUCT_ID).activeWarehouseCount;
  await expectAsyncCode(() => deleteCatalogProduct(
    missingCatalogCountFixture.db,
    missingCatalogCountFixture.user,
    deleteInput()
  ), ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT);

  const negativeTeamCountFixture = createFixture();
  negativeTeamCountFixture.documents.teams.get(TEAM_ID).activeProductCount = -1;
  await expectAsyncCode(() => deleteCatalogProduct(
    negativeTeamCountFixture.db,
    negativeTeamCountFixture.user,
    deleteInput()
  ),
    ERROR_CODES.PRODUCT_WAREHOUSE_STATE_CONFLICT);

  const versionFixture = createFixture();
  await expectAsyncCode(() => deleteCatalogProduct(versionFixture.db, versionFixture.user, deleteInput({
    expectedVersion: 1
  })), ERROR_CODES.PRODUCT_VERSION_CONFLICT);

  const limitFixture = createFixture();
  await deleteCatalogProduct(limitFixture.db, limitFixture.user, deleteInput());
  limitFixture.documents.teams.get(TEAM_ID).activeProductCount = 99999;
  await expectAsyncCode(() => restoreCatalogProduct(limitFixture.db, limitFixture.user, restoreInput()),
    ERROR_CODES.PRODUCT_LIMIT_REACHED);
}

async function testDeletedListPaginationAndRedaction() {
  const fixture = createFixture();
  await deleteCatalogProduct(fixture.db, fixture.user, deleteInput());
  const firstProduct = fixture.documents.products.get(PRODUCT_ID);
  fixture.documents.products.set('product_stage2c3b_second_123', Object.assign({}, firstProduct, {
    _id: 'product_stage2c3b_second_123',
    name: '工具箱',
    normalizedName: '工具箱',
    productCode: 'BOX-01',
    normalizedCode: 'box-01',
    updatedAt: new Date(Date.UTC(2026, 6, 16, 8, 30, 0))
  }));
  const firstPage = await listDeletedCatalogProducts(fixture.db, fixture.user, {
    keyword: '工具', pageSize: 1
  });
  assert.strictEqual(firstPage.items.length, 1);
  assert.strictEqual(firstPage.hasMore, true);
  assert.ok(firstPage.nextCursor);
  const secondPage = await listDeletedCatalogProducts(fixture.db, fixture.user, {
    keyword: '工具', pageSize: 1, cursor: firstPage.nextCursor
  });
  assert.strictEqual(secondPage.items.length, 1);
  assert.notStrictEqual(secondPage.items[0].productId, firstPage.items[0].productId);
  const text = JSON.stringify(firstPage) + JSON.stringify(secondPage);
  ['openId', 'teamId', 'requestKey', 'requestHash', 'deletedBy', 'updatedBy', 'catalogDelete']
    .forEach((field) => assert.strictEqual(text.includes(field), false));
}

async function testSerializedRaceOutcomes() {
  const deleteFirst = createFixture();
  await deleteCatalogProduct(deleteFirst.db, deleteFirst.user, deleteInput());
  await expectAsyncCode(() => restoreProductToWarehouse(deleteFirst.db, deleteFirst.user, {
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    requestKey: 'warehouse_restore_after_delete_123'
  }), ERROR_CODES.PRODUCT_CATALOG_DELETED);

  const warehouseFirst = createFixture();
  await restoreProductToWarehouse(warehouseFirst.db, warehouseFirst.user, {
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    requestKey: 'warehouse_restore_before_delete_123'
  });
  assert.strictEqual(warehouseFirst.documents.products.get(PRODUCT_ID).activeWarehouseCount, 1);
  await expectAsyncCode(() => deleteCatalogProduct(warehouseFirst.db, warehouseFirst.user,
    deleteInput()), ERROR_CODES.PRODUCT_STILL_IN_WAREHOUSE);
}

function testFrontendAndRoutingBoundaries() {
  const ownerEntries = profileUtils.buildQuickEntries(
    profileUtils.getPermissionFlags('owner', true), true
  );
  const adminEntries = profileUtils.buildQuickEntries(
    profileUtils.getPermissionFlags('admin', true), true
  );
  const viewerEntries = profileUtils.buildQuickEntries(
    profileUtils.getPermissionFlags('viewer', true), true
  );
  assert.ok(ownerEntries.some((item) => item.action === 'catalogRecycle'));
  assert.strictEqual(adminEntries.some((item) => item.action === 'catalogRecycle'), false);
  assert.strictEqual(viewerEntries.some((item) => item.action === 'catalogRecycle'), false);
  assert.ok(adminEntries.some((item) => item.action === 'recycle'));

  const root = path.resolve(__dirname, '..');
  const frontendFiles = [
    'miniprogram/pages/product-recycle-bin/product-recycle-bin.js',
    'miniprogram/pages/catalog-recycle-bin/catalog-recycle-bin.js',
    'miniprogram/pages/profile/profile.js'
  ];
  const frontend = frontendFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  ['wx.cloud', '.database(', 'setStorage', 'setStorageSync'].forEach((value) => {
    assert.strictEqual(frontend.includes(value), false);
  });
  assert.ok(frontend.includes('productService.deleteCatalogProduct'));
  assert.ok(frontend.includes('productService.listDeletedCatalogProducts'));
  assert.ok(frontend.includes('productService.restoreCatalogProduct'));

  const router = fs.readFileSync(path.join(root, 'cloudfunctions/warehouse-api/router.js'), 'utf8');
  ['product.catalog.delete', 'product.catalog.deleted.list', 'product.catalog.restore']
    .forEach((action) => assert.ok(router.includes(`'${action}'`)));
  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
  assert.ok(appConfig.pages.includes('pages/catalog-recycle-bin/catalog-recycle-bin'));
  const warehouseRecycle = fs.readFileSync(
    path.join(root, 'miniprogram/pages/product-recycle-bin/product-recycle-bin.wxml'), 'utf8'
  );
  assert.ok(warehouseRecycle.includes('item.canDeleteCatalog'));
}

function testNoNewWarehouseProductIndexDependency() {
  const root = path.resolve(__dirname, '..');
  const service = fs.readFileSync(
    path.join(root, 'cloudfunctions/warehouse-api/modules/product/product-service.js'),
    'utf8'
  );
  const indexes = fs.readFileSync(path.join(root, 'database/indexes.md'), 'utf8');
  const deployment = fs.readFileSync(path.join(root, 'docs/阶段2C3B部署与验收.md'), 'utf8');
  assert.strictEqual(service.includes('assertCatalogWarehouseInstances'), false);
  assert.strictEqual(service.includes('CATALOG_WAREHOUSE_CHECK_PAGE_SIZE'), false);
  const expectedIndexes = [
    'uidx_wh_products_relation',
    'uidx_wh_products_request',
    'idx_wh_products_status_updated',
    'idx_wh_products_stock_status',
    'idx_wh_products_category',
    'idx_wh_products_category_stock',
    'idx_wh_products_name',
    'idx_wh_products_code',
    'idx_wh_products_keyword',
    'idx_wh_products_category_name',
    'idx_wh_products_category_code',
    'idx_wh_products_category_keyword',
    'idx_wh_products_stock_name',
    'idx_wh_products_stock_code',
    'idx_wh_products_stock_keyword',
    'idx_wh_products_category_stock_name',
    'idx_wh_products_category_stock_code',
    'idx_wh_products_category_stock_keyword'
  ];
  expectedIndexes.forEach((name) => assert.ok(indexes.includes(`| \`${name}\``)));
  assert.strictEqual(new Set(expectedIndexes).size, 18);
  assert.ok(indexes.includes('idx_wh_products_team_product'));
  assert.ok(indexes.includes('取消，不再需要'));
  assert.ok(deployment.includes('无需新增任何 `warehouse_products` 索引'));
  assert.strictEqual(deployment.includes('人工创建以下一个普通索引'), false);
}

async function run() {
  testValidatorsAndClientWhitelists();
  await testDeleteRestoreTransactionsAndIdempotency();
  await testPermissionsVersionsAndWarehouseGuards();
  await testDeletedListPaginationAndRedaction();
  await testSerializedRaceOutcomes();
  testFrontendAndRoutingBoundaries();
  testNoNewWarehouseProductIndexDependency();
  console.log('stage2c3b tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
