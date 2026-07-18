const assert = require('assert');
const fs = require('fs');
const path = require('path');
const productService = require('../miniprogram/services/product-service.js');
const productView = require('../miniprogram/utils/product-view.js');

function createCloudItem(id, overrides = {}) {
  return Object.assign({
    id,
    productId: `product_${id}`,
    name: '工业扳手',
    productCode: 'TOOL-001',
    category: '工具',
    unit: '把',
    brand: '轻仓',
    specification: '12mm',
    cover: { type: 'text', text: '扳手', background: '#EAF6EF' },
    stock: 8,
    minStock: 5,
    stockStatus: 'normal',
    updatedAt: '2026-07-16T12:00:00.000Z'
  }, overrides);
}

function createDetailResponse(overrides = {}) {
  return Object.assign({
    product: {
      id: 'product_12345678',
      name: '工业扳手',
      productCode: 'TOOL-001',
      category: '工具',
      unit: '把',
      brand: '轻仓',
      specification: '12mm',
      description: '常用工业扳手',
      cover: { type: 'emoji', emoji: '🔧', background: '#EAF6EF' },
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T11:00:00.000Z'
    },
    warehouseProduct: {
      id: 'warehouse_product_12345678',
      productId: 'product_12345678',
      stock: 2,
      minStock: 2,
      stockStatus: 'low',
      stockVersion: 1,
      updatedAt: '2026-07-16T12:00:00.000Z'
    },
    permissions: { canEdit: true, canOperateStock: true, canRemove: true }
  }, overrides);
}

function applySetData(target, updates) {
  Object.keys(updates).forEach((key) => {
    if (!key.includes('.')) {
      target[key] = updates[key];
      return;
    }
    const parts = key.split('.');
    let cursor = target;
    parts.slice(0, -1).forEach((part) => { cursor = cursor[part]; });
    cursor[parts[parts.length - 1]] = updates[key];
  });
}

