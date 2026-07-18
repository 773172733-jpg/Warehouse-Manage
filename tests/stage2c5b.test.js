const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ERROR_CODES } = require('../cloudfunctions/warehouse-api/common/errors.js');
const {
  createMembershipId,
  createWarehouseProductId
} = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const {
  buildSearchKeywords,
  computeStockStatus,
  validateProductListInput
} = require('../cloudfunctions/warehouse-api/common/product-utils.js');
const {
  listProducts,
  updateProduct
} = require('../cloudfunctions/warehouse-api/modules/product/product-service.js');
const productService = require('../miniprogram/services/product-service.js');

const TEAM_ID = 'team_alert_12345678';
const OTHER_TEAM_ID = 'team_alert_other_123';
const WAREHOUSE_ID = 'warehouse_alert_123';
const OTHER_WAREHOUSE_ID = 'warehouse_alert_other';
const USER_ID = 'user_alert_12345678';

function operation(type, value) {
  return {
    __operation: type,
    value,
    and(other) {
      return { __operation: 'and', operations: [this, other] };
    }
  };
}

function comparable(value) {
  return value instanceof Date ? value.getTime() : value;
}

function matchesValue(actual, expected) {
  if (expected && expected.__operation === 'and') {
    return expected.operations.every((item) => matchesValue(actual, item));
  }
  if (expected && expected.__operation === 'in') return expected.value.includes(actual);
  if (expected && expected.__operation === 'lt') {
    return comparable(actual) < comparable(expected.value);
  }
  if (expected && expected.__operation === 'gte') {
    return comparable(actual) >= comparable(expected.value);
  }
  if (expected && expected.__operation === 'eq') {
    return comparable(actual) === comparable(expected.value);
  }
  if (Array.isArray(actual)) return actual.includes(expected);
  return comparable(actual) === comparable(expected);
}

function matchesWhere(document, where) {
  if (where && where.__operation === 'or') {
    return where.branches.some((branch) => matchesWhere(document, branch));
  }
  return Object.keys(where || {}).every((field) => matchesValue(document[field], where[field]));
}

function createProduct(id, name, code, overrides = {}) {
  const source = Object.assign({
    _id: id,
    teamId: TEAM_ID,
    status: 'active',
    name,
    productCode: code,
    category: '工具',
    unit: '个',
    brand: '口袋',
    specification: '',
    description: '',
    coverType: 'text',
    coverText: Array.from(name)[0],
    coverEmoji: '',
    coverAssetKey: '',
    coverFileId: '',
    coverBackground: '#EAF6EF',
    version: 1,
    activeWarehouseCount: 1
  }, overrides);
  source.normalizedName = source.name.toLowerCase();
  source.normalizedCode = source.productCode.toLowerCase();
  source.searchKeywords = buildSearchKeywords(source);
  return source;
}

function createWarehouseProduct(product, stock, minStock, updatedAt, overrides = {}) {
  return Object.assign({
    _id: createWarehouseProductId(product.teamId, WAREHOUSE_ID, product._id),
    teamId: product.teamId,
    warehouseId: WAREHOUSE_ID,
    productId: product._id,
    status: 'active',
    stock,
    minStock,
    stockStatus: computeStockStatus(stock, minStock),
    stockVersion: 4,
    productVersion: product.version,
    productNameSnapshot: product.name,
    normalizedNameSnapshot: product.normalizedName,
    productCodeSnapshot: product.productCode,
    normalizedCodeSnapshot: product.normalizedCode,
    categorySnapshot: product.category,
    unitSnapshot: product.unit,
    brandSnapshot: product.brand,
    specificationSnapshot: product.specification,
    searchKeywordsSnapshot: product.searchKeywords.slice(),
    coverSummarySnapshot: {
      type: 'text',
      text: Array.from(product.name)[0],
      background: '#EAF6EF'
    },
    updatedAt
  }, overrides);
}

