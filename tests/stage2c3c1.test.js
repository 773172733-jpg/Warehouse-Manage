const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ERROR_CODES, ApiError } = require('../cloudfunctions/warehouse-api/common/errors.js');
const { createMembershipId } = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const {
  MAX_IMAGE_BYTES,
  inspectImageBuffer,
  validateCloudFileId
} = require('../cloudfunctions/warehouse-api/common/product-image-utils.js');
const {
  prepareProductImage,
  confirmProductImage
} = require('../cloudfunctions/warehouse-api/modules/product/image-service.js');
const {
  createProduct,
  updateProduct
} = require('../cloudfunctions/warehouse-api/modules/product/product-service.js');
const productImageService = require('../miniprogram/services/product-image-service.js');
const editUtils = require('../miniprogram/pages/product-edit/product-create-utils.js');
const clientProductService = require('../miniprogram/services/product-service.js');

const TEAM_ID = 'team_12345678';
const USER_ID = 'user_12345678';
const WAREHOUSE_ID = 'warehouse_12345678';
const ENV_ID = 'cloud1-d8gm59cz2be4e7c23';

function expectCode(callback, code) {
  assert.throws(callback, (error) => error instanceof ApiError && error.code === code);
}

async function expectAsyncCode(callback, code) {
  await assert.rejects(callback, (error) => error && error.code === code);
}

