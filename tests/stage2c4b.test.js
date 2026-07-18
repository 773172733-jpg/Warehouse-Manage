const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ApiError, ERROR_CODES } = require('../cloudfunctions/warehouse-api/common/errors.js');
const { createMembershipId } = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const {
  RECORD_TYPES,
  validateRecordListInput,
  presentStockRecord,
  listStockRecords
} = require('../cloudfunctions/warehouse-api/modules/stock/record-service.js');
const { ACTION_HANDLERS } = require('../cloudfunctions/warehouse-api/router.js');
const productService = require('../miniprogram/services/product-service.js');
const stockService = require('../miniprogram/services/stock-service.js');

const ROOT = path.resolve(__dirname, '..');
const TEAM_ID = 'team_12345678';
const WAREHOUSE_ID = 'warehouse_12345678';
const USER_ID = 'user_12345678';
const PRODUCT_ID = 'product_12345678';
const WAREHOUSE_PRODUCT_ID = 'warehouse_product_12345678';

function compareValue(left, right) {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function matchesValue(value, condition) {
  if (!condition || typeof condition !== 'object' || condition instanceof Date) {
    return compareValue(value, condition) === 0;
  }
  if (condition.operator === 'lt') return compareValue(value, condition.value) < 0;
  if (condition.operator === 'eq') return compareValue(value, condition.value) === 0;
  return compareValue(value, condition) === 0;
}

function matches(document, where) {
  if (where && Array.isArray(where.or)) {
    return where.or.some((branch) => matches(document, branch));
  }
  return Object.keys(where || {}).every((key) => matchesValue(document[key], where[key]));
}

function createFixture(role = 'owner', options = {}) {
  const membershipId = createMembershipId(TEAM_ID, USER_ID);
  const documents = {
    users: new Map([[USER_ID, {
      _id: USER_ID,
      status: 'active',
      currentTeamId: TEAM_ID,
      currentWarehouseId: WAREHOUSE_ID
    }]]),
    teams: new Map([[TEAM_ID, {
      _id: TEAM_ID,
      status: 'active',
      defaultWarehouseId: WAREHOUSE_ID
    }]]),
    team_members: new Map([[membershipId, {
      _id: membershipId,
      teamId: TEAM_ID,
      userId: USER_ID,
      role,
      status: options.membershipStatus || 'active'
    }]]),
    warehouses: new Map([[WAREHOUSE_ID, {
      _id: WAREHOUSE_ID,
      teamId: TEAM_ID,
      status: 'active'
    }]]),
    warehouse_products: new Map([[WAREHOUSE_PRODUCT_ID, {
      _id: WAREHOUSE_PRODUCT_ID,
      teamId: options.productTeamId || TEAM_ID,
      warehouseId: options.productWarehouseId || WAREHOUSE_ID,
      productId: PRODUCT_ID,
      status: 'active',
      stock: 12,
      stockVersion: 4
    }]]),
    stock_records: new Map()
  };

  const types = ['initial', 'inbound', 'outbound', 'adjustment'];
  const recordCount = options.recordCount === undefined ? 27 : options.recordCount;
  for (let index = 0; index < recordCount; index += 1) {
    const type = types[index % types.length];
    const delta = type === 'outbound' ? -2 : (type === 'adjustment' ? -1 : 3);
    const afterStock = 100 - index;
    const id = `stock_record_${String(index).padStart(4, '0')}`;
    documents.stock_records.set(id, {
      _id: id,
      teamId: TEAM_ID,
      warehouseId: WAREHOUSE_ID,
      warehouseProductId: WAREHOUSE_PRODUCT_ID,
      type,
      beforeStock: afterStock - delta,
      afterStock,
      delta,
      quantity: Math.abs(delta),
      reason: type === 'initial' ? 'initial_stock' : `reason-${index}`,
      referenceNo: `REF-${index}`,
      operatorUserId: USER_ID,
      operatorRole: index % 2 ? 'admin' : 'owner',
      operatorNameSnapshot: '',
      requestKey: `secret-request-${index}`,
      requestHash: `secret-hash-${index}`,
      stockVersionBefore: index + 1,
      stockVersionAfter: index + 2,
      createdAt: new Date(Date.UTC(2026, 6, 18, 0, 0, recordCount - index))
    });
  }

  const db = {
    command: {
      lt(value) {
        return { operator: 'lt', value };
      },
      eq(value) {
        return { operator: 'eq', value };
      },
      or(branches) {
        return { or: branches };
      }
    },
    collection(name) {
      const collection = documents[name];
      assert.ok(collection, `unknown collection ${name}`);
      let where = {};
      let limit = Infinity;
      const ordering = [];
      let selectedFields = null;
      const api = {
        doc(id) {
          return {
            async get() {
              return { data: collection.get(id) || null };
            }
          };
        },
        where(value) {
          where = value;
          return api;
        },
        orderBy(field, direction) {
          ordering.push({ field, direction });
          return api;
        },
        limit(value) {
          limit = value;
          return api;
        },
        field(value) {
          selectedFields = value;
          return api;
        },
        async get() {
          let data = Array.from(collection.values()).filter((item) => matches(item, where));
          data.sort((left, right) => {
            for (const order of ordering) {
              const compared = compareValue(left[order.field], right[order.field]);
              if (compared) return order.direction === 'desc' ? -compared : compared;
            }
            return 0;
          });
          data = data.slice(0, limit).map((item) => {
            if (!selectedFields) return structuredClone(item);
            return Object.keys(selectedFields).reduce((result, field) => {
              if (selectedFields[field] && item[field] !== undefined) {
                result[field] = structuredClone(item[field]);
              }
              return result;
            }, {});
          });
          return { data };
        }
      };
      return api;
    }
  };

  return {
    db,
    documents,
    user: documents.users.get(USER_ID)
  };
}

async function expectCode(callback, code) {
  await assert.rejects(callback, (error) => error instanceof ApiError && error.code === code);
}

function testInputAndPresentation() {
  assert.deepStrictEqual(RECORD_TYPES, [
    'all',
    'initial',
    'inbound',
    'outbound',
    'adjustment'
  ]);
  const input = validateRecordListInput({ warehouseProductId: WAREHOUSE_PRODUCT_ID });
  assert.strictEqual(input.type, 'all');
  assert.strictEqual(input.pageSize, 20);
  assert.throws(
    () => validateRecordListInput({
      warehouseProductId: WAREHOUSE_PRODUCT_ID,
      pageSize: 51
    }),
    (error) => error.code === ERROR_CODES.INVALID_PAGE_SIZE
  );
  assert.throws(
    () => validateRecordListInput({
      warehouseProductId: WAREHOUSE_PRODUCT_ID,
      teamId: TEAM_ID
    }),
    (error) => error.code === ERROR_CODES.FORBIDDEN
  );

  const presented = presentStockRecord({
    _id: 'stock_record_12345678',
    type: 'initial',
    beforeStock: 0,
    afterStock: 100,
    changeQuantity: 100,
    reason: 'initial_stock',
    sourceOrDestination: 'OPENING',
    operatorNameSnapshot: '',
    operatorRole: 'owner',
    requestKey: 'secret',
    requestHash: 'secret',
    operatorUserId: USER_ID,
    createdAt: new Date('2026-07-18T00:00:00.000Z')
  });
  assert.strictEqual(presented.delta, 100);
  assert.strictEqual(presented.quantity, 100);
  assert.strictEqual(presented.referenceNo, 'OPENING');
  assert.strictEqual(presented.operatorDisplayName, '所有者');
  const json = JSON.stringify(presented);
  ['requestKey', 'requestHash', 'operatorUserId', 'teamId'].forEach((field) => {
    assert.strictEqual(json.includes(field), false);
  });
}

async function testPermissionsScopesFiltersAndPagination() {
  for (const role of ['owner', 'admin', 'viewer']) {
    const fixture = createFixture(role);
    const first = await listStockRecords(fixture.db, fixture.user, {
      warehouseProductId: WAREHOUSE_PRODUCT_ID,
      type: 'all',
      pageSize: 20
    });
    assert.strictEqual(first.items.length, 20);
    assert.strictEqual(first.hasMore, true);
    assert.ok(first.nextCursor);
    const second = await listStockRecords(fixture.db, fixture.user, {
      warehouseProductId: WAREHOUSE_PRODUCT_ID,
      type: 'all',
      pageSize: 20,
      cursor: first.nextCursor
    });
    assert.strictEqual(second.items.length, 7);
    assert.strictEqual(second.hasMore, false);
    assert.strictEqual(new Set(first.items.concat(second.items).map((item) => item.id)).size, 27);
  }

  const filteredFixture = createFixture('viewer');
  const filtered = await listStockRecords(filteredFixture.db, filteredFixture.user, {
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    type: 'outbound',
    pageSize: 3
  });
  assert.strictEqual(filtered.items.length, 3);
  assert.ok(filtered.items.every((item) => item.type === 'outbound'));
  const filteredNext = await listStockRecords(filteredFixture.db, filteredFixture.user, {
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    type: 'outbound',
    pageSize: 3,
    cursor: filtered.nextCursor
  });
  assert.ok(filteredNext.items.every((item) => item.type === 'outbound'));
  assert.strictEqual(
    new Set(filtered.items.concat(filteredNext.items).map((item) => item.id)).size,
    filtered.items.length + filteredNext.items.length
  );

  await expectCode(
    () => listStockRecords(
      createFixture('viewer', { membershipStatus: 'pending' }).db,
      createFixture('viewer', { membershipStatus: 'pending' }).user,
      { warehouseProductId: WAREHOUSE_PRODUCT_ID }
    ),
    ERROR_CODES.NO_ACTIVE_TEAM
  );
  const crossTeam = createFixture('owner', { productTeamId: 'team_other_12345678' });
  await expectCode(
    () => listStockRecords(crossTeam.db, crossTeam.user, {
      warehouseProductId: WAREHOUSE_PRODUCT_ID
    }),
    ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE
  );
  const crossWarehouse = createFixture('owner', {
    productWarehouseId: 'warehouse_other_12345678'
  });
  await expectCode(
    () => listStockRecords(crossWarehouse.db, crossWarehouse.user, {
      warehouseProductId: WAREHOUSE_PRODUCT_ID
    }),
    ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE
  );
}

function applySetData(target, updates) {
  Object.keys(updates).forEach((key) => {
    const parts = key.split('.');
    let cursor = target;
    parts.slice(0, -1).forEach((part) => {
      if (!cursor[part]) cursor[part] = {};
      cursor = cursor[part];
    });
    cursor[parts[parts.length - 1]] = updates[key];
  });
}

function createPage(config) {
  const page = Object.assign({}, config);
  page.data = JSON.parse(JSON.stringify(config.data));
  page.setData = function setData(updates, callback) {
    applySetData(this.data, updates);
    if (callback) callback();
  };
  return page;
}

function detailResponse(canOperateStock = true) {
  return {
    product: {
      id: PRODUCT_ID,
      name: 'RA1809100',
      productCode: 'RA1809100',
      category: '配件',
      unit: '件',
      cover: {
        type: 'image',
        imageUrl: 'https://example.invalid/private-image',
        background: '#EAF6EF'
      }
    },
    warehouseProduct: {
      id: WAREHOUSE_PRODUCT_ID,
      productId: PRODUCT_ID,
      stock: 10,
      minStock: 3,
      stockStatus: 'normal',
      stockVersion: 4
    },
    permissions: {
      canEdit: canOperateStock,
      canOperateStock,
      canRemove: canOperateStock
    }
  };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function testStockOperationPage() {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalDetail = productService.getProductDetail;
  const originalInbound = stockService.inboundStock;
  let pageConfig;
  let mutationCalls = 0;
  let successContent = '';

  global.Page = (config) => {
    pageConfig = config;
  };
  global.getApp = () => ({ globalData: {} });
  global.wx = {
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 390 }),
    getMenuButtonBoundingClientRect: () => ({ width: 0, height: 0, left: 0 }),
    showToast() {},
    showModal(options) {
      if (options.title === '确认操作') {
        options.success({ confirm: true });
      } else {
        successContent = options.content;
      }
    },
    navigateBack() {},
    switchTab() {}
  };
  productService.getProductDetail = () => Promise.resolve(detailResponse(true));
  stockService.inboundStock = (payload) => {
    mutationCalls += 1;
    return Promise.resolve({
      beforeStock: 10,
      afterStock: 15,
      delta: 5,
      stockStatus: 'normal',
      stockVersion: 5,
      idempotent: false,
      payload
    });
  };

  const modulePath = require.resolve('../miniprogram/pages/stock-operation/stock-operation.js');
  delete require.cache[modulePath];
  require('../miniprogram/pages/stock-operation/stock-operation.js');

  try {
    const ownerPage = createPage(pageConfig);
    ownerPage.onLoad({
      mode: 'inbound',
      warehouseProductId: WAREHOUSE_PRODUCT_ID
    });
    await flushPromises();
    assert.strictEqual(ownerPage.data.product.name, 'RA1809100');
    assert.strictEqual(ownerPage.data.product.cover.type, 'image');
    assert.strictEqual(ownerPage.data.stockVersion, 4);

    ownerPage.setData({ quantity: 5, operationReason: '补货', referenceNo: 'IN-1' });
    const firstPayload = ownerPage.buildMutationPayload();
    const retryPayload = ownerPage.buildMutationPayload();
    assert.strictEqual(firstPayload.requestKey, retryPayload.requestKey);
    assert.strictEqual(firstPayload.expectedStockVersion, 4);

    ownerPage.onConfirm();
    ownerPage.onConfirm();
    await flushPromises();
    assert.strictEqual(mutationCalls, 1);
    assert.ok(successContent.includes('操作前：10件'));
    assert.ok(successContent.includes('操作后：15件'));
    assert.ok(successContent.includes('变化量：+5件'));
    assert.ok(successContent.includes('库存版本：5'));

    ownerPage.setData({ stockBefore: 999999999, quantity: 1 });
    assert.strictEqual(ownerPage.validate(), false);
    assert.strictEqual(ownerPage.data.validationErrors.quantity, '入库后库存不能超过999999999');

    ownerPage.setData({
      mode: 'outbound',
      stockBefore: 2,
      quantity: 3,
      validationErrors: {}
    });
    assert.strictEqual(ownerPage.validate(), false);
    assert.strictEqual(ownerPage.data.validationErrors.quantity, '出库数量不能大于当前库存');

    ownerPage.setData({
      mode: 'adjustment',
      stockBefore: 10,
      targetStock: 0,
      reason: '',
      customReason: '',
      validationErrors: {}
    });
    assert.strictEqual(ownerPage.validate(), false);
    assert.ok(ownerPage.data.validationErrors.reason);
    ownerPage.setData({ reason: '盘点修正' });
    assert.strictEqual(ownerPage.validate(), true);
    ownerPage.computeStockAfter();
    assert.strictEqual(ownerPage.data.quantityDelta, -10);
    ownerPage.setData({ targetStock: 10 });
    assert.strictEqual(ownerPage.validate(), false);
    assert.ok(ownerPage.data.validationErrors.targetStock);

    const viewerPage = createPage(pageConfig);
    productService.getProductDetail = () => Promise.resolve(detailResponse(false));
    viewerPage.onLoad({
      mode: 'inbound',
      warehouseProductId: WAREHOUSE_PRODUCT_ID
    });
    await flushPromises();
    assert.strictEqual(viewerPage.data.invalidPage, true);
    assert.strictEqual(viewerPage.data.invalidDesc, '当前账号无权执行此操作。');

    const unloadedPage = createPage(pageConfig);
    productService.getProductDetail = () => Promise.resolve(detailResponse(true));
    unloadedPage.onLoad({
      mode: 'inbound',
      warehouseProductId: WAREHOUSE_PRODUCT_ID
    });
    unloadedPage.onUnload();
    await flushPromises();
    assert.strictEqual(unloadedPage.data.product, null);
  } finally {
    productService.getProductDetail = originalDetail;
    stockService.inboundStock = originalInbound;
    global.Page = originalPage;
    global.wx = originalWx;
    global.getApp = originalGetApp;
    delete require.cache[modulePath];
  }
}

