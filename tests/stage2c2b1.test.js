const assert = require('assert');
const fs = require('fs');
const path = require('path');
const createUtils = require('../miniprogram/pages/product-edit/product-create-utils.js');
const productService = require('../miniprogram/services/product-service.js');

function createForm(overrides = {}) {
  return Object.assign({
    coverMode: 'text',
    displayText: '扳手',
    coverColor: '#EAF6EF',
    systemAssetEmoji: '',
    localImagePath: '',
    name: '  工业扳手  ',
    code: '  TOOL-001  ',
    category: '工具',
    unit: '其他',
    customUnit: ' 把 ',
    brand: ' 轻仓 ',
    specification: ' 12 mm ',
    description: ' 常用工具 ',
    keywords: '不得提交',
    stock: '8',
    minStock: '5',
    lowStockEnabled: true
  }, overrides);
}

function assertCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

function applySetData(target, updates) {
  Object.keys(updates).forEach((key) => {
    if (key.indexOf('.') === -1) {
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

function createPageHarness(pageConfig, overrides = {}) {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.data.form = createForm(overrides.form);
  page.data.currentStep = 3;
  page.data.accessChecking = false;
  page.data.accessDenied = false;
  page.pageActive = true;
  page.createCompleted = false;
  page.setData = function (updates, callback) {
    applySetData(this.data, updates);
    if (callback) callback();
  };
  return page;
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function testPayloadMappingAndValidation() {
  const payload = createUtils.buildCreateProductPayload(createForm());
  assert.deepStrictEqual(payload, {
    name: '工业扳手',
    productCode: 'TOOL-001',
    category: '工具',
    unit: '把',
    brand: '轻仓',
    specification: '12 mm',
    description: '常用工具',
    minStock: 5,
    initialStock: 8,
    coverType: 'text',
    coverText: '扳手',
    coverEmoji: '',
    coverBackground: '#EAF6EF'
  });

  const forbidden = [
    'teamId', 'warehouseId', 'userId', 'openId', 'role', 'createdBy', 'updatedBy',
    'stock', 'stockStatus', 'stockVersion', 'version', 'normalizedName',
    'normalizedCode', 'searchKeywords', 'productId', 'warehouseProductId', 'keywords'
  ];
  forbidden.forEach((field) => {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, field), false, field);
  });

  const emoji = createUtils.buildCreateProductPayload(createForm({
    coverMode: 'system',
    systemAssetEmoji: '📦'
  }));
  assert.strictEqual(emoji.coverType, 'emoji');
  assert.strictEqual(emoji.coverEmoji, '📦');
  assert.strictEqual(emoji.coverText, '');

  const noLowStock = createUtils.buildCreateProductPayload(createForm({
    lowStockEnabled: false,
    minStock: 'not-used'
  }));
  assert.strictEqual(noLowStock.minStock, 0);

  assertCode(() => createUtils.buildCreateProductPayload(createForm({
    coverMode: 'custom',
    localImagePath: 'wxfile://temporary.jpg'
  })), 'IMAGE_ASSET_NOT_READY');
  assertCode(() => createUtils.buildCreateProductPayload(createForm({ stock: '1.5' })), 'INVALID_STOCK_QUANTITY');
  assertCode(() => createUtils.buildCreateProductPayload(createForm({ stock: '-1' })), 'INVALID_STOCK_QUANTITY');
  assertCode(() => createUtils.buildCreateProductPayload(createForm({ stock: '9007199254740992' })), 'INVALID_STOCK_QUANTITY');
  assertCode(() => createUtils.buildCreateProductPayload(createForm({ minStock: 'NaN' })), 'INVALID_MIN_STOCK');
}

function testIntentAndResultRules() {
  const payload = createUtils.buildCreateProductPayload(createForm());
  const first = createUtils.resolveCreateIntent(payload, {}, () => 'product_first_12345678');
  assert.strictEqual(first.requestKey, 'product_first_12345678');

  const retry = createUtils.resolveCreateIntent(payload, {
    createRequestKey: first.requestKey,
    submittedPayloadHash: first.signature
  }, () => 'must_not_be_used');
  assert.strictEqual(retry.requestKey, first.requestKey);

  const changed = createUtils.resolveCreateIntent(Object.assign({}, payload, { name: '新产品' }), {
    createRequestKey: first.requestKey,
    submittedPayloadHash: first.signature
  }, () => 'product_changed_12345678');
  assert.strictEqual(changed.requestKey, 'product_changed_12345678');

  assert.strictEqual(createUtils.isCreateAllowed('owner'), true);
  assert.strictEqual(createUtils.isCreateAllowed('admin'), true);
  assert.strictEqual(createUtils.isCreateAllowed('viewer'), false);
  assert.strictEqual(
    createUtils.getCreateErrorMessage({ code: 'PRODUCT_LIMIT_REACHED' }),
    '团队产品数量已达到上限'
  );
  assert.doesNotThrow(() => createUtils.validateCreateResult({
    product: { id: 'product_12345678' },
    warehouseProduct: { id: 'warehouse_product_12345678' },
    initialRecord: null
  }, 0));
  assert.doesNotThrow(() => createUtils.validateCreateResult({
    product: { id: 'product_12345678' },
    warehouseProduct: { id: 'warehouse_product_12345678' },
    initialRecord: { id: 'record_12345678' }
  }, 1));
  assertCode(() => createUtils.validateCreateResult({
    product: { id: 'product_12345678' },
    warehouseProduct: { id: 'warehouse_product_12345678' },
    initialRecord: null
  }, 1), 'INVALID_CREATE_RESPONSE');
}

async function testPageSaveFlow() {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalCreateProduct = productService.createProduct;
  let pageConfig;
  let role = 'owner';
  const switched = [];
  const toasts = [];

  global.Page = (config) => { pageConfig = config; };
  global.getApp = () => ({
    globalData: { currentRole: role, bootstrapStatus: 'success' },
    bootstrap: () => Promise.resolve()
  });
  global.wx = {
    showToast: (options) => toasts.push(options.title),
    switchTab: (options) => switched.push(options.url),
    reLaunch: () => {},
    navigateBack: () => {}
  };

  const pagePath = require.resolve('../miniprogram/pages/product-edit/product-edit.js');
  delete require.cache[pagePath];
  require('../miniprogram/pages/product-edit/product-edit.js');

  try {
    let resolveCreate;
    let calls = [];
    productService.createProduct = (payload) => {
      calls.push(payload);
      return new Promise((resolve) => { resolveCreate = resolve; });
    };
    const page = createPageHarness(pageConfig);
    page.onComplete();
    page.onComplete();
    await flushPromises();
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(page.data.saving, true);
    assert.ok(calls[0].requestKey);
    resolveCreate({
      product: { id: 'product_12345678' },
      warehouseProduct: { id: 'warehouse_product_12345678' },
      initialRecord: { id: 'record_12345678' }
    });
    await flushPromises();
    assert.strictEqual(page.data.saving, false);
    assert.strictEqual(page.data.createRequestKey, '');
    assert.strictEqual(page.data.submittedPayloadHash, '');
    assert.strictEqual(page.data.createdProduct.id, 'product_12345678');
    assert.ok(toasts.includes('产品创建成功'));
    assert.ok(switched.includes('/pages/inventory/inventory'));

    calls = [];
    productService.createProduct = (payload) => {
      calls.push(payload);
      return calls.length === 1
        ? Promise.reject({ code: 'CLOUD_CALL_FAILED' })
        : Promise.reject({ code: 'REQUEST_KEY_CONFLICT' });
    };
    const retryPage = createPageHarness(pageConfig);
    retryPage.onComplete();
    await flushPromises();
    const retainedKey = retryPage.data.createRequestKey;
    assert.ok(retainedKey);
    retryPage.onComplete();
    await flushPromises();
    assert.strictEqual(calls[0].requestKey, calls[1].requestKey);
    assert.strictEqual(retryPage.data.createRequestKey, '');
    assert.strictEqual(retryPage.data.submittedPayloadHash, '');
    assert.ok(toasts.includes('网络连接失败，请检查网络后重试'));
    assert.ok(toasts.includes('表单内容已经变化，请重新提交'));

    calls = [];
    role = 'viewer';
    productService.createProduct = (payload) => {
      calls.push(payload);
      return Promise.resolve(payload);
    };
    const viewerPage = createPageHarness(pageConfig);
    viewerPage.onComplete();
    assert.strictEqual(calls.length, 0);
    assert.ok(toasts.includes('你没有创建产品的权限'));
  } finally {
    productService.createProduct = originalCreateProduct;
    global.Page = originalPage;
    global.wx = originalWx;
    global.getApp = originalGetApp;
    delete require.cache[require.resolve('../miniprogram/pages/product-edit/product-edit.js')];
  }
}

function testStaticBoundaries() {
  const root = path.resolve(__dirname, '..');
  const pageSource = fs.readFileSync(
    path.join(root, 'miniprogram/pages/product-edit/product-edit.js'),
    'utf8'
  );
  const helperSource = fs.readFileSync(
    path.join(root, 'miniprogram/pages/product-edit/product-create-utils.js'),
    'utf8'
  );
  const inventorySource = fs.readFileSync(
    path.join(root, 'miniprogram/pages/inventory/inventory.wxml'),
    'utf8'
  );
  const combined = `${pageSource}\n${helperSource}`;
  assert.strictEqual(pageSource.includes('productService.createProduct(payload)'), true);
  assert.strictEqual(pageSource.includes("wx.switchTab({ url: ROUTES.INVENTORY })"), true);
  assert.strictEqual(pageSource.includes('产品保存功能将在后续阶段接入'), false);
  assert.strictEqual(combined.includes('wx.cloud'), false);
  assert.strictEqual(combined.includes('.database('), false);
  assert.strictEqual(combined.includes('setStorage'), false);
  assert.strictEqual(combined.includes('setStorageSync'), false);
  assert.strictEqual(combined.includes('console.log'), false);
  assert.strictEqual(combined.includes('console.info'), false);
  assert.strictEqual(combined.includes('console.error'), false);
  assert.strictEqual(inventorySource.includes('wx:if="{{canCreateProduct}}"'), true);
}

async function run() {
  testPayloadMappingAndValidation();
  testIntentAndResultRules();
  await testPageSaveFlow();
  testStaticBoundaries();
  console.log('stage2c2b1 tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