function createPng() {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(1, 8);
  ihdr.writeUInt32BE(1, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  const iend = Buffer.alloc(12);
  iend.writeUInt32BE(0, 0);
  iend.write('IEND', 4, 'ascii');
  return Buffer.concat([signature, ihdr, iend]);
}

function createWebp() {
  const buffer = Buffer.alloc(16);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(8, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8 ', 12, 'ascii');
  return buffer;
}

function cloneDocuments(documents) {
  return Object.keys(documents).reduce((result, name) => {
    result[name] = new Map(Array.from(documents[name].entries()).map(([id, value]) => [id, structuredClone(value)]));
    return result;
  }, {});
}

function replaceDocuments(target, source) {
  Object.keys(target).forEach((name) => {
    target[name].clear();
    source[name].forEach((value, id) => target[name].set(id, value));
  });
}

function matches(document, where) {
  return Object.keys(where || {}).every((key) => document[key] === where[key]);
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
    product_image_assets: new Map(),
    warehouse_products: new Map(),
    stock_records: new Map()
  };
  let failure = null;
  let clock = 0;

  function createSource(store, transactional) {
    return {
      collection(name) {
        const collection = store[name];
        assert.ok(collection, `unknown collection ${name}`);
        let query = {};
        let limit = Infinity;
        const api = {
          doc(id) {
            return {
              async get() { return { data: collection.get(id) || null }; },
              async set({ data }) {
                if (failure && failure({ name, id, operation: 'set', transactional })) throw new Error('injected failure');
                if (Object.prototype.hasOwnProperty.call(data, '_id')) {
                  throw new Error('CloudBase set cannot update _id');
                }
                collection.set(id, Object.assign({ _id: id }, data));
              },
              async update({ data }) {
                if (failure && failure({ name, id, operation: 'update', transactional })) throw new Error('injected failure');
                const current = collection.get(id);
                assert.ok(current, `missing ${name}/${id}`);
                collection.set(id, Object.assign({}, current, data));
              }
            };
          },
          where(value) { query = value; return api; },
          limit(value) { limit = value; return api; },
          async get() {
            return { data: Array.from(collection.values()).filter((item) => matches(item, query)).slice(0, limit) };
          }
        };
        return api;
      }
    };
  }

  const db = createSource(documents, false);
  db.serverDate = () => new Date(Date.UTC(2026, 6, 17, 0, 0, clock++));
  db.runTransaction = async (callback) => {
    const staged = cloneDocuments(documents);
    const result = await callback(createSource(staged, true));
    replaceDocuments(documents, staged);
    return result;
  };
  return {
    db,
    documents,
    user: documents.users.get(USER_ID),
    setFailure(predicate) { failure = predicate; },
    clearFailure() { failure = null; }
  };
}

function createCloud() {
  const files = new Map();
  let tempUrlCalls = 0;
  return {
    files,
    get tempUrlCalls() {
      return tempUrlCalls;
    },
    async downloadFile({ fileID }) {
      if (!files.has(fileID)) throw new Error('missing file');
      return { fileContent: files.get(fileID) };
    },
    async uploadFile({ cloudPath, fileContent }) {
      const fileID = `cloud://${ENV_ID}.bucket/${cloudPath}`;
      files.set(fileID, Buffer.from(fileContent));
      return { fileID };
    },
    async getTempFileURL({ fileList }) {
      tempUrlCalls += 1;
      return {
        fileList: fileList.map((item, index) => ({
          fileID: item.fileID,
          tempFileURL: files.has(item.fileID) ? `https://private.example/image-${index}` : '',
          maxAge: item.maxAge,
          status: files.has(item.fileID) ? 0 : -1,
          errMsg: files.has(item.fileID) ? 'ok' : 'missing'
        }))
      };
    }
  };
}

function createProductInput(assetKey, requestKey = 'create_image_product_123456') {
  return {
    name: '图片产品',
    productCode: 'IMG-001',
    category: '其他',
    unit: '个',
    brand: '',
    specification: '',
    description: '',
    coverType: 'image',
    coverAssetKey: assetKey,
    minStock: 1,
    initialStock: 2,
    requestKey
  };
}

function createUpdateInput(product, cover, requestKey) {
  return Object.assign({
    productId: product._id,
    expectedVersion: product.version,
    name: product.name,
    productCode: product.productCode,
    category: product.category,
    unit: product.unit,
    brand: product.brand,
    specification: product.specification,
    description: product.description,
    requestKey
  }, cover);
}

async function stageAsset(fixture, cloud, extension, buffer, suffix) {
  const prepared = await prepareProductImage(fixture.db, fixture.user, {
    extension,
    sizeBytes: buffer.length,
    requestKey: `prepare_${suffix}_12345678`
  });
  const sourceFileId = `cloud://${ENV_ID}.bucket/${prepared.cloudPath}`;
  cloud.files.set(sourceFileId, buffer);
  const confirmed = await confirmProductImage(fixture.db, fixture.user, {
    assetKey: prepared.assetKey,
    fileId: sourceFileId,
    requestKey: `confirm_${suffix}_12345678`
  }, { cloud, envId: ENV_ID });
  assert.strictEqual(confirmed.status, 'staged');
  return prepared.assetKey;
}

function testRealByteValidation() {
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x00, 0xFF, 0xD9]);
  assert.strictEqual(inspectImageBuffer(jpeg, 'jpeg').detectedMimeType, 'image/jpeg');
  assert.strictEqual(inspectImageBuffer(createPng(), 'png').detectedExtension, 'png');
  assert.strictEqual(inspectImageBuffer(createWebp(), 'webp').detectedExtension, 'webp');
  expectCode(() => inspectImageBuffer(Buffer.alloc(0), 'jpg'), ERROR_CODES.IMAGE_FILE_TYPE_INVALID);
  expectCode(() => inspectImageBuffer(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'jpg'), ERROR_CODES.IMAGE_FILE_TOO_LARGE);
  expectCode(() => inspectImageBuffer(Buffer.from('not an image'), 'jpg'), ERROR_CODES.IMAGE_FILE_TYPE_INVALID);
  expectCode(() => inspectImageBuffer(Buffer.from('<svg></svg>'), 'jpg'), ERROR_CODES.IMAGE_FILE_TYPE_INVALID);
  expectCode(() => inspectImageBuffer(Buffer.from('GIF89a'), 'gif'), ERROR_CODES.IMAGE_FILE_TYPE_INVALID);
  expectCode(() => inspectImageBuffer(Buffer.from('BMfake-bitmap'), 'jpg'), ERROR_CODES.IMAGE_FILE_TYPE_INVALID);
  expectCode(() => inspectImageBuffer(Buffer.from('....ftypheic'), 'jpg'), ERROR_CODES.IMAGE_FILE_TYPE_INVALID);
  expectCode(() => inspectImageBuffer(Buffer.concat([createPng(), createPng()]), 'png'), ERROR_CODES.IMAGE_FILE_TYPE_INVALID);
  expectCode(() => inspectImageBuffer(createPng(), 'jpg'), ERROR_CODES.IMAGE_FILE_TYPE_INVALID);
  assert.doesNotThrow(() => validateCloudFileId(
    `cloud://${ENV_ID}.bucket/product-images/uploads/a.jpg`,
    ENV_ID,
    'product-images/uploads/a.jpg'
  ));
  expectCode(() => validateCloudFileId(
    `cloud://${ENV_ID}.bucket/product-images/uploads/other.jpg`,
    ENV_ID,
    'product-images/uploads/a.jpg'
  ), ERROR_CODES.IMAGE_FILE_PATH_INVALID);
  expectCode(() => validateCloudFileId(
    'cloud://other-env.bucket/product-images/uploads/a.jpg',
    ENV_ID,
    'product-images/uploads/a.jpg'
  ), ERROR_CODES.IMAGE_FILE_PATH_INVALID);
}