function createFixture(role = 'owner', membershipStatus = 'active') {
  const lowModel = createProduct('product_alert_low_001', 'RA1809100', 'RA-180-9100');
  const lowLimit = createProduct('product_alert_low_002', '低库存工具', 'LOW-002');
  const out = createProduct('product_alert_out_001', '缺货工具', 'OUT-001');
  const normal = createProduct('product_alert_normal1', '正常工具', 'NORMAL-1');
  const removed = createProduct('product_alert_removed', '已移出工具', 'REMOVED-1', {
    activeWarehouseCount: 0
  });
  const deleted = createProduct('product_alert_deleted', '已删除工具', 'DELETED-1', {
    status: 'deleted',
    activeWarehouseCount: 0
  });
  const foreign = createProduct('product_alert_foreign', '其他团队低库存', 'FOREIGN-1', {
    teamId: OTHER_TEAM_ID
  });
  const products = [lowModel, lowLimit, out, normal, removed, deleted, foreign];
  const baseTime = Date.UTC(2026, 6, 18, 12, 0, 0);
  const warehouseProducts = [
    createWarehouseProduct(lowModel, 3, 5, new Date(baseTime + 6000)),
    createWarehouseProduct(lowLimit, 5, 5, new Date(baseTime + 5000)),
    createWarehouseProduct(out, 0, 0, new Date(baseTime + 4000)),
    createWarehouseProduct(normal, 6, 5, new Date(baseTime + 3000)),
    createWarehouseProduct(removed, 0, 1, new Date(baseTime + 2000), {
      status: 'removed'
    }),
    createWarehouseProduct(deleted, 0, 1, new Date(baseTime + 1000), {
      status: 'removed'
    }),
    createWarehouseProduct(lowModel, 1, 5, new Date(baseTime), {
      _id: 'warehouse_product_other_wh',
      warehouseId: OTHER_WAREHOUSE_ID
    }),
    createWarehouseProduct(foreign, 1, 5, new Date(baseTime - 1000), {
      _id: 'warehouse_product_foreign',
      teamId: OTHER_TEAM_ID
    })
  ];
  const membershipId = createMembershipId(TEAM_ID, USER_ID);
  const documents = {
    users: new Map([[USER_ID, {
      _id: USER_ID,
      status: 'active',
      displayName: '预警测试用户',
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
      status: membershipStatus
    }]]),
    warehouses: new Map([
      [WAREHOUSE_ID, { _id: WAREHOUSE_ID, teamId: TEAM_ID, status: 'active' }],
      [OTHER_WAREHOUSE_ID, {
        _id: OTHER_WAREHOUSE_ID,
        teamId: TEAM_ID,
        status: 'active'
      }]
    ]),
    products: new Map(products.map((item) => [item._id, item])),
    warehouse_products: new Map(warehouseProducts.map((item) => [item._id, item])),
    product_image_assets: new Map(),
    stock_records: new Map()
  };
  const queryCalls = [];
  const command = {
    gte: (value) => operation('gte', value),
    lt: (value) => operation('lt', value),
    eq: (value) => operation('eq', value),
    in: (value) => operation('in', value),
    or: (branches) => ({ __operation: 'or', branches })
  };

  function source() {
    return {
      collection(name) {
        const store = documents[name];
        assert.ok(store, 'unknown collection ' + name);
        return {
          doc(id) {
            return {
              async get() {
                return { data: store.get(id) || null };
              },
              async update({ data }) {
                const current = store.get(id);
                assert.ok(current, 'missing ' + name + '/' + id);
                store.set(id, Object.assign({}, current, data));
              }
            };
          },
          where(where) {
            const query = {
              collection: name,
              where,
              orders: [],
              limit: Number.MAX_SAFE_INTEGER
            };
            const api = {
              orderBy(field, direction) {
                query.orders.push({ field, direction });
                return api;
              },
              limit(value) {
                query.limit = value;
                return api;
              },
              field() {
                return api;
              },
              async count() {
                queryCalls.push(Object.assign({ operation: 'count' }, query));
                return {
                  total: Array.from(store.values())
                    .filter((item) => matchesWhere(item, where))
                    .length
                };
              },
              async get() {
                queryCalls.push(Object.assign({ operation: 'get' }, query));
                let rows = Array.from(store.values())
                  .filter((item) => matchesWhere(item, where));
                rows.sort((left, right) => {
                  for (const order of query.orders) {
                    const leftValue = comparable(left[order.field]);
                    const rightValue = comparable(right[order.field]);
                    if (leftValue === rightValue) continue;
                    const comparison = leftValue < rightValue ? -1 : 1;
                    return order.direction === 'desc' ? -comparison : comparison;
                  }
                  return 0;
                });
                rows = rows.slice(0, query.limit);
                return { data: rows };
              }
            };
            return api;
          }
        };
      }
    };
  }

  const db = source();
  db.command = command;
  db.serverDate = () => new Date(Date.UTC(2026, 6, 18, 13, 0, 0));
  db.runTransaction = async (callback) => callback(source());
  return {
    db,
    user: documents.users.get(USER_ID),
    membership: documents.team_members.get(membershipId),
    documents,
    queryCalls,
    ids: {
      lowModel: createWarehouseProductId(TEAM_ID, WAREHOUSE_ID, lowModel._id)
    }
  };
}

