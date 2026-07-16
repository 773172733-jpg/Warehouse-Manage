const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ERROR_CODES, ApiError } = require('../cloudfunctions/warehouse-api/common/errors.js');
const { createMembershipId } = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const {
  sanitizeProductUpdateInput,
  sanitizeWarehouseMutationInput,
  validateRemovedProductListInput,
  createMutationRequestHash,
  buildSearchKeywords
} = require('../cloudfunctions/warehouse-api/common/product-utils.js');
const {
  createProduct,
  updateProduct,
  removeProductFromWarehouse,
  listRemovedProducts,
  restoreProductToWarehouse,
  buildProductListWhere
} = require('../cloudfunctions/warehouse-api/modules/product/product-service.js');
const clientService = require('../miniprogram/services/product-service.js');
const editUtils = require('../miniprogram/pages/product-edit/product-create-utils.js');
const profileUtils = require('../miniprogram/pages/profile/profile-utils.js');

const TEAM_ID = 'team_12345678';
const WAREHOUSE_ID = 'warehouse_12345678';
const USER_ID = 'user_12345678';

function createInput(overrides = {}) {
  return Object.assign({
    name: '工业扳手',
    productCode: 'TOOL-001',
    category: '工具',
    unit: '把',
    brand: '轻仓',
    specification: '12 mm',
    description: '常用工具',
    coverType: 'text',
    coverText: '扳手',
    coverBackground: '#EAF6EF',
    minStock: 2,
    initialStock: 2,
    requestKey: 'create_product_123456'
  }, overrides);
}

function updateInput(productId, overrides = {}) {
  return Object.assign({
    productId,
    expectedVersion: 1,
    name: '工业活动扳手',
    productCode: ' TOOL-002 ',
    category: '工具',
    unit: '把',
    brand: '轻仓',
    specification: '14 mm',
    description: '更新后的产品资料',
    coverType: 'emoji',
    coverText: '',
    coverEmoji: '🔧',
    coverBackground: '#E9EDF5',
    requestKey: 'update_product_123456'
  }, overrides);
}

function expectCode(callback, code) {
  assert.throws(callback, (error) => error instanceof ApiError && error.code === code);
}

async function expectAsyncCode(callback, code) {
  await assert.rejects(callback, (error) => error && error.code === code);
}

function compare(value, expected) {
  if (value instanceof Date || expected instanceof Date) {
    return new Date(value).getTime() - new Date(expected).getTime();
  }
  if (value === expected) return 0;
  return value < expected ? -1 : 1;
}

function matchesField(value, condition) {
  if (condition && condition.__operation === 'and') {
    return condition.items.every((item) => matchesField(value, item));
  }
  if (condition && condition.__operation) {
    const result = compare(value, condition.value);
    if (condition.__operation === 'lt') return result < 0;
    if (condition.__operation === 'gte') return result >= 0;
    if (condition.__operation === 'eq') return result === 0;
  }
  if (Array.isArray(value)) return value.includes(condition);
  return compare(value, condition) === 0;
}

function matchesWhere(document, where) {
  if (where && where.__operation === 'or') {
    return where.branches.some((branch) => matchesWhere(document, branch));
  }
  return Object.keys(where || {}).every((key) => matchesField(document[key], where[key]));
}