async function testPrepareConfirmPermissionsAndIdempotency() {
  const viewer = createFixture('viewer');
  await expectAsyncCode(() => prepareProductImage(viewer.db, viewer.user, {
    extension: 'jpg', sizeBytes: 8, requestKey: 'viewer_prepare_123456'
  }), ERROR_CODES.FORBIDDEN);
  await expectAsyncCode(() => confirmProductImage(viewer.db, viewer.user, {
    assetKey: 'product_image_1234567890abcdef1234567890abcdef',
    fileId: `cloud://${ENV_ID}.bucket/product-images/uploads/viewer.jpg`,
    requestKey: 'viewer_confirm_123456'
  }, { cloud: createCloud(), envId: ENV_ID }), ERROR_CODES.FORBIDDEN);
  await expectAsyncCode(() => updateProduct(viewer.db, viewer.user, createUpdateInput({
    _id: 'product_12345678',
    version: 1,
    name: 'viewer product',
    productCode: '',
    category: '其他',
    unit: '个',
    brand: '',
    specification: '',
    description: ''
  }, {
    coverType: 'none',
    coverText: '',
    coverEmoji: '',
    coverBackground: ''
  }, 'viewer_update_12345678')), ERROR_CODES.FORBIDDEN);

  const fixture = createFixture('admin');
  const input = { extension: 'jpg', sizeBytes: 8, requestKey: 'prepare_idem_12345678' };
  const first = await prepareProductImage(fixture.db, fixture.user, input, {
    createPathToken: (() => { let index = 0; return () => `token${++index}`; })()
  });
  const retry = await prepareProductImage(fixture.db, fixture.user, input);
  assert.strictEqual(retry.assetKey, first.assetKey);
  assert.strictEqual(retry.cloudPath, first.cloudPath);
  assert.strictEqual(retry.idempotent, true);
  await expectAsyncCode(() => prepareProductImage(fixture.db, fixture.user, Object.assign({}, input, {
    sizeBytes: 9
  })), ERROR_CODES.REQUEST_KEY_CONFLICT);

  const cloud = createCloud();
  const fileId = `cloud://${ENV_ID}.bucket/${first.cloudPath}`;
  cloud.files.set(fileId, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x00, 0xFF, 0xD9]));
  const confirmInput = {
    assetKey: first.assetKey,
    fileId,
    requestKey: 'confirm_idem_12345678'
  };
  const confirmed = await confirmProductImage(fixture.db, fixture.user, confirmInput, { cloud, envId: ENV_ID });
  const confirmRetry = await confirmProductImage(fixture.db, fixture.user, confirmInput, { cloud, envId: ENV_ID });
  assert.strictEqual(confirmed.assetKey, first.assetKey);
  assert.strictEqual(confirmRetry.idempotent, true);
  const asset = fixture.documents.product_image_assets.get(first.assetKey);
  assert.strictEqual(asset.status, 'staged');
  assert.ok(asset.fileId.includes('/product-images/verified/'));
  assert.notStrictEqual(asset.fileId, fileId);
  assert.strictEqual(asset.sha256.length, 64);
}