function createPage(config) {
  const page = Object.assign({}, config);
  page.data = JSON.parse(JSON.stringify(config.data));
  page.setData = function (updates, callback) {
    applySetData(this.data, updates);
    if (callback) callback();
  };
  return page;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function testViewHelpersAndServiceWhitelists() {
  const params = productView.buildListParams({
    keyword: '  扳手  ',
    selectedCategory: ' 工具 ',
    selectedStockStatus: 'LOW',
    teamId: 'forged',
    warehouseId: 'forged',
    role: 'owner'
  }, 'opaque_cursor_123');
  assert.deepStrictEqual(params, {
    pageSize: 20,
    sort: 'updated_desc',
    keyword: '扳手',
    category: '工具',
    stockStatus: 'low',
    cursor: 'opaque_cursor_123'
  });

  const listPayload = productService.buildListProductsPayload(Object.assign({}, params, {
    teamId: 'forged',
    warehouseId: 'forged',
    userId: 'forged',
    openId: 'forged',
    role: 'owner'
  }));
  ['teamId', 'warehouseId', 'userId', 'openId', 'role'].forEach((field) => {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(listPayload, field), false);
  });
  assert.deepStrictEqual(productService.buildProductDetailPayload({
    warehouseProductId: 'warehouse_product_12345678',
    teamId: 'forged'
  }), { warehouseProductId: 'warehouse_product_12345678' });

  const text = productView.mapInventoryItem(createCloudItem('warehouse_text_12345678'));
  const emoji = productView.mapInventoryItem(createCloudItem('warehouse_emoji_12345678', {
    cover: { type: 'emoji', emoji: '📦', background: '#F7F2E8' }
  }));
  const none = productView.mapInventoryItem(createCloudItem('warehouse_none_12345678', {
    cover: { type: 'none' }
  }));
  const unknown = productView.mapInventoryItem(createCloudItem('warehouse_unknown_12345678', {
    cover: { type: 'image', fileId: 'forbidden' },
    stock: 'bad',
    stockStatus: 'bad'
  }));
  const privateImage = productView.mapInventoryItem(createCloudItem('warehouse_image_12345678', {
    cover: {
      type: 'image',
      imageUrl: 'https://private.example/image',
      imageAvailable: true,
      imageUrlExpiresAt: '2026-07-18T01:00:00.000Z'
    }
  }));
  assert.strictEqual(text.cover.type, 'text');
  assert.strictEqual(text.cover.content, '扳手');
  assert.strictEqual(emoji.cover.type, 'emoji');
  assert.strictEqual(emoji.cover.content, '📦');
  assert.strictEqual(none.cover.type, 'none');
  assert.strictEqual(unknown.cover.type, 'image');
  assert.strictEqual(unknown.cover.imageUrl, '');
  assert.strictEqual(unknown.cover.fileId, undefined);
  assert.strictEqual(privateImage.cover.imageUrl, 'https://private.example/image');
  assert.strictEqual(unknown.stockText, '—');
  assert.strictEqual(unknown.stockStatus, 'unknown');

  const merged = productView.mergeInventoryItems([text], [
    Object.assign({}, text, { stock: 10, stockText: '10' }),
    emoji
  ]);
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged[0].stock, 10);
  assert.deepStrictEqual(productView.getLoadedSummary([
    text,
    Object.assign({}, emoji, { stockStatus: 'low' }),
    Object.assign({}, none, { stockStatus: 'out' })
  ]), { total: 3, lowCount: 1, outCount: 1 });

  assert.strictEqual(productView.getWarehouseProductId({
    warehouseProductId: 'warehouse_product_12345678'
  }), 'warehouse_product_12345678');
  assert.strictEqual(productView.getWarehouseProductId({ id: 'legacy_product_12345678' }), 'legacy_product_12345678');
  assert.strictEqual(productView.getWarehouseProductId({ id: '../bad' }), '');

  const detail = productView.mapProductDetail(createDetailResponse());
  assert.strictEqual(detail.product.cover.type, 'emoji');
  assert.strictEqual(detail.warehouseProduct.stockStatus, 'low');
  assert.strictEqual(detail.permissions.canEdit, true);
  assert.strictEqual(productView.getLoadErrorMessage({ code: 'INVALID_CURSOR' }), '列表状态已失效，请重新刷新');
  assert.strictEqual(productView.isContextInvalid({ code: 'NO_ACTIVE_TEAM' }), true);
}