async function expectCode(callback, code) {
  await assert.rejects(callback, (error) => error && error.code === code);
}

function applySetData(target, updates) {
  Object.keys(updates).forEach((key) => {
    if (!key.includes('.')) {
      target[key] = updates[key];
      return;
    }
    const parts = key.split('.');
    let cursor = target;
    parts.slice(0, -1).forEach((part) => {
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

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function testRulesAndValidation() {
  assert.strictEqual(computeStockStatus(0, 0), 'out');
  assert.strictEqual(computeStockStatus(0, 5), 'out');
  assert.strictEqual(computeStockStatus(1, 5), 'low');
  assert.strictEqual(computeStockStatus(5, 5), 'low');
  assert.strictEqual(computeStockStatus(6, 5), 'normal');
  assert.strictEqual(computeStockStatus(1, 0), 'normal');
  const input = validateProductListInput({
    keyword: ' RA-180 ',
    category: '工具',
    stockStatus: 'low',
    includeSummary: true
  });
  assert.strictEqual(input.searchToken, 'ra180');
  assert.strictEqual(input.stockStatus, 'low');
  assert.strictEqual(input.includeSummary, true);
  assert.throws(
    () => validateProductListInput({ stockStatus: 'forged' }),
    (error) => error.code === ERROR_CODES.INVALID_ALERT_TYPE
  );
  assert.throws(
    () => validateProductListInput({ includeSummary: 'yes' }),
    (error) => error.code === ERROR_CODES.INVALID_INPUT
  );
}

async function testListSummarySearchPaginationAndScope() {
  for (const role of ['owner', 'admin', 'viewer']) {
    const fixture = createFixture(role);
    const low = await listProducts(fixture.db, fixture.user, {
      stockStatus: 'low',
      pageSize: 20,
      includeSummary: true
    }, {});
    assert.strictEqual(low.items.length, 2);
    assert.deepStrictEqual(low.summary, { total: 4, lowCount: 2, outCount: 1 });
    assert.ok(low.items.every((item) => item.stock > 0 && item.stock <= item.minStock));
    assert.strictEqual(JSON.stringify(low).includes('fileId'), false);
    assert.strictEqual(low.items.some((item) => item.id === 'warehouse_product_other_wh'), false);
    assert.strictEqual(low.items.some((item) => item.id === 'warehouse_product_foreign'), false);
  }

  const fixture = createFixture();
  const out = await listProducts(fixture.db, fixture.user, {
    stockStatus: 'out',
    pageSize: 20
  }, {});
  assert.strictEqual(out.items.length, 1);
  assert.strictEqual(out.items[0].stock, 0);
  assert.strictEqual(out.items[0].minStock, 0);

  const search = await listProducts(fixture.db, fixture.user, {
    stockStatus: 'low',
    keyword: '180',
    category: '工具',
    pageSize: 20
  }, {});
  assert.strictEqual(search.items.length, 1);
  assert.strictEqual(search.items[0].name, 'RA1809100');
  const separated = await listProducts(fixture.db, fixture.user, {
    stockStatus: 'low',
    keyword: 'ra 180',
    pageSize: 20
  }, {});
  assert.strictEqual(separated.items.length, 1);

  const first = await listProducts(fixture.db, fixture.user, {
    stockStatus: 'low',
    pageSize: 1
  }, {});
  const second = await listProducts(fixture.db, fixture.user, {
    stockStatus: 'low',
    pageSize: 1,
    cursor: first.nextCursor
  }, {});
  assert.strictEqual(first.items.length, 1);
  assert.strictEqual(second.items.length, 1);
  assert.notStrictEqual(first.items[0].id, second.items[0].id);
  await expectCode(() => listProducts(fixture.db, fixture.user, {
    stockStatus: 'out',
    pageSize: 1,
    cursor: first.nextCursor
  }, {}), ERROR_CODES.INVALID_CURSOR);

  const countQueries = fixture.queryCalls.filter((query) => {
    return query.collection === 'warehouse_products' && query.operation === 'count';
  });
  assert.ok(countQueries.every((query) => {
    return query.where.teamId === TEAM_ID &&
      query.where.warehouseId === WAREHOUSE_ID &&
      query.where.status === 'active';
  }));
  const productQueries = fixture.queryCalls.filter((query) => query.collection === 'products');
  assert.ok(productQueries.length > 0);
  assert.ok(productQueries.every((query) => query.where._id.__operation === 'in'));
}

async function testMembershipAndMinStockUpdate() {
  for (const status of ['pending', 'removed']) {
    const fixture = createFixture('viewer', status);
    await expectCode(
      () => listProducts(fixture.db, fixture.user, { stockStatus: 'low' }, {}),
      ERROR_CODES.FORBIDDEN
    );
  }
  const fixture = createFixture('admin');
  const warehouseBefore = fixture.documents.warehouse_products.get(fixture.ids.lowModel);
  const stockBefore = warehouseBefore.stock;
  const stockVersionBefore = warehouseBefore.stockVersion;
  const recordCountBefore = fixture.documents.stock_records.size;
  const product = fixture.documents.products.get(warehouseBefore.productId);
  const result = await updateProduct(fixture.db, fixture.user, {
    productId: product._id,
    expectedVersion: product.version,
    name: product.name,
    productCode: product.productCode,
    category: product.category,
    unit: product.unit,
    brand: product.brand,
    specification: product.specification,
    description: product.description,
    minStock: 2,
    requestKey: 'alert_min_stock_update_123'
  }, {});
  const warehouseAfter = fixture.documents.warehouse_products.get(fixture.ids.lowModel);
  assert.strictEqual(result.warehouseProduct.minStock, 2);
  assert.strictEqual(warehouseAfter.stockStatus, 'normal');
  assert.strictEqual(warehouseAfter.stock, stockBefore);
  assert.strictEqual(warehouseAfter.stockVersion, stockVersionBefore);
  assert.strictEqual(fixture.documents.stock_records.size, recordCountBefore);

  const viewer = createFixture('viewer');
  const viewerProduct = viewer.documents.products.get('product_alert_low_001');
  await expectCode(() => updateProduct(viewer.db, viewer.user, {
    productId: viewerProduct._id,
    expectedVersion: viewerProduct.version,
    name: viewerProduct.name,
    productCode: viewerProduct.productCode,
    category: viewerProduct.category,
    unit: viewerProduct.unit,
    brand: viewerProduct.brand,
    specification: '',
    description: '',
    minStock: 1,
    requestKey: 'viewer_min_stock_update_1'
  }, {}), ERROR_CODES.FORBIDDEN);
}

async function testAlertPage() {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalList = productService.listProducts;
  let config;
  const calls = [];
  const navigation = [];
  const app = {
    globalData: {
      bootstrapStatus: 'success',
      currentRole: 'owner',
      currentMembership: { role: 'owner' },
      currentTeam: { id: TEAM_ID },
      currentWarehouse: { id: WAREHOUSE_ID, name: '主仓库' },
      stockAlertsRefreshRequired: false
    },
    bootstrap: () => Promise.resolve({
      membership: app.globalData.currentMembership,
      team: app.globalData.currentTeam,
      warehouse: app.globalData.currentWarehouse,
      onboardingRequired: false
    }),
    clearTeamContext: () => {}
  };
  global.Page = (pageConfig) => {
    config = pageConfig;
  };
  global.getApp = () => app;
  global.wx = {
    navigateTo: (options) => navigation.push(options.url),
    reLaunch: (options) => navigation.push(options.url),
    showToast: () => {},
    stopPullDownRefresh: () => {}
  };
  const modulePath = require.resolve('../miniprogram/pages/stock-alerts/stock-alerts.js');
  delete require.cache[modulePath];
  require(modulePath);
  try {
    productService.listProducts = (params) => {
      calls.push(params);
      return Promise.resolve({
        items: [{
          id: 'warehouse_alert_page_001',
          productId: 'product_alert_page_001',
          name: 'RA1809100',
          productCode: 'RA-180-9100',
          category: '工具',
          unit: '个',
          cover: { type: 'text', text: 'RA', background: '#EAF6EF' },
          stock: 0,
          minStock: 0,
          stockStatus: 'out',
          stockVersion: 2,
          updatedAt: '2026-07-18T12:00:00.000Z'
        }],
        hasMore: false,
        nextCursor: null,
        summary: { total: 4, lowCount: 2, outCount: 1 }
      });
    };
    const page = createPage(config);
    page.onLoad({ alertType: 'out' });
    page.onShow();
    await page.preparingPromise;
    assert.strictEqual(calls[0].stockStatus, 'out');
    assert.strictEqual(calls[0].includeSummary, true);
    ['teamId', 'warehouseId', 'userId', 'role', 'stock'].forEach((field) => {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(calls[0], field), false);
    });
    assert.strictEqual(page.data.overviewCount, 1);
    assert.strictEqual(page.data.items[0].replenishmentText, '最低库存未设置，请手动评估');
    assert.strictEqual(page.data.canOperateStock, true);

    page.onInboundTap({
      currentTarget: { dataset: { warehouseProductId: 'warehouse_alert_page_001' } }
    });
    assert.ok(navigation.some((url) => url.includes('mode=inbound')));

    app.globalData.currentRole = 'viewer';
    page.applyCurrentContext();
    assert.strictEqual(page.data.canOperateStock, false);
    const navigationCount = navigation.length;
    page.onInboundTap({
      currentTarget: { dataset: { warehouseProductId: 'warehouse_alert_page_001' } }
    });
    assert.strictEqual(navigation.length, navigationCount);

    page.onAlertTypeTap({ currentTarget: { dataset: { alertType: 'low' } } });
    await flushPromises();
    assert.strictEqual(calls[calls.length - 1].stockStatus, 'low');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(
      calls[calls.length - 1],
      'cursor'
    ), false);

    const callCount = calls.length;
    app.globalData.stockAlertsRefreshRequired = true;
    page.onShow();
    await page.preparingPromise;
    assert.strictEqual(app.globalData.stockAlertsRefreshRequired, false);
    assert.strictEqual(calls.length, callCount + 1);
    page.onUnload();
  } finally {
    productService.listProducts = originalList;
    global.Page = originalPage;
    global.wx = originalWx;
    global.getApp = originalGetApp;
    delete require.cache[modulePath];
  }
}

function testStaticBoundaries() {
  const root = path.resolve(__dirname, '..');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const alertJs = read('miniprogram/pages/stock-alerts/stock-alerts.js');
  const alertWxml = read('miniprogram/pages/stock-alerts/stock-alerts.wxml');
  const inventory = read('miniprogram/pages/inventory/inventory.js');
  const inventoryWxml = read('miniprogram/pages/inventory/inventory.wxml');
  const service = read('cloudfunctions/warehouse-api/modules/product/product-service.js');
  const stockService = read('cloudfunctions/warehouse-api/modules/stock/stock-service.js');
  const indexes = read('database/indexes.md');
  const appConfig = JSON.parse(read('miniprogram/app.json'));

  assert.ok(appConfig.pages.includes('pages/stock-alerts/stock-alerts'));
  assert.ok(inventory.includes('ROUTES.STOCK_ALERTS'));
  assert.ok(inventoryWxml.includes('onAlertSummaryTap'));
  assert.ok(alertJs.includes('productService.listProducts'));
  assert.ok(alertJs.includes('SEARCH_DEBOUNCE_MS'));
  assert.ok(alertWxml.includes('wx:if="{{canOperateStock}}"'));
  assert.ok(alertWxml.includes('搜索商品名称、型号或编号'));
  assert.strictEqual(alertJs.includes('wx.cloud'), false);
  assert.strictEqual(alertJs.includes('.database('), false);
  assert.strictEqual(alertJs.includes('setStorage'), false);
  assert.strictEqual(alertJs.includes('mock'), false);
  assert.strictEqual(alertJs.includes('stock_records'), false);
  assert.ok(service.includes('.count()'));
  assert.ok(service.includes('db.command.in(productIds)'));
  assert.ok(service.includes('computeStockStatus(warehouseProduct.stock, nextMinStock)'));
  assert.ok(stockService.includes('computeStockStatus(mutation.afterStock'));
  assert.ok(indexes.includes('idx_wh_products_stock_status'));
  assert.ok(indexes.includes('idx_wh_products_category_stock_keyword'));
  assert.strictEqual(service.includes('stock.alerts.list'), false);
}

async function run() {
  testRulesAndValidation();
  await testListSummarySearchPaginationAndScope();
  await testMembershipAndMinStockUpdate();
  await testAlertPage();
  testStaticBoundaries();
  console.log('stage2c5b tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