async function testConfirmRejections() {
  const fixture = createFixture();
  const cloud = createCloud();
  const prepared = await prepareProductImage(fixture.db, fixture.user, {
    extension: 'jpg', sizeBytes: 12, requestKey: 'prepare_bad_path_123456'
  });
  await expectAsyncCode(() => confirmProductImage(fixture.db, fixture.user, {
    assetKey: prepared.assetKey,
    fileId: `cloud://${ENV_ID}.bucket/product-images/uploads/forged.jpg`,
    requestKey: 'confirm_bad_path_123456'
  }, { cloud, envId: ENV_ID }), ERROR_CODES.IMAGE_FILE_PATH_INVALID);
  assert.strictEqual(fixture.documents.product_image_assets.get(prepared.assetKey).status, 'rejected');

  const missing = await prepareProductImage(fixture.db, fixture.user, {
    extension: 'jpg', sizeBytes: 8, requestKey: 'prepare_missing_1234567'
  });
  await expectAsyncCode(() => confirmProductImage(fixture.db, fixture.user, {
    assetKey: missing.assetKey,
    fileId: `cloud://${ENV_ID}.bucket/${missing.cloudPath}`,
    requestKey: 'confirm_missing_1234567'
  }, { cloud, envId: ENV_ID }), ERROR_CODES.IMAGE_FILE_DOWNLOAD_FAILED);
}

async function testCreateAndUpdateBinding() {
  const fixture = createFixture();
  const cloud = createCloud();
  const firstAssetKey = await stageAsset(
    fixture,
    cloud,
    'jpg',
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x00, 0xFF, 0xD9]),
    'create'
  );
  const created = await createProduct(
    fixture.db,
    fixture.user,
    createProductInput(firstAssetKey),
    { cloud }
  );
  const productId = created.product.id;
  let product = fixture.documents.products.get(productId);
  assert.strictEqual(product.coverType, 'image');
  assert.strictEqual(product.coverAssetKey, firstAssetKey);
  assert.ok(product.coverFileId.includes('/product-images/verified/'));
  assert.strictEqual(fixture.documents.product_image_assets.get(firstAssetKey).status, 'bound');
  assert.strictEqual(fixture.documents.product_image_assets.get(firstAssetKey).productId, productId);
  assert.strictEqual(created.warehouseProduct.cover.imageAvailable, true);
  assert.ok(created.warehouseProduct.cover.imageUrl.startsWith('https://'));
  assert.strictEqual(created.warehouseProduct.cover.fileId, undefined);
  assert.strictEqual(created.warehouseProduct.cover.assetKey, undefined);

  const replacementKey = await stageAsset(fixture, cloud, 'png', createPng(), 'replace');
  const updated = await updateProduct(fixture.db, fixture.user, createUpdateInput(product, {
    coverType: 'image', coverAssetKey: replacementKey
  }, 'update_image_12345678'), { cloud });
  product = fixture.documents.products.get(productId);
  assert.strictEqual(updated.product.cover.imageAvailable, true);
  assert.strictEqual(updated.product.cover.assetKey, undefined);
  assert.strictEqual(updated.product.cover.fileId, undefined);
  assert.strictEqual(fixture.documents.product_image_assets.get(replacementKey).status, 'bound');
  assert.strictEqual(fixture.documents.product_image_assets.get(firstAssetKey).status, 'orphaned');
  assert.ok(fixture.documents.product_image_assets.get(firstAssetKey).cleanupAfter instanceof Date);

  await updateProduct(fixture.db, fixture.user, createUpdateInput(product, {
    coverType: 'text', coverText: '图', coverEmoji: '', coverBackground: '#EAF6EF'
  }, 'update_text_123456789'));
  product = fixture.documents.products.get(productId);
  assert.strictEqual(product.coverType, 'text');
  assert.strictEqual(product.coverFileId, '');
  assert.strictEqual(fixture.documents.product_image_assets.get(replacementKey).status, 'orphaned');

  await updateProduct(fixture.db, fixture.user, createUpdateInput(product, {
    coverType: 'emoji', coverText: '', coverEmoji: '📦', coverBackground: '#EAF6EF'
  }, 'update_emoji_12345678'));
  product = fixture.documents.products.get(productId);
  assert.strictEqual(product.coverType, 'emoji');
  await updateProduct(fixture.db, fixture.user, createUpdateInput(product, {
    coverType: 'none', coverText: '', coverEmoji: '', coverBackground: ''
  }, 'update_none_123456789'));
  assert.strictEqual(fixture.documents.products.get(productId).coverType, 'none');
}