async function testInventoryPage() {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalList = productService.listProducts;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let inventoryConfig;
  let listCalls = [];
  let pendingTimers = [];
  const navigation = [];
  const toasts = [];
  const app = {
    globalData: {
      bootstrapStatus: 'success',
      currentRole: 'owner',
      currentMembership: { role: 'owner' },
      currentTeam: { id: 'team_12345678' },
      currentWarehouse: { id: 'warehouse_12345678' }
    },
    bootstrap: () => Promise.resolve({
      membership: { role: app.globalData.currentRole },
      team: app.globalData.currentTeam,
      warehouse: app.globalData.currentWarehouse,
      onboardingRequired: false
    }),
    clearTeamContext: () => {}
  };

  global.Page = (config) => { inventoryConfig = config; };
  global.getApp = () => app;
  global.wx = {
    showToast: (options) => toasts.push(options.title),
    navigateTo: (options) => navigation.push(options.url),
    reLaunch: (options) => navigation.push(options.url),
    showActionSheet: () => {},
    stopPullDownRefresh: () => {}
  };
  const inventoryPath = require.resolve('../miniprogram/pages/inventory/inventory.js');
  delete require.cache[inventoryPath];
  require('../miniprogram/pages/inventory/inventory.js');

  try {
    const firstRequest = deferred();
    productService.listProducts = (params) => {
      listCalls.push(params);
      return firstRequest.promise;
    };
    const page = createPage(inventoryConfig);
    page.onLoad();
    page.onShow();
    await flushPromises();
    assert.strictEqual(page.data.loading, true);
    assert.strictEqual(listCalls.length, 1);
    assert.deepStrictEqual(listCalls[0], { pageSize: 20, sort: 'updated_desc' });
    firstRequest.resolve({ items: [], hasMore: false, nextCursor: null });
    await page.preparingPromise;
    assert.strictEqual(page.data.initialized, true);
    assert.strictEqual(page.data.items.length, 0);
    assert.strictEqual(page.data.loading, false);
    assert.strictEqual(page.data.canCreateProduct, true);

    productService.listProducts = () => Promise.reject({ code: 'CLOUD_CALL_FAILED' });
    await page.reloadInventory();
    assert.strictEqual(page.data.error, '网络连接失败，请检查网络后重试');
    productService.listProducts = () => Promise.resolve({ items: [], hasMore: false });
    await page.handleRetry();
    assert.strictEqual(page.data.error, '');
    assert.strictEqual(page.data.items.length, 0);

    listCalls = [];
    productService.listProducts = (params) => {
      listCalls.push(params);
      return Promise.resolve({
        items: [
          createCloudItem('warehouse_first_12345678'),
          createCloudItem('warehouse_second_12345678')
        ],
        hasMore: true,
        nextCursor: 'next_cursor_123'
      });
    };
    await page.reloadInventory();
    assert.strictEqual(page.data.items.length, 2);
    assert.strictEqual(page.data.hasMore, true);
    productService.listProducts = (params) => {
      listCalls.push(params);
      return Promise.resolve({
        items: [
          createCloudItem('warehouse_second_12345678', { stock: 9 }),
          createCloudItem('warehouse_third_12345678')
        ],
        hasMore: false,
        nextCursor: null
      });
    };
    await page.loadMore();
    assert.strictEqual(listCalls[listCalls.length - 1].cursor, 'next_cursor_123');
    assert.strictEqual(page.data.items.length, 3);
    assert.strictEqual(page.data.items[1].stock, 9);
    const callCount = listCalls.length;
    await page.loadMore();
    assert.strictEqual(listCalls.length, callCount);

    const oldRequest = deferred();
    const newRequest = deferred();
    let requestIndex = 0;
    productService.listProducts = () => {
      requestIndex += 1;
      return requestIndex === 1 ? oldRequest.promise : newRequest.promise;
    };
    page.data.keyword = '旧';
    const oldPromise = page.reloadInventory();
    page.data.keyword = '新';
    const newPromise = page.reloadInventory();
    newRequest.resolve({ items: [createCloudItem('warehouse_new_12345678', { name: '新产品' })], hasMore: false });
    await newPromise;
    oldRequest.resolve({ items: [createCloudItem('warehouse_old_12345678', { name: '旧产品' })], hasMore: false });
    await oldPromise;
    assert.strictEqual(page.data.items[0].name, '新产品');

    listCalls = [];
    productService.listProducts = (params) => {
      listCalls.push(params);
      return Promise.resolve({ items: [], hasMore: false });
    };
    page.onCategoryTap({ currentTarget: { dataset: { category: '工具' } } });
    await flushPromises();
    assert.strictEqual(listCalls[0].category, '工具');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(listCalls[0], 'cursor'), false);
    page.onStockStatusTap({ currentTarget: { dataset: { status: 'low' } } });
    await flushPromises();
    assert.strictEqual(listCalls[1].stockStatus, 'low');

    pendingTimers = [];
    global.setTimeout = (callback) => {
      pendingTimers.push(callback);
      return pendingTimers.length;
    };
    global.clearTimeout = () => {};
    const beforeSearch = listCalls.length;
    page.onSearchInput({ detail: { value: '扳手' } });
    assert.strictEqual(listCalls.length, beforeSearch);
    pendingTimers[0]();
    await flushPromises();
    assert.strictEqual(listCalls[listCalls.length - 1].keyword, '扳手');

    listCalls = [];
    productService.listProducts = (params) => {
      listCalls.push(params);
      return Promise.resolve({ items: [], hasMore: false });
    };
    page.data.nextCursor = 'must_be_reset';
    page.data.hasMore = true;
    await page.onPullDownRefresh();
    assert.strictEqual(Object.prototype.hasOwnProperty.call(listCalls[0], 'cursor'), false);

    page.data.items = [productView.mapInventoryItem(createCloudItem('warehouse_cursor_12345678'))];
    page.data.hasMore = true;
    page.data.nextCursor = 'expired_cursor';
    let cursorCalls = 0;
    productService.listProducts = (params) => {
      cursorCalls += 1;
      if (params.cursor) return Promise.reject({ code: 'INVALID_CURSOR' });
      return Promise.resolve({ items: [], hasMore: false });
    };
    await page.loadMore();
    assert.strictEqual(cursorCalls, 2);
    assert.ok(toasts.includes('列表状态已失效，正在重新加载'));

    listCalls = [];
    productService.listProducts = (params) => {
      listCalls.push(params);
      return Promise.resolve({ items: [], hasMore: false });
    };
    page.data.initialized = true;
    page.onAddTap();
    assert.strictEqual(page.awaitingCreateReturn, true);
    assert.ok(navigation.includes('/pages/product-edit/product-edit?mode=create'));
    page.onShow();
    await page.preparingPromise;
    assert.strictEqual(listCalls.length, 1);

    page.openProduct('warehouse_product_12345678');
    assert.ok(navigation.includes('/pages/product-detail/product-detail?warehouseProductId=warehouse_product_12345678'));

    app.globalData.currentRole = 'viewer';
    page.applyCurrentRole();
    assert.strictEqual(page.data.canCreateProduct, false);

    let bootstrapCalls = 0;
    let clearCalls = 0;
    app.clearTeamContext = () => { clearCalls += 1; };
    app.bootstrap = (options) => {
      bootstrapCalls += 1;
      assert.strictEqual(options.forceRefresh, true);
      return Promise.resolve({ onboardingRequired: true });
    };
    productService.listProducts = () => Promise.reject({ code: 'NO_ACTIVE_TEAM' });
    await page.reloadInventory();
    assert.strictEqual(clearCalls, 1);
    assert.strictEqual(bootstrapCalls, 1);
    assert.ok(navigation.includes('/pages/startup/startup'));
  } finally {
    productService.listProducts = originalList;
    global.Page = originalPage;
    global.wx = originalWx;
    global.getApp = originalGetApp;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    delete require.cache[require.resolve('../miniprogram/pages/inventory/inventory.js')];
  }
}