function createFixture(role = 'owner') {
  const membershipId = createMembershipId(TEAM_ID, USER_ID);
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
      activeProductCount: 0
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
    products: new Map(),
    warehouse_products: new Map(),
    stock_records: new Map()
  };

  function operation(type, value) {
    return {
      __operation: type,
      value,
      and(other) { return { __operation: 'and', items: [this, other] }; }
    };
  }

  const command = {
    lt: (value) => operation('lt', value),
    gte: (value) => operation('gte', value),
    eq: (value) => operation('eq', value),
    or: (branches) => ({ __operation: 'or', branches })
  };

  function source() {
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
          where(where) { query.where = where; return api; },
          orderBy(field, direction) { query.orders.push({ field, direction }); return api; },
          limit(value) { query.limit = value; return api; },
          field() { return api; },
          async get() {
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

  const db = source();
  db.command = command;
  let clock = 0;
  db.serverDate = () => new Date(Date.UTC(2026, 6, 16, 0, 0, clock++));
  db.runTransaction = async (callback) => callback(source());
  return {
    db,
    documents,
    user: documents.users.get(USER_ID),
    membership: documents.team_members.get(membershipId)
  };
}

function testValidatorsAndHashes() {
  const input = sanitizeProductUpdateInput(updateInput('product_12345678', {
    name: '  ＡBC   扳手 ',
    productCode: '  Code  01 '
  }));
  assert.strictEqual(input.normalizedName, 'abc 扳手');
  assert.strictEqual(input.normalizedCode, 'code 01');
  assert.deepStrictEqual(input.searchKeywords, buildSearchKeywords(input));
  ['stock', 'initialStock', 'minStock', 'stockVersion', 'teamId', 'warehouseId', 'role',
    'version', 'searchKeywords', 'normalizedName', 'normalizedCode', 'coverFileId']
    .forEach((field) => {
      expectCode(() => sanitizeProductUpdateInput(Object.assign({}, updateInput('product_12345678'), {
        [field]: field === 'stock' ? 0 : 'forged'
      })), ERROR_CODES.FORBIDDEN);
    });
  expectCode(() => sanitizeProductUpdateInput(updateInput('product_12345678', { expectedVersion: 0 })),
    ERROR_CODES.INVALID_PRODUCT_VERSION);
  expectCode(() => sanitizeWarehouseMutationInput({
    warehouseProductId: 'warehouse_product_12345678',
    requestKey: 'remove_product_123456',
    stock: 0
  }, true), ERROR_CODES.FORBIDDEN);
  assert.strictEqual(validateRemovedProductListInput({}).pageSize, 20);
  expectCode(() => validateRemovedProductListInput({ stockStatus: 'out' }), ERROR_CODES.FORBIDDEN);
  const hash = createMutationRequestHash('product.update', { teamId: TEAM_ID }, input);
  assert.strictEqual(hash.length, 64);
}

function testClientWhitelistsAndEditHelpers() {
  const forged = Object.assign(updateInput('product_12345678'), {
    stock: 9,
    minStock: 3,
    teamId: 'forged',
    warehouseId: 'forged',
    openId: 'forged'
  });
  const payload = clientService.buildUpdateProductPayload(forged);
  ['stock', 'minStock', 'teamId', 'warehouseId', 'openId'].forEach((field) => {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, field), false);
  });
  assert.deepStrictEqual(clientService.buildRemoveProductPayload(Object.assign({}, forged, {
    warehouseProductId: 'warehouse_product_12345678', reason: '停用'
  })), {
    warehouseProductId: 'warehouse_product_12345678',
    reason: '停用',
    requestKey: forged.requestKey
  });
  assert.deepStrictEqual(clientService.buildRestoreProductPayload(Object.assign({}, forged, {
    warehouseProductId: 'warehouse_product_12345678'
  })), {
    warehouseProductId: 'warehouse_product_12345678', requestKey: forged.requestKey
  });

  const form = {
    coverMode: 'text', displayText: '扳手', coverColor: '#EAF6EF',
    name: '扳手', code: 'A-1', category: '工具', unit: '把', customUnit: '',
    brand: '', specification: '', description: '', stock: 88, minStock: 66
  };
  const update = editUtils.buildUpdateProductPayload(form, {
    productId: 'product_12345678', expectedVersion: 2
  });
  assert.strictEqual(update.initialStock, undefined);
  assert.strictEqual(update.minStock, undefined);
  const image = editUtils.buildUpdateProductPayload(Object.assign({}, form, {
    coverMode: 'existing-image', localImagePath: 'cloud://existing'
  }), { productId: 'product_12345678', expectedVersion: 2 });
  assert.strictEqual(image.coverType, undefined);
  assert.strictEqual(JSON.stringify(image).includes('cloud://existing'), false);
  let keyCalls = 0;
  const first = editUtils.resolveUpdateIntent(update, {}, () => `key_${++keyCalls}_12345678`);
  const retry = editUtils.resolveUpdateIntent(update, {
    updateRequestKey: first.requestKey,
    submittedPayloadHash: first.signature
  }, () => `key_${++keyCalls}_12345678`);
  assert.strictEqual(retry.requestKey, first.requestKey);
  const changed = editUtils.resolveUpdateIntent(Object.assign({}, update, { name: '新名称' }), {
    updateRequestKey: first.requestKey,
    submittedPayloadHash: first.signature
  }, () => `key_${++keyCalls}_12345678`);
  assert.notStrictEqual(changed.requestKey, first.requestKey);
  const adminEntries = profileUtils.buildQuickEntries(
    profileUtils.getPermissionFlags('admin', true),
    true
  );
  const viewerEntries = profileUtils.buildQuickEntries(
    profileUtils.getPermissionFlags('viewer', true),
    true
  );
  assert.ok(adminEntries.some((item) => item.action === 'recycle'));
  assert.strictEqual(viewerEntries.some((item) => item.action === 'recycle'), false);
}