async function testTransactionFailuresLeaveAssetsStable() {
  const fixture = createFixture();
  const cloud = createCloud();
  const stagedKey = await stageAsset(fixture, cloud, 'webp', createWebp(), 'create_fail');
  fixture.setFailure(({ name, operation, transactional }) => transactional && name === 'teams' && operation === 'update');
  await expectAsyncCode(
    () => createProduct(fixture.db, fixture.user, createProductInput(stagedKey, 'create_fail_product_1234')),
    ERROR_CODES.DATABASE_ERROR
  );
  fixture.clearFailure();
  assert.strictEqual(fixture.documents.product_image_assets.get(stagedKey).status, 'staged');
  assert.strictEqual(fixture.documents.products.size, 0);

  const firstKey = await stageAsset(fixture, cloud, 'jpg', Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x00, 0xFF, 0xD9
  ]), 'stable_old');
  const created = await createProduct(fixture.db, fixture.user, createProductInput(firstKey, 'create_stable_1234567'));
  let product = fixture.documents.products.get(created.product.id);
  const conflictKey = await stageAsset(fixture, cloud, 'png', createPng(), 'version_conflict');
  const conflictInput = createUpdateInput(product, {
    coverType: 'image', coverAssetKey: conflictKey
  }, 'version_conflict_1234');
  conflictInput.expectedVersion = product.version + 1;
  await expectAsyncCode(
    () => updateProduct(fixture.db, fixture.user, conflictInput),
    ERROR_CODES.PRODUCT_VERSION_CONFLICT
  );
  assert.strictEqual(fixture.documents.product_image_assets.get(conflictKey).status, 'staged');
  assert.strictEqual(fixture.documents.product_image_assets.get(firstKey).status, 'bound');

  const replacementKey = await stageAsset(fixture, cloud, 'png', createPng(), 'update_fail');
  product = fixture.documents.products.get(created.product.id);
  fixture.setFailure(({ name, operation, transactional }) =>
    transactional && name === 'warehouse_products' && operation === 'update');
  await expectAsyncCode(() => updateProduct(fixture.db, fixture.user, createUpdateInput(product, {
    coverType: 'image', coverAssetKey: replacementKey
  }, 'update_fail_12345678')), ERROR_CODES.DATABASE_ERROR);
  fixture.clearFailure();
  assert.strictEqual(fixture.documents.product_image_assets.get(replacementKey).status, 'staged');
  assert.strictEqual(fixture.documents.product_image_assets.get(firstKey).status, 'bound');
  assert.strictEqual(fixture.documents.products.get(created.product.id).coverAssetKey, firstKey);

  const expiredKey = await stageAsset(fixture, cloud, 'png', createPng(), 'expired');
  fixture.documents.product_image_assets.get(expiredKey).expiresAt = new Date(0);
  await expectAsyncCode(
    () => createProduct(fixture.db, fixture.user, createProductInput(expiredKey, 'create_expired_123456')),
    ERROR_CODES.IMAGE_ASSET_EXPIRED
  );
  assert.strictEqual(fixture.documents.product_image_assets.get(expiredKey).status, 'staged');

  const boundElsewhereKey = await stageAsset(fixture, cloud, 'png', createPng(), 'bound_elsewhere');
  const boundElsewhere = fixture.documents.product_image_assets.get(boundElsewhereKey);
  boundElsewhere.status = 'bound';
  boundElsewhere.productId = 'product_other_12345678';
  await expectAsyncCode(
    () => createProduct(fixture.db, fixture.user, createProductInput(boundElsewhereKey, 'create_bound_other_1234')),
    ERROR_CODES.IMAGE_ASSET_ALREADY_BOUND
  );
}