function testStaticBoundaries() {
  assert.ok(ACTION_HANDLERS['stock.records.list']);
  assert.strictEqual(ACTION_HANDLERS['stock.records.update'], undefined);
  assert.strictEqual(ACTION_HANDLERS['stock.records.delete'], undefined);

  const recordSource = fs.readFileSync(
    path.join(ROOT, 'cloudfunctions/warehouse-api/modules/stock/record-service.js'),
    'utf8'
  );
  assert.ok(recordSource.includes("requireProductAccess(db, user)"));
  assert.ok(recordSource.includes("orderBy('createdAt', 'desc')"));
  assert.ok(recordSource.includes("orderBy('_id', 'desc')"));
  assert.strictEqual(/STOCK_RECORDS\)[\s\S]*?\.update\(/.test(recordSource), false);
  assert.strictEqual(/STOCK_RECORDS\)[\s\S]*?\.remove\(/.test(recordSource), false);
  assert.strictEqual(recordSource.includes('requestKey: true'), false);
  assert.strictEqual(recordSource.includes('requestHash: true'), false);

  const operationSource = fs.readFileSync(
    path.join(ROOT, 'miniprogram/pages/stock-operation/stock-operation.js'),
    'utf8'
  );
  assert.ok(operationSource.includes('if (this.data.submitting'));
  assert.ok(operationSource.includes('preserveInput: true'));
  assert.ok(operationSource.includes('库存已被其他操作更新，请刷新后重试'));
  assert.ok(operationSource.includes('this.pageActive'));
  assert.strictEqual(operationSource.includes('setStorage'), false);
  assert.strictEqual(operationSource.includes('console.'), false);

  const recordsPage = fs.readFileSync(
    path.join(ROOT, 'miniprogram/pages/stock-records/stock-records.js'),
    'utf8'
  );
  assert.ok(recordsPage.includes('listStockRecords'));
  assert.ok(recordsPage.includes("activeType: 'all'"));
  assert.ok(recordsPage.includes("records: []"));
  assert.ok(recordsPage.includes("nextCursor: ''"));
  assert.strictEqual(recordsPage.includes('wx.cloud'), false);
  assert.strictEqual(recordsPage.includes('.database('), false);
  assert.strictEqual(recordsPage.includes('console.'), false);

  const detailWxml = fs.readFileSync(
    path.join(ROOT, 'miniprogram/pages/product-detail/product-detail.wxml'),
    'utf8'
  );
  assert.ok(detailWxml.includes('openStockRecords'));
  assert.ok(detailWxml.includes('permissions.canOperateStock'));
  assert.strictEqual(detailWxml.includes('真实库存流水将在后续阶段接入'), false);

  const indexDoc = fs.readFileSync(path.join(ROOT, 'database/indexes.md'), 'utf8');
  assert.ok(indexDoc.includes('idx_records_wh_product_created'));
  assert.ok(indexDoc.includes('warehouseProductId'));
  assert.ok(indexDoc.includes('createdAt'));
  assert.ok(indexDoc.includes('_id'));

  const cleanupWorker = fs.readFileSync(
    path.join(ROOT, 'cloudfunctions/product-image-cleanup-worker/index.js'),
    'utf8'
  );
  assert.strictEqual(cleanupWorker.includes('stock_records'), false);
}

async function run() {
  testInputAndPresentation();
  await testPermissionsScopesFiltersAndPagination();
  await testStockOperationPage();
  testStaticBoundaries();
  console.log('stage2c4b tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