async function testDetailPage() {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalDetail = productService.getProductDetail;
  let detailConfig;
  const toasts = [];
  const navigation = [];
  let actionSheetTapIndex = 0;
  const app = {
    globalData: {},
    clearTeamContext: () => {},
    bootstrap: () => Promise.resolve({ onboardingRequired: false })
  };
  global.Page = (config) => { detailConfig = config; };
  global.getApp = () => app;
  global.wx = {
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 390 }),
    getMenuButtonBoundingClientRect: () => ({ width: 0, height: 0, left: 0 }),
    showToast: (options) => toasts.push(options.title),
    showActionSheet: (options) => options.success({ tapIndex: actionSheetTapIndex }),
    navigateTo: (options) => navigation.push(options.url),
    reLaunch: (options) => navigation.push(options.url),
    navigateBack: () => {},
    switchTab: (options) => navigation.push(options.url)
  };
  const detailPath = require.resolve('../miniprogram/pages/product-detail/product-detail.js');
  delete require.cache[detailPath];
  require('../miniprogram/pages/product-detail/product-detail.js');

  try {
    let calls = [];
    const request = deferred();
    productService.getProductDetail = (params) => {
      calls.push(params);
      return request.promise;
    };
    const page = createPage(detailConfig);
    page.onLoad({ warehouseProductId: 'warehouse_product_12345678' });
    assert.deepStrictEqual(calls[0], { warehouseProductId: 'warehouse_product_12345678' });
    assert.strictEqual(page.data.loading, true);
    request.resolve(createDetailResponse());
    await page.detailPromise;
    assert.strictEqual(page.data.product.name, '工业扳手');
    assert.strictEqual(page.data.warehouseProduct.stock, 2);
    assert.strictEqual(page.data.warehouseProduct.stockVersion, 1);
    assert.strictEqual(page.data.permissions.canOperateStock, true);
    assert.strictEqual(page.data.loaded, true);

    page.onInbound();
    page.onOutbound();
    page.onMore();
    actionSheetTapIndex = 1;
    page.onMore();
    assert.ok(navigation.includes('/pages/stock-operation/stock-operation?mode=inbound&warehouseProductId=warehouse_product_12345678'));
    assert.ok(navigation.includes('/pages/stock-operation/stock-operation?mode=outbound&warehouseProductId=warehouse_product_12345678'));
    assert.ok(navigation.includes('/pages/stock-operation/stock-operation?mode=adjustment&warehouseProductId=warehouse_product_12345678'));
    assert.ok(navigation.includes('/pages/product-edit/product-edit?mode=edit&warehouseProductId=warehouse_product_12345678'));

    calls = [];
    productService.getProductDetail = (params) => {
      calls.push(params);
      return Promise.resolve(createDetailResponse({
        permissions: { canEdit: false, canOperateStock: false, canRemove: false }
      }));
    };
    const viewerPage = createPage(detailConfig);
    viewerPage.onLoad({ id: 'warehouse_product_12345678' });
    await viewerPage.detailPromise;
    assert.strictEqual(viewerPage.data.permissions.canEdit, false);
    const toastCount = toasts.length;
    viewerPage.onInbound();
    assert.strictEqual(toasts.length, toastCount);

    const invalidPage = createPage(detailConfig);
    invalidPage.onLoad({ id: '../bad' });
    assert.strictEqual(invalidPage.data.canRetry, false);
    assert.strictEqual(calls.length, 1);

    let retryCalls = 0;
    productService.getProductDetail = () => {
      retryCalls += 1;
      return retryCalls === 1
        ? Promise.reject({ code: 'CLOUD_CALL_FAILED' })
        : Promise.resolve(createDetailResponse());
    };
    const retryPage = createPage(detailConfig);
    retryPage.onLoad({ warehouseProductId: 'warehouse_product_12345678' });
    await retryPage.detailPromise;
    assert.strictEqual(retryPage.data.error, '网络连接失败，请检查网络后重试');
    await retryPage.handleRetry();
    assert.strictEqual(retryPage.data.product.name, '工业扳手');
  } finally {
    productService.getProductDetail = originalDetail;
    global.Page = originalPage;
    global.wx = originalWx;
    global.getApp = originalGetApp;
    delete require.cache[require.resolve('../miniprogram/pages/product-detail/product-detail.js')];
  }
}