async function testCloudTransactionsAndPermissions() {
  const fixture = createFixture('owner');
  const created = await createProduct(fixture.db, fixture.user, createInput());
  const productId = created.product.id;
  const warehouseProductId = created.warehouseProduct.id;
  const originalRecordCount = fixture.documents.stock_records.size;
  const originalTeamCount = fixture.documents.teams.get(TEAM_ID).activeProductCount;
  const beforeWarehouse = fixture.documents.warehouse_products.get(warehouseProductId);
  const originalStockVersion = beforeWarehouse.stockVersion;

  const updated = await updateProduct(fixture.db, fixture.user, updateInput(productId));
  assert.strictEqual(updated.idempotent, false);
  assert.strictEqual(updated.product.version, 2);
  assert.strictEqual(updated.product.name, '工业活动扳手');
  const updatedWarehouse = fixture.documents.warehouse_products.get(warehouseProductId);
  assert.strictEqual(updatedWarehouse.productNameSnapshot, '工业活动扳手');
  assert.strictEqual(updatedWarehouse.normalizedCodeSnapshot, 'tool-002');
  assert.ok(updatedWarehouse.searchKeywordsSnapshot.includes('工业活动扳手'));
  assert.strictEqual(updatedWarehouse.productVersion, 2);
  assert.strictEqual(updatedWarehouse.stock, 2);
  assert.strictEqual(updatedWarehouse.minStock, 2);
  assert.strictEqual(updatedWarehouse.stockVersion, originalStockVersion);
  assert.strictEqual(fixture.documents.stock_records.size, originalRecordCount);

  const retry = await updateProduct(fixture.db, fixture.user, updateInput(productId));
  assert.strictEqual(retry.idempotent, true);
  assert.strictEqual(retry.product.version, 2);
  await expectAsyncCode(
    () => updateProduct(fixture.db, fixture.user, updateInput(productId, { name: '异参' })),
    ERROR_CODES.REQUEST_KEY_CONFLICT
  );
  await expectAsyncCode(
    () => updateProduct(fixture.db, fixture.user, updateInput(productId, {
      requestKey: 'update_product_other_123', expectedVersion: 1
    })),
    ERROR_CODES.PRODUCT_VERSION_CONFLICT
  );

  fixture.membership.role = 'viewer';
  await expectAsyncCode(
    () => updateProduct(fixture.db, fixture.user, updateInput(productId, {
      requestKey: 'viewer_update_12345678', expectedVersion: 2
    })),
    ERROR_CODES.FORBIDDEN
  );
  await expectAsyncCode(() => listRemovedProducts(fixture.db, fixture.user, {}), ERROR_CODES.FORBIDDEN);
  await expectAsyncCode(() => removeProductFromWarehouse(fixture.db, fixture.user, {
    warehouseProductId,
    requestKey: 'viewer_remove_12345678'
  }), ERROR_CODES.FORBIDDEN);
  await expectAsyncCode(() => restoreProductToWarehouse(fixture.db, fixture.user, {
    warehouseProductId,
    requestKey: 'viewer_restore_123456'
  }), ERROR_CODES.FORBIDDEN);
  fixture.membership.role = 'admin';

  await expectAsyncCode(() => removeProductFromWarehouse(fixture.db, fixture.user, {
    warehouseProductId,
    reason: '暂不使用',
    requestKey: 'remove_product_123456'
  }), ERROR_CODES.PRODUCT_HAS_STOCK);
  fixture.documents.warehouse_products.set(warehouseProductId, Object.assign({}, updatedWarehouse, {
    stock: 0,
    stockStatus: 'out'
  }));
  const removed = await removeProductFromWarehouse(fixture.db, fixture.user, {
    warehouseProductId,
    reason: '暂不使用',
    requestKey: 'remove_product_123456'
  });
  assert.strictEqual(removed.idempotent, false);
  assert.strictEqual(fixture.documents.warehouse_products.get(warehouseProductId).status, 'removed');
  assert.strictEqual(fixture.documents.products.get(productId).status, 'active');
  assert.strictEqual(fixture.documents.products.get(productId).activeWarehouseCount, 0);
  assert.strictEqual(fixture.documents.teams.get(TEAM_ID).activeProductCount, originalTeamCount);
  assert.strictEqual(fixture.documents.stock_records.size, originalRecordCount);
  const removeRetry = await removeProductFromWarehouse(fixture.db, fixture.user, {
    warehouseProductId,
    reason: '暂不使用',
    requestKey: 'remove_product_123456'
  });
  assert.strictEqual(removeRetry.idempotent, true);
  assert.strictEqual(fixture.documents.products.get(productId).activeWarehouseCount, 0);
  await expectAsyncCode(() => removeProductFromWarehouse(fixture.db, fixture.user, {
    warehouseProductId,
    reason: '另一个原因',
    requestKey: 'remove_product_123456'
  }), ERROR_CODES.REQUEST_KEY_CONFLICT);

  fixture.documents.warehouse_products.set('warehouse_product_other_12345678', {
    _id: 'warehouse_product_other_12345678',
    teamId: 'team_other_12345678',
    warehouseId: 'warehouse_other_12345678',
    productId,
    status: 'removed',
    stock: 0,
    removedAt: new Date(),
    updatedAt: new Date()
  });

  const recycle = await listRemovedProducts(fixture.db, fixture.user, { keyword: '工业', pageSize: 20 });
  assert.strictEqual(recycle.items.length, 1);
  assert.strictEqual(recycle.items[0].warehouseProductId, warehouseProductId);
  assert.strictEqual(recycle.items[0].canRestore, true);
  const recycleText = JSON.stringify(recycle);
  ['openId', 'requestKey', 'requestHash', 'removedBy', 'teamId', 'warehouseId']
    .forEach((field) => assert.strictEqual(recycleText.includes(field), false));

  const authoritative = fixture.documents.products.get(productId);
  fixture.documents.products.set(productId, Object.assign({}, authoritative, {
    name: '目录最新名称',
    normalizedName: '目录最新名称',
    productCode: 'LATEST-1',
    normalizedCode: 'latest-1',
    searchKeywords: ['目录最新名称', 'latest-1'],
    version: 3
  }));
  const restored = await restoreProductToWarehouse(fixture.db, fixture.user, {
    warehouseProductId,
    requestKey: 'restore_product_123456'
  });
  assert.strictEqual(restored.idempotent, false);
  assert.strictEqual(restored.warehouseProduct.id, warehouseProductId);
  assert.strictEqual(restored.warehouseProduct.stock, 0);
  assert.strictEqual(restored.warehouseProduct.stockStatus, 'out');
  const restoredDocument = fixture.documents.warehouse_products.get(warehouseProductId);
  assert.strictEqual(restoredDocument.productNameSnapshot, '目录最新名称');
  assert.strictEqual(restoredDocument.productVersion, 3);
  assert.strictEqual(fixture.documents.products.get(productId).activeWarehouseCount, 1);
  assert.strictEqual(fixture.documents.teams.get(TEAM_ID).activeProductCount, originalTeamCount);
  assert.strictEqual(fixture.documents.stock_records.size, originalRecordCount);
  const restoreRetry = await restoreProductToWarehouse(fixture.db, fixture.user, {
    warehouseProductId,
    requestKey: 'restore_product_123456'
  });
  assert.strictEqual(restoreRetry.idempotent, true);
  assert.strictEqual(fixture.documents.products.get(productId).activeWarehouseCount, 1);

  await removeProductFromWarehouse(fixture.db, fixture.user, {
    warehouseProductId,
    reason: '',
    requestKey: 'remove_again_12345678'
  });
  fixture.documents.products.get(productId).status = 'deleted';
  await expectAsyncCode(() => restoreProductToWarehouse(fixture.db, fixture.user, {
    warehouseProductId,
    requestKey: 'restore_deleted_123456'
  }), ERROR_CODES.PRODUCT_CATALOG_DELETED);
}