async function testFrontendServiceAndPayloads() {
  assert.throws(() => productImageService.validateLocalImage({
    filePath: 'wxfile://large.jpg', sizeBytes: MAX_IMAGE_BYTES + 1
  }), (error) => error.code === ERROR_CODES.IMAGE_FILE_TOO_LARGE);
  assert.throws(() => productImageService.validateLocalImage({
    filePath: 'wxfile://bad.gif', sizeBytes: 20
  }), (error) => error.code === ERROR_CODES.IMAGE_FILE_TYPE_INVALID);

  const calls = [];
  const staged = await productImageService.stageProductImage({
    filePath: 'wxfile://safe.jpg',
    sizeBytes: 8,
    stageRequestKey: 'front_prepare_12345678',
    confirmRequestKey: 'front_confirm_12345678'
  }, {
    prepareProductImage: async () => {
      calls.push('prepare');
      return { assetKey: 'product_image_1234567890abcdef1234567890abcdef', cloudPath: 'uploads/a.jpg', status: 'awaiting_upload' };
    },
    uploadProductImage: async () => { calls.push('upload'); return { fileId: 'private-file-id' }; },
    confirmProductImage: async () => {
      calls.push('confirm');
      return { assetKey: 'product_image_1234567890abcdef1234567890abcdef', status: 'staged' };
    }
  });
  assert.deepStrictEqual(calls, ['prepare', 'upload', 'confirm']);
  assert.strictEqual(staged.assetKey, 'product_image_1234567890abcdef1234567890abcdef');

  let confirmCalls = 0;
  await assert.rejects(() => productImageService.stageProductImage({
    filePath: 'wxfile://safe.jpg', sizeBytes: 8, stageRequestKey: 'front_fail_123456789', confirmRequestKey: 'front_fail_confirm_1234'
  }, {
    prepareProductImage: async () => ({ assetKey: staged.assetKey, cloudPath: 'uploads/a.jpg', status: 'awaiting_upload' }),
    uploadProductImage: async () => { throw new Error('upload failed'); },
    confirmProductImage: async () => { confirmCalls += 1; }
  }));
  assert.strictEqual(confirmCalls, 0);

  const form = {
    coverMode: 'custom', coverAssetKey: staged.assetKey, localImagePath: 'wxfile://safe.jpg',
    name: '图片产品', code: '', category: '其他', unit: '个', customUnit: '',
    brand: '', specification: '', description: '', stock: 0, minStock: 0, lowStockEnabled: true
  };
  const createPayload = editUtils.buildCreateProductPayload(form);
  assert.strictEqual(createPayload.coverType, 'image');
  assert.strictEqual(createPayload.coverAssetKey, staged.assetKey);
  assert.strictEqual(createPayload.coverFileId, undefined);
  assert.deepStrictEqual(clientProductService.buildCreateProductPayload(Object.assign({}, createPayload, {
    coverFileId: 'forged'
  })).coverFileId, undefined);

  const existingForm = Object.assign({}, form, { coverMode: 'existing-image', localImagePath: 'cloud://existing' });
  const preserved = editUtils.buildUpdateProductPayload(existingForm, {
    productId: 'product_12345678', expectedVersion: 1, originalCover: { type: 'image', assetKey: 'old', fileId: 'cloud://existing' }
  });
  assert.strictEqual(preserved.coverType, undefined);
  const replacement = editUtils.buildUpdateProductPayload(form, {
    productId: 'product_12345678', expectedVersion: 1, originalCover: { type: 'image', assetKey: 'old', fileId: 'cloud://existing' }
  });
  assert.strictEqual(replacement.coverType, 'image');
  const text = editUtils.buildUpdateProductPayload(Object.assign({}, form, {
    coverMode: 'text', displayText: '图', coverColor: '#EAF6EF'
  }), {
    productId: 'product_12345678', expectedVersion: 1, originalCover: { type: 'image', assetKey: 'old', fileId: 'cloud://existing' }
  });
  assert.strictEqual(text.coverType, 'text');
  assert.strictEqual(text.coverAssetKey, undefined);
  const emoji = editUtils.buildUpdateProductPayload(Object.assign({}, form, {
    coverMode: 'system', systemAssetEmoji: '📦', systemAssetKey: 'box', coverColor: '#EAF6EF'
  }), {
    productId: 'product_12345678', expectedVersion: 1, originalCover: { type: 'image', assetKey: 'old', fileId: 'cloud://existing' }
  });
  assert.strictEqual(emoji.coverType, 'emoji');
  const none = editUtils.buildUpdateProductPayload(Object.assign({}, form, { coverMode: 'none' }), {
    productId: 'product_12345678', expectedVersion: 1, originalCover: { type: 'image', assetKey: 'old', fileId: 'cloud://existing' }
  });
  assert.strictEqual(none.coverType, 'none');
}