function testStaticBoundaries() {
  const root = path.resolve(__dirname, '..');
  const files = [
    'miniprogram/pages/inventory/inventory.js',
    'miniprogram/pages/inventory/inventory.wxml',
    'miniprogram/pages/product-detail/product-detail.js',
    'miniprogram/pages/product-detail/product-detail.wxml',
    'miniprogram/utils/product-view.js'
  ];
  const source = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.strictEqual(source.includes('mock-data'), false);
  assert.strictEqual(source.includes('stock-operation'), true);
  assert.strictEqual(source.includes('stockRecords'), false);
  assert.strictEqual(source.includes('wx.cloud'), false);
  assert.strictEqual(source.includes('.database('), false);
  assert.strictEqual(source.includes('setStorage'), false);
  assert.strictEqual(source.includes('setStorageSync'), false);
  assert.strictEqual(source.includes('console.log'), false);
  assert.strictEqual(source.includes('真实库存流水将在后续阶段接入'), true);
  assert.strictEqual(source.includes('已加载产品'), true);
  assert.strictEqual(source.includes('productService.listProducts'), true);
  assert.strictEqual(source.includes('productService.getProductDetail'), true);
}

async function run() {
  testViewHelpersAndServiceWhitelists();
  await testInventoryPage();
  await testDetailPage();
  testStaticBoundaries();
  console.log('stage2c2b2 tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
