const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ApiError, ERROR_CODES } = require('../cloudfunctions/warehouse-api/common/errors.js');
const { createMembershipId } = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const { STOCK_ACTIONS } = require('../cloudfunctions/warehouse-api/common/stock-utils.js');
const { mutateStock } = require('../cloudfunctions/warehouse-api/modules/stock/stock-service.js');
const {
  createProduct
} = require('../cloudfunctions/warehouse-api/modules/product/product-service.js');
const {
  listStockRecords
} = require('../cloudfunctions/warehouse-api/modules/stock/record-service.js');
const productService = require('../miniprogram/services/product-service.js');
const stockService = require('../miniprogram/services/stock-service.js');

const ROOT = path.resolve(__dirname, '..');
const TEAM_ID = 'team_12345678';
const WAREHOUSE_ID = 'warehouse_12345678';
const USER_ID = 'user_12345678';
const PRODUCT_ID = 'product_12345678';
const WAREHOUSE_PRODUCT_ID = 'warehouse_product_12345678';

function cloneCollections(collections) {
  return Object.keys(collections).reduce((result, name) => {
    result[name] = new Map();
    collections[name].forEach((value, id) => {
      result[name].set(id, structuredClone(value));
    });
    return result;
  }, {});
}

function replaceCollections(target, source) {
  Object.keys(target).forEach((name) => {
    target[name].clear();
    source[name].forEach((value, id) => target[name].set(id, value));
  });
}

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
  if (condition.operator === 'in') return condition.value.includes(value);
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
      displayName: '库存管理员',
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
      name: 'RA1809100',
      productCode: 'RA1809100',
      category: '配件',
      unit: '件',
      status: 'active'
    }]]),
    product_image_assets: new Map(),
    warehouse_products: new Map([[WAREHOUSE_PRODUCT_ID, {
      _id: WAREHOUSE_PRODUCT_ID,
      teamId: options.productTeamId || TEAM_ID,
      warehouseId: options.productWarehouseId || WAREHOUSE_ID,
      productId: PRODUCT_ID,
      productNameSnapshot: 'RA1809100',
      productCodeSnapshot: 'RA1809100',
      unitSnapshot: '件',
      status: 'active',
      stock: options.stock === undefined ? 20 : options.stock,
      minStock: 5,
      stockStatus: 'normal',
      stockVersion: 1
    }]]),
    stock_records: new Map()
  };
  const failures = {
    stockRecordSet: Boolean(options.failStockRecordSet)
  };

  function source(store) {
    return {
      command: {
        lt(value) {
          return { operator: 'lt', value };
        },
        eq(value) {
          return { operator: 'eq', value };
        },
        in(value) {
          return { operator: 'in', value };
        },
        or(branches) {
          return { or: branches };
        }
      },
      collection(name) {
        const collection = store[name];
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
              },
              async set({ data }) {
                if (name === 'stock_records' && failures.stockRecordSet) {
                  throw new Error('injected stock record write failure');
                }
                collection.set(id, Object.assign({ _id: id }, structuredClone(data)));
              },
              async update({ data }) {
                const current = collection.get(id);
                assert.ok(current, `missing ${name}/${id}`);
                collection.set(id, Object.assign({}, current, structuredClone(data)));
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
            let data = Array.from(collection.values())
              .filter((document) => matches(document, where));
            data.sort((left, right) => {
              for (const order of ordering) {
                const compared = compareValue(left[order.field], right[order.field]);
                if (compared) return order.direction === 'desc' ? -compared : compared;
              }
              return 0;
            });
            data = data.slice(0, limit).map((document) => {
              if (!selectedFields) return structuredClone(document);
              return Object.keys(selectedFields).reduce((result, field) => {
                if (selectedFields[field] && document[field] !== undefined) {
                  result[field] = structuredClone(document[field]);
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
  }

  const db = source(documents);
  let clock = 0;
  db.serverDate = () => new Date(Date.UTC(2026, 6, 18, 0, 0, clock++));
  db.runTransaction = async (callback) => {
    const staged = cloneCollections(documents);
    const transaction = source(staged);
    const result = await callback(transaction);
    replaceCollections(documents, staged);
    return result;
  };

  return {
    db,
    documents,
    failures,
    user: documents.users.get(USER_ID)
  };
}

function quantityInput(overrides = {}) {
  return Object.assign({
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    quantity: 10,
    expectedStockVersion: 1,
    reason: '到货补充',
    referenceNo: 'IN-20260718-001',
    requestKey: 'stock_inbound_visible_12345678'
  }, overrides);
}

function productInput(overrides = {}) {
  return Object.assign({
    name: '新建商品',
    productCode: 'NEW-001',
    category: '配件',
    unit: '件',
    brand: '',
    specification: '',
    description: '',
    coverType: 'text',
    coverText: '新',
    coverBackground: '#EAF6EF',
    minStock: 2,
    initialStock: 8,
    requestKey: 'product_initial_visible_12345678'
  }, overrides);
}

async function expectCode(callback, code) {
  await assert.rejects(callback, (error) => error instanceof ApiError && error.code === code);
}

function addOlderInitialRecord(fixture) {
  fixture.documents.stock_records.set('stock_record_older_12345678', {
    _id: 'stock_record_older_12345678',
    teamId: TEAM_ID,
    warehouseId: WAREHOUSE_ID,
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    productId: PRODUCT_ID,
    type: 'initial',
    beforeStock: 0,
    afterStock: 20,
    changeQuantity: 20,
    reason: 'initial_stock',
    sourceOrDestination: '',
    operatorNameSnapshot: '库存管理员',
    createdAt: new Date('2026-07-17T00:00:00.000Z')
  });
}

async function testInboundWriteAndRead() {
  const fixture = createFixture('owner');
  addOlderInitialRecord(fixture);
  const result = await mutateStock(
    fixture.db,
    fixture.user,
    STOCK_ACTIONS.INBOUND,
    quantityInput()
  );
  assert.strictEqual(result.beforeStock, 20);
  assert.strictEqual(result.afterStock, 30);
  assert.strictEqual(result.delta, 10);
  assert.strictEqual(fixture.documents.stock_records.size, 2);

  const stored = fixture.documents.stock_records.get(result.recordId);
  assert.ok(stored);
  assert.strictEqual(stored.type, 'inbound');
  assert.strictEqual(stored.warehouseProductId, WAREHOUSE_PRODUCT_ID);
  assert.strictEqual(stored.productId, PRODUCT_ID);
  assert.strictEqual(stored.teamId, TEAM_ID);
  assert.strictEqual(stored.warehouseId, WAREHOUSE_ID);
  assert.strictEqual(stored.beforeStock, 20);
  assert.strictEqual(stored.afterStock, 30);
  assert.strictEqual(stored.delta, 10);
  assert.strictEqual(stored.quantity, 10);
  assert.ok(stored.createdAt instanceof Date);
  assert.strictEqual(stored.stockVersionBefore, 1);
  assert.strictEqual(stored.stockVersionAfter, 2);

  const allRecords = await listStockRecords(fixture.db, fixture.user, {
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    type: 'all',
    pageSize: 20
  });
  assert.strictEqual(allRecords.items.length, 2);
  assert.strictEqual(allRecords.items[0].id, result.recordId);
  assert.strictEqual(allRecords.items[0].type, 'inbound');
  assert.strictEqual(allRecords.items[0].delta, 10);

  const inboundRecords = await listStockRecords(fixture.db, fixture.user, {
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    type: 'inbound',
    pageSize: 20
  });
  assert.strictEqual(inboundRecords.items.length, 1);
  assert.strictEqual(inboundRecords.items[0].id, result.recordId);

  const serialized = JSON.stringify(allRecords);
  ['requestHash', 'requestKey', 'operatorUserId', 'teamId', 'warehouseId']
    .forEach((field) => assert.strictEqual(serialized.includes(field), false));

  const retry = await mutateStock(
    fixture.db,
    fixture.user,
    STOCK_ACTIONS.INBOUND,
    quantityInput()
  );
  assert.strictEqual(retry.idempotent, true);
  assert.strictEqual(fixture.documents.stock_records.size, 2);
}

async function testInitialWriteAndRead() {
  const fixture = createFixture('owner');
  const created = await createProduct(
    fixture.db,
    fixture.user,
    productInput()
  );
  assert.ok(created.initialRecord);
  assert.strictEqual(created.initialRecord.type, 'initial');
  assert.strictEqual(created.initialRecord.beforeStock, 0);
  assert.strictEqual(created.initialRecord.afterStock, 8);

  const records = await listStockRecords(fixture.db, fixture.user, {
    warehouseProductId: created.warehouseProduct.id,
    type: 'all',
    pageSize: 20
  });
  assert.strictEqual(records.items.length, 1);
  assert.strictEqual(records.items[0].type, 'initial');
  assert.strictEqual(records.items[0].delta, 8);

  const zeroFixture = createFixture('owner');
  const zeroCreated = await createProduct(
    zeroFixture.db,
    zeroFixture.user,
    productInput({
      initialStock: 0,
      requestKey: 'product_initial_zero_12345678'
    })
  );
  assert.strictEqual(zeroCreated.initialRecord, null);
  const zeroRecords = await listStockRecords(zeroFixture.db, zeroFixture.user, {
    warehouseProductId: zeroCreated.warehouseProduct.id,
    type: 'all',
    pageSize: 20
  });
  assert.strictEqual(zeroRecords.items.length, 0);
}

async function testAtomicityAndOtherMutationTypes() {
  const insufficient = createFixture('owner', { stock: 3 });
  await expectCode(
    () => mutateStock(
      insufficient.db,
      insufficient.user,
      STOCK_ACTIONS.OUTBOUND,
      quantityInput({
        quantity: 4,
        requestKey: 'stock_outbound_fail_12345678'
      })
    ),
    ERROR_CODES.INSUFFICIENT_STOCK
  );
  assert.strictEqual(insufficient.documents.stock_records.size, 0);
  assert.strictEqual(
    insufficient.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).stock,
    3
  );

  const writeFailure = createFixture('owner', { failStockRecordSet: true });
  await expectCode(
    () => mutateStock(
      writeFailure.db,
      writeFailure.user,
      STOCK_ACTIONS.INBOUND,
      quantityInput()
    ),
    ERROR_CODES.DATABASE_ERROR
  );
  const unchanged = writeFailure.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID);
  assert.strictEqual(unchanged.stock, 20);
  assert.strictEqual(unchanged.stockVersion, 1);
  assert.strictEqual(writeFailure.documents.stock_records.size, 0);

  const outbound = createFixture('admin');
  await mutateStock(
    outbound.db,
    outbound.user,
    STOCK_ACTIONS.OUTBOUND,
    quantityInput({
      quantity: 5,
      requestKey: 'stock_outbound_visible_12345678'
    })
  );
  const outboundList = await listStockRecords(outbound.db, outbound.user, {
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    type: 'outbound'
  });
  assert.strictEqual(outboundList.items[0].type, 'outbound');
  assert.strictEqual(outboundList.items[0].delta, -5);

  const adjustment = createFixture('owner');
  await mutateStock(
    adjustment.db,
    adjustment.user,
    STOCK_ACTIONS.ADJUST,
    {
      warehouseProductId: WAREHOUSE_PRODUCT_ID,
      targetStock: 7,
      expectedStockVersion: 1,
      reason: '盘点修正',
      referenceNo: 'COUNT-001',
      requestKey: 'stock_adjust_visible_12345678'
    }
  );
  const adjustmentList = await listStockRecords(adjustment.db, adjustment.user, {
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    type: 'adjustment'
  });
  assert.strictEqual(adjustmentList.items[0].type, 'adjustment');
  assert.strictEqual(adjustmentList.items[0].delta, -13);
}

async function testPermissionsAndIsolation() {
  for (const role of ['owner', 'admin', 'viewer']) {
    const fixture = createFixture(role);
    addOlderInitialRecord(fixture);
    const list = await listStockRecords(fixture.db, fixture.user, {
      warehouseProductId: WAREHOUSE_PRODUCT_ID
    });
    assert.strictEqual(list.items.length, 1);
  }

  const viewer = createFixture('viewer');
  await expectCode(
    () => mutateStock(
      viewer.db,
      viewer.user,
      STOCK_ACTIONS.INBOUND,
      quantityInput()
    ),
    ERROR_CODES.FORBIDDEN
  );

  const crossTeam = createFixture('owner', {
    productTeamId: 'team_other_12345678'
  });
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

function detailResponse() {
  return {
    product: {
      id: PRODUCT_ID,
      name: 'RA1809100',
      productCode: 'RA1809100',
      category: '配件',
      unit: '件',
      cover: { type: 'text', text: 'RA', background: '#EAF6EF' }
    },
    warehouseProduct: {
      id: WAREHOUSE_PRODUCT_ID,
      productId: PRODUCT_ID,
      stock: 30,
      minStock: 5,
      stockStatus: 'normal',
      stockVersion: 2
    },
    permissions: {
      canEdit: true,
      canOperateStock: true,
      canRemove: true
    }
  };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function testStockRecordsPageRefresh() {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalDetail = productService.getProductDetail;
  const originalList = stockService.listStockRecords;
  let pageConfig;
  let listCalls = 0;
  let pullDownStops = 0;
  const listInputs = [];
  const app = {
    globalData: {},
    clearTeamContext() {},
    bootstrap: () => Promise.resolve()
  };

  global.Page = (config) => {
    pageConfig = config;
  };
  global.getApp = () => app;
  global.wx = {
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 390 }),
    getMenuButtonBoundingClientRect: () => ({ width: 0, height: 0, left: 0 }),
    showToast() {},
    stopPullDownRefresh() {
      pullDownStops += 1;
    },
    navigateBack() {},
    switchTab() {},
    reLaunch() {}
  };
  productService.getProductDetail = () => Promise.resolve(detailResponse());
  stockService.listStockRecords = (input) => {
    listCalls += 1;
    listInputs.push(Object.assign({}, input));
    return Promise.resolve({
      items: listCalls === 1 ? [] : [{
        id: 'stock_record_visible_12345678',
        type: 'inbound',
        beforeStock: 20,
        afterStock: 30,
        delta: 10,
        quantity: 10,
        reason: '到货补充',
        referenceNo: 'IN-20260718-001',
        operatorDisplayName: '库存管理员',
        operatorRole: 'owner',
        createdAt: '2026-07-18T00:00:00.000Z',
        stockVersionBefore: 1,
        stockVersionAfter: 2
      }],
      nextCursor: null,
      hasMore: false
    });
  };

  const modulePath = require.resolve('../miniprogram/pages/stock-records/stock-records.js');
  delete require.cache[modulePath];
  require('../miniprogram/pages/stock-records/stock-records.js');

  try {
    const page = createPage(pageConfig);
    page.onLoad({ warehouseProductId: WAREHOUSE_PRODUCT_ID });
    page.onShow();
    await flushPromises();
    assert.strictEqual(listCalls, 1);
    assert.strictEqual(listInputs[0].type, 'all');
    assert.strictEqual(listInputs[0].cursor, undefined);
    assert.strictEqual(page.data.records.length, 0);

    app.globalData.stockRecordsRefreshRequired = {
      warehouseProductId: WAREHOUSE_PRODUCT_ID
    };
    page.onShow();
    await flushPromises();
    assert.strictEqual(listCalls, 2);
    assert.strictEqual(page.data.records.length, 1);
    assert.strictEqual(page.data.records[0].type, 'inbound');
    assert.strictEqual(page.data.records[0].deltaText, '+10');
    assert.strictEqual(page.data.nextCursor, '');
    assert.strictEqual(app.globalData.stockRecordsRefreshRequired, null);

    page.setData({
      records: [{ id: 'old' }],
      nextCursor: 'old-cursor',
      hasMore: true
    });
    page.onTypeTap({ currentTarget: { dataset: { value: 'inbound' } } });
    assert.deepStrictEqual(page.data.records, []);
    assert.strictEqual(page.data.nextCursor, '');
    await flushPromises();
    assert.strictEqual(listInputs[2].type, 'inbound');
    assert.strictEqual(listInputs[2].cursor, undefined);

    await page.onPullDownRefresh();
    assert.strictEqual(listInputs[3].cursor, undefined);
    assert.strictEqual(pullDownStops, 1);
  } finally {
    productService.getProductDetail = originalDetail;
    stockService.listStockRecords = originalList;
    global.Page = originalPage;
    global.wx = originalWx;
    global.getApp = originalGetApp;
    delete require.cache[modulePath];
  }
}

async function testStockOperationSetsRefreshMarker() {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalDetail = productService.getProductDetail;
  const originalInbound = stockService.inboundStock;
  let pageConfig;
  const app = { globalData: {} };

  global.Page = (config) => {
    pageConfig = config;
  };
  global.getApp = () => app;
  global.wx = {
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 390 }),
    getMenuButtonBoundingClientRect: () => ({ width: 0, height: 0, left: 0 }),
    showToast() {},
    showModal() {},
    navigateBack() {},
    switchTab() {}
  };
  productService.getProductDetail = () => Promise.resolve(detailResponse());
  stockService.inboundStock = () => Promise.resolve({
    beforeStock: 20,
    afterStock: 30,
    delta: 10,
    stockVersion: 2,
    idempotent: false
  });

  const modulePath = require.resolve('../miniprogram/pages/stock-operation/stock-operation.js');
  delete require.cache[modulePath];
  require('../miniprogram/pages/stock-operation/stock-operation.js');

  try {
    const page = createPage(pageConfig);
    page.onLoad({
      mode: 'inbound',
      warehouseProductId: WAREHOUSE_PRODUCT_ID
    });
    await flushPromises();
    page.setData({ quantity: 10 });
    await page.submitMutation();
    assert.strictEqual(app.globalData.inventoryRefreshRequired, true);
    assert.deepStrictEqual(app.globalData.stockRecordsRefreshRequired, {
      warehouseProductId: WAREHOUSE_PRODUCT_ID
    });
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
  const recordsSource = fs.readFileSync(
    path.join(ROOT, 'miniprogram/pages/stock-records/stock-records.js'),
    'utf8'
  );
  assert.ok(recordsSource.includes('onShow()'));
  assert.ok(recordsSource.includes('onPullDownRefresh()'));
  assert.ok(recordsSource.includes('stockRecordsRefreshRequired'));
  assert.ok(recordsSource.includes("cursor: cursor || undefined"));
  assert.strictEqual(recordsSource.includes('wx.cloud'), false);
  assert.strictEqual(recordsSource.includes('.database('), false);

  const operationSource = fs.readFileSync(
    path.join(ROOT, 'miniprogram/pages/stock-operation/stock-operation.js'),
    'utf8'
  );
  assert.ok(operationSource.includes('stockRecordsRefreshRequired'));
  assert.strictEqual(operationSource.includes('requestKey: result'), false);

  const recordBackend = fs.readFileSync(
    path.join(ROOT, 'cloudfunctions/warehouse-api/modules/stock/record-service.js'),
    'utf8'
  );
  assert.ok(recordBackend.includes("orderBy('createdAt', 'desc')"));
  assert.ok(recordBackend.includes("orderBy('_id', 'desc')"));
  assert.strictEqual(recordBackend.includes('.remove('), false);

  const cleanupWorker = fs.readFileSync(
    path.join(ROOT, 'cloudfunctions/product-image-cleanup-worker/index.js'),
    'utf8'
  );
  assert.strictEqual(cleanupWorker.includes('stock_records'), false);

  const indexes = fs.readFileSync(path.join(ROOT, 'database/indexes.md'), 'utf8');
  assert.ok(indexes.includes('idx_records_wh_product_created'));
}

async function run() {
  await testInboundWriteAndRead();
  await testInitialWriteAndRead();
  await testAtomicityAndOtherMutationTypes();
  await testPermissionsAndIsolation();
  await testStockRecordsPageRefresh();
  await testStockOperationSetsRefreshMarker();
  testStaticBoundaries();
  console.log('stage2c4b1 tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