function applySetData(target, updates) {
  Object.keys(updates).forEach((key) => {
    const parts = key.split('.');
    let cursor = target;
    parts.slice(0, -1).forEach((part) => { cursor = cursor[part]; });
    cursor[parts[parts.length - 1]] = updates[key];
  });
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function testPageUploadLockReuseAndUnload() {
  const originalPage = global.Page;
  const originalWx = global.wx;
  const originalGetApp = global.getApp;
  const originalStage = productImageService.stageProductImage;
  const originalCreate = clientProductService.createProduct;
  let pageConfig;
  global.Page = (config) => { pageConfig = config; };
  global.getApp = () => ({
    globalData: { currentRole: 'owner', bootstrapStatus: 'success' },
    bootstrap: () => Promise.resolve()
  });
  global.wx = {
    showToast: () => {},
    switchTab: () => {},
    navigateBack: () => {},
    reLaunch: () => {}
  };
  const pagePath = require.resolve('../miniprogram/pages/product-edit/product-edit.js');
  delete require.cache[pagePath];
  require('../miniprogram/pages/product-edit/product-edit.js');

  function createPage() {
    const page = Object.assign({}, pageConfig);
    page.data = structuredClone(pageConfig.data);
    page.data.currentStep = 3;
    page.data.accessChecking = false;
    page.data.accessDenied = false;
    page.data.imageSizeBytes = 8;
    page.data.form = {
      coverMode: 'custom', coverAssetKey: '', localImagePath: 'wxfile://safe.jpg',
      displayText: '', coverColor: '#EAF6EF', systemAssetKey: '', legacyFallback: false,
      name: '图片产品', code: '', category: '其他', unit: '个', customUnit: '',
      brand: '', specification: '', description: '', stock: 0, minStock: 0, lowStockEnabled: true
    };
    page.pageActive = true;
    page.createCompleted = false;
    page.setData = function (updates, callback) {
      applySetData(this.data, updates);
      if (callback) callback();
    };
    return page;
  }

  try {
    let stageCalls = 0;
    let createCalls = [];
    productImageService.stageProductImage = async () => {
      stageCalls += 1;
      return { assetKey: 'product_image_1234567890abcdef1234567890abcdef', status: 'staged' };
    };
    clientProductService.createProduct = async (payload) => {
      createCalls.push(payload);
      throw { code: 'CLOUD_CALL_FAILED' };
    };
    const page = createPage();
    page.onComplete();
    page.onComplete();
    await flushPromises();
    await flushPromises();
    assert.strictEqual(stageCalls, 1);
    assert.strictEqual(createCalls.length, 1);
    assert.strictEqual(page.data.saving, false);
    page.onComplete();
    await flushPromises();
    await flushPromises();
    assert.strictEqual(stageCalls, 1);
    assert.strictEqual(createCalls.length, 2);
    assert.strictEqual(createCalls[0].coverAssetKey, createCalls[1].coverAssetKey);
    assert.strictEqual(createCalls[0].requestKey, createCalls[1].requestKey);

    let failedStageCreateCalls = 0;
    productImageService.stageProductImage = async () => { throw { code: 'IMAGE_FILE_CONFIRM_FAILED' }; };
    clientProductService.createProduct = async () => { failedStageCreateCalls += 1; };
    const failedStagePage = createPage();
    failedStagePage.onComplete();
    await flushPromises();
    assert.strictEqual(failedStageCreateCalls, 0);
    assert.strictEqual(failedStagePage.data.saving, false);

    let resolveStage;
    let unloadedCreateCalls = 0;
    productImageService.stageProductImage = () => new Promise((resolve) => { resolveStage = resolve; });
    clientProductService.createProduct = async () => { unloadedCreateCalls += 1; };
    const unloadedPage = createPage();
    unloadedPage.onComplete();
    unloadedPage.onUnload();
    resolveStage({ assetKey: 'product_image_abcdef1234567890abcdef1234567890', status: 'staged' });
    await flushPromises();
    assert.strictEqual(unloadedCreateCalls, 0);
  } finally {
    productImageService.stageProductImage = originalStage;
    clientProductService.createProduct = originalCreate;
    global.Page = originalPage;
    global.wx = originalWx;
    global.getApp = originalGetApp;
    delete require.cache[pagePath];
  }
}

function testStaticSecurityBoundaries() {
  const root = path.resolve(__dirname, '..');
  const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
  const editPage = read('miniprogram/pages/product-edit/product-edit.js');
  const editTemplate = read('miniprogram/pages/product-edit/product-edit.wxml');
  const imageService = read('miniprogram/services/product-image-service.js');
  const router = read('cloudfunctions/warehouse-api/router.js');
  const database = read('cloudfunctions/warehouse-api/common/database.js');

  assert(!editPage.includes('wx.cloud.uploadFile'));
  assert.strictEqual((imageService.match(/wx\.cloud\.uploadFile\s*\(/g) || []).length, 1);
  assert(!/wx\.(?:setStorage|setStorageSync)\s*\(/.test(imageService));
  assert(router.includes("'product.image.stage.prepare'"));
  assert(router.includes("'product.image.stage.confirm'"));
  assert(database.includes("PRODUCT_IMAGE_ASSETS: 'product_image_assets'"));
  assert(editTemplate.includes('binderror="onSelectedImageError"'));
  assert(editTemplate.includes('binderror="onExistingImageError"'));

  [
    'miniprogram/pages/inventory/inventory.wxml',
    'miniprogram/pages/product-detail/product-detail.wxml',
    'miniprogram/pages/product-recycle-bin/product-recycle-bin.wxml',
    'miniprogram/pages/catalog-recycle-bin/catalog-recycle-bin.wxml'
  ].forEach((relativePath) => {
    const template = read(relativePath);
    assert(template.includes('mode="aspectFill"'), `${relativePath} must use aspectFill`);
    assert(template.includes('binderror='), `${relativePath} must provide image fallback`);
  });
}

async function run() {
  testRealByteValidation();
  await testPrepareConfirmPermissionsAndIdempotency();
  await testConfirmRejections();
  await testCreateAndUpdateBinding();
  await testTransactionFailuresLeaveAssetsStable();
  await testFrontendServiceAndPayloads();
  await testPageUploadLockReuseAndUnload();
  testStaticSecurityBoundaries();
  console.log('stage2c3c1 tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