function testQueryAndStaticBoundaries() {
  const fixture = createFixture();
  const input = validateRemovedProductListInput({ keyword: '工具', category: '工具' });
  const where = buildProductListWhere(fixture.db.command, input, {
    team: { _id: TEAM_ID }, warehouse: { _id: WAREHOUSE_ID }
  }, 'removed');
  assert.strictEqual(where.__operation, 'or');
  assert.ok(where.branches.every((branch) => branch.status === 'removed' &&
    branch.teamId === TEAM_ID && branch.warehouseId === WAREHOUSE_ID));

  const root = path.resolve(__dirname, '..');
  const frontendFiles = [
    'miniprogram/pages/product-edit/product-edit.js',
    'miniprogram/pages/product-detail/product-detail.js',
    'miniprogram/pages/product-recycle-bin/product-recycle-bin.js',
    'miniprogram/pages/inventory/inventory.js',
    'miniprogram/pages/profile/profile.js'
  ];
  const frontend = frontendFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  ['wx.cloud', '.database(', 'setStorage', 'setStorageSync', 'mock-data'].forEach((value) => {
    assert.strictEqual(frontend.includes(value), false);
  });
  assert.ok(frontend.includes('productService.updateProduct'));
  assert.ok(frontend.includes('productService.removeProductFromWarehouse'));
  assert.ok(frontend.includes('productService.listRemovedProducts'));
  assert.ok(frontend.includes('productService.restoreProductToWarehouse'));
  const router = fs.readFileSync(path.join(root, 'cloudfunctions/warehouse-api/router.js'), 'utf8');
  ['product.update', 'product.removeFromWarehouse', 'product.removed.list', 'product.restoreToWarehouse']
    .forEach((action) => assert.ok(router.includes(`'${action}'`)));
  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
  assert.ok(appConfig.pages.includes('pages/product-recycle-bin/product-recycle-bin'));
  const inventoryWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/inventory/inventory.wxml'), 'utf8');
  const profileSource = fs.readFileSync(path.join(root, 'miniprogram/pages/profile/profile.js'), 'utf8');
  const profileUtils = fs.readFileSync(path.join(root, 'miniprogram/pages/profile/profile-utils.js'), 'utf8');
  assert.strictEqual(inventoryWxml.includes('回收站'), false);
  assert.ok(profileSource.includes('ROUTES.PRODUCT_RECYCLE_BIN'));
  assert.ok(profileUtils.includes("action: 'recycle'"));
}

async function run() {
  testValidatorsAndHashes();
  testClientWhitelistsAndEditHelpers();
  await testCloudTransactionsAndPermissions();
  testQueryAndStaticBoundaries();
  console.log('stage2c3a tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
