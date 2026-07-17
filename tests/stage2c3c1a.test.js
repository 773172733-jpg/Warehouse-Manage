const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ERROR_CODES } = require('../cloudfunctions/warehouse-api/common/errors.js');
const { createMembershipId } = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const {
  TEMP_URL_MAX_AGE_SECONDS,
  MAX_TEMP_URL_BATCH_SIZE,
  resolveProductImageAccessUrls
} = require('../cloudfunctions/warehouse-api/common/product-image-access.js');
const {
  presentProduct,
  presentWarehouseProduct
} = require('../cloudfunctions/warehouse-api/common/product-utils.js');
const {
  getProductDetail
} = require('../cloudfunctions/warehouse-api/modules/product/product-service.js');

const TEAM_ID = 'team_12345678';
const USER_ID = 'user_12345678';
const WAREHOUSE_ID = 'warehouse_12345678';
const PRODUCT_ID = 'product_12345678';
const WAREHOUSE_PRODUCT_ID = 'warehouse_product_12345678';
const ASSET_KEY = 'product_image_1234567890abcdef1234567890abcdef';
const FILE_ID = 'cloud://cloud1-d8gm59cz2be4e7c23.bucket/product-images/verified/private.jpg';

function createProduct(overrides = {}) {
  return Object.assign({
    _id: PRODUCT_ID,
    teamId: TEAM_ID,
    name: '私有图片产品',
    productCode: 'PRIVATE-001',
    category: '其他',
    unit: '个',
    brand: '',
    specification: '',
    description: '',
    coverType: 'image',
    coverText: '',
    coverEmoji: '',
    coverAssetKey: ASSET_KEY,
    coverFileId: FILE_ID,
    coverBackground: '',
    version: 1,
    status: 'active'
  }, overrides);
}

function createWarehouseProduct(overrides = {}) {
  return Object.assign({
    _id: WAREHOUSE_PRODUCT_ID,
    teamId: TEAM_ID,
    warehouseId: WAREHOUSE_ID,
    productId: PRODUCT_ID,
    status: 'active',
    productNameSnapshot: '私有图片产品',
    productCodeSnapshot: 'PRIVATE-001',
    categorySnapshot: '其他',
    unitSnapshot: '个',
    brandSnapshot: '',
    specificationSnapshot: '',
    coverSummarySnapshot: {
      type: 'image',
      text: '',
      emoji: '',
      assetKey: ASSET_KEY,
      fileId: FILE_ID,
      background: ''
    },
    stock: 0,
    minStock: 1,
    stockStatus: 'out',
    productVersion: 1,
    stockVersion: 1
  }, overrides);
}

function createAsset(overrides = {}) {
  return Object.assign({
    _id: ASSET_KEY,
    teamId: TEAM_ID,
    productId: PRODUCT_ID,
    status: 'bound',
    fileId: FILE_ID,
    boundAt: new Date('2026-07-18T00:00:00.000Z'),
    orphanedAt: null,
    rejectedAt: null
  }, overrides);
}

function matches(document, where) {
  return Object.keys(where || {}).every((key) => document[key] === where[key]);
}

function createDatabase(documents) {
  return {
    collection(name) {
      const collection = documents[name] || new Map();
      return {
        doc(id) {
          return {
            async get() {
              return { data: collection.get(id) || null };
            }
          };
        },
        where(where) {
          return {
            limit(limit) {
              return {
                async get() {
                  const data = Array.from(collection.values()).filter((item) => {
                    return matches(item, where);
                  }).slice(0, limit);
                  return { data };
                }
              };
            }
          };
        }
      };
    }
  };
}

function createCloud(options = {}) {
  const calls = [];
  return {
    calls,
    async getTempFileURL(input) {
      calls.push(input);
      if (options.reject) throw new Error('storage unavailable');
      return {
        fileList: input.fileList.map((item, index) => {
          const failed = options.failIndex === index;
          return {
            fileID: item.fileID,
            tempFileURL: failed ? '' : `https://private.example/image-${index}`,
            maxAge: item.maxAge,
            status: failed ? -1 : 0,
            errMsg: failed ? 'missing' : 'ok'
          };
        })
      };
    }
  };
}

async function resolveSingle(assetOverrides = {}, productOverrides = {}, cloudOptions = {}) {
  const assets = new Map([[ASSET_KEY, createAsset(assetOverrides)]]);
  const cloud = createCloud(cloudOptions);
  const result = await resolveProductImageAccessUrls({
    cloud,
    db: createDatabase({ product_image_assets: assets }),
    teamId: TEAM_ID,
    products: [createProduct(productOverrides)],
    now: new Date('2026-07-18T00:00:00.000Z')
  });
  return { access: result.get(PRODUCT_ID), cloud };
}

async function testBoundStateAndMismatchProtection() {
  const bound = await resolveSingle();
  assert.strictEqual(bound.access.imageAvailable, true);
  assert.strictEqual(bound.access.imageUrl, 'https://private.example/image-0');
  assert.strictEqual(bound.access.imageUrlExpiresAt, '2026-07-18T01:00:00.000Z');
  assert.strictEqual(bound.cloud.calls.length, 1);
  assert.strictEqual(bound.cloud.calls[0].fileList[0].maxAge, TEMP_URL_MAX_AGE_SECONDS);

  for (const status of ['awaiting_upload', 'staged', 'orphaned', 'rejected']) {
    const blocked = await resolveSingle({
      status,
      orphanedAt: status === 'orphaned' ? new Date() : null,
      rejectedAt: status === 'rejected' ? new Date() : null
    });
    assert.strictEqual(blocked.access.imageAvailable, false);
    assert.strictEqual(blocked.cloud.calls.length, 0);
  }

  const mismatches = [
    [{ teamId: 'team_other_123456' }, {}],
    [{ productId: 'product_other_123456' }, {}],
    [{ fileId: 'cloud://other/verified.jpg' }, {}],
    [{ boundAt: null }, {}],
    [{ orphanedAt: new Date() }, {}],
    [{ rejectedAt: new Date() }, {}],
    [{}, { teamId: 'team_other_123456' }],
    [{}, { coverFileId: 'cloud://forged/other.jpg' }]
  ];
  for (const [assetOverrides, productOverrides] of mismatches) {
    const blocked = await resolveSingle(assetOverrides, productOverrides);
    const access = blocked.access || { imageAvailable: false };
    assert.strictEqual(access.imageAvailable, false);
    assert.strictEqual(blocked.cloud.calls.length, 0);
  }
}

async function testBatchDedupAndPartialFailure() {
  const assets = new Map();
  const products = [];
  for (let index = 0; index < MAX_TEMP_URL_BATCH_SIZE; index += 1) {
    const suffix = index.toString(16).padStart(32, '0');
    const productId = `product_batch_${String(index).padStart(8, '0')}`;
    const assetKey = `product_image_${suffix}`;
    const fileId = `cloud://env.bucket/product-images/verified/${index}.jpg`;
    products.push(createProduct({
      _id: productId,
      coverAssetKey: assetKey,
      coverFileId: fileId
    }));
    assets.set(assetKey, createAsset({
      _id: assetKey,
      productId,
      fileId
    }));
  }
  const cloud = createCloud({ failIndex: 7 });
  const result = await resolveProductImageAccessUrls({
    cloud,
    db: createDatabase({ product_image_assets: assets }),
    teamId: TEAM_ID,
    products,
    now: new Date('2026-07-18T00:00:00.000Z')
  });
  assert.strictEqual(cloud.calls.length, 1);
  assert.strictEqual(cloud.calls[0].fileList.length, MAX_TEMP_URL_BATCH_SIZE);
  assert.strictEqual(result.get(products[7]._id).imageAvailable, false);
  assert.strictEqual(result.get(products[8]._id).imageAvailable, true);
  products.forEach((product) => assert.strictEqual(product.imageUrl, undefined));
  assets.forEach((asset) => assert.strictEqual(asset.imageUrl, undefined));

  const duplicateCloud = createCloud();
  await resolveProductImageAccessUrls({
    cloud: duplicateCloud,
    db: createDatabase({ product_image_assets: new Map([[ASSET_KEY, createAsset()]]) }),
    teamId: TEAM_ID,
    products: [createProduct(), createProduct()],
    now: new Date()
  });
  assert.strictEqual(duplicateCloud.calls.length, 1);
  assert.strictEqual(duplicateCloud.calls[0].fileList.length, 1);

  const rejectedCloud = createCloud({ reject: true });
  const degraded = await resolveProductImageAccessUrls({
    cloud: rejectedCloud,
    db: createDatabase({ product_image_assets: new Map([[ASSET_KEY, createAsset()]]) }),
    teamId: TEAM_ID,
    products: [createProduct()],
    now: new Date()
  });
  assert.strictEqual(degraded.get(PRODUCT_ID).imageAvailable, false);
}

function createDetailFixture(role, membershipStatus = 'active', assetOverrides = {}) {
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
      status: membershipStatus,
      role
    }]]),
    warehouses: new Map([[WAREHOUSE_ID, {
      _id: WAREHOUSE_ID,
      teamId: TEAM_ID,
      status: 'active'
    }]]),
    products: new Map([[PRODUCT_ID, createProduct()]]),
    warehouse_products: new Map([[WAREHOUSE_PRODUCT_ID, createWarehouseProduct()]]),
    product_image_assets: new Map([[ASSET_KEY, createAsset(assetOverrides)]])
  };
  return {
    db: createDatabase(documents),
    user: documents.users.get(USER_ID),
    cloud: createCloud()
  };
}

async function testProductDetailRoleAccessAndPublicResponse() {
  for (const role of ['owner', 'admin', 'viewer']) {
    const fixture = createDetailFixture(role);
    const result = await getProductDetail(
      fixture.db,
      fixture.user,
      { warehouseProductId: WAREHOUSE_PRODUCT_ID },
      { cloud: fixture.cloud }
    );
    assert.strictEqual(result.product.cover.imageAvailable, true);
    assert.ok(result.product.cover.imageUrl.startsWith('https://'));
    assert.strictEqual(result.permissions.canEdit, role !== 'viewer');
    assert.strictEqual(fixture.cloud.calls.length, 1);
    const serialized = JSON.stringify(result);
    [
      'coverFileId',
      'coverAssetKey',
      'sourceUploadFileId',
      'uploadCloudPath',
      'verifiedCloudPath',
      'sha256',
      FILE_ID,
      ASSET_KEY
    ].forEach((secret) => assert.strictEqual(serialized.includes(secret), false));
  }

  for (const status of ['pending', 'removed']) {
    const fixture = createDetailFixture('viewer', status);
    await assert.rejects(
      () => getProductDetail(
        fixture.db,
        fixture.user,
        { warehouseProductId: WAREHOUSE_PRODUCT_ID },
        { cloud: fixture.cloud }
      ),
      (error) => [ERROR_CODES.NO_ACTIVE_TEAM, ERROR_CODES.MEMBERSHIP_NOT_ACTIVE].includes(error.code)
    );
    assert.strictEqual(fixture.cloud.calls.length, 0);
  }

  const crossTeam = createDetailFixture('viewer', 'active', { teamId: 'team_other_123456' });
  const degraded = await getProductDetail(
    crossTeam.db,
    crossTeam.user,
    { warehouseProductId: WAREHOUSE_PRODUCT_ID },
    { cloud: crossTeam.cloud }
  );
  assert.strictEqual(degraded.product.cover.imageAvailable, false);
  assert.strictEqual(crossTeam.cloud.calls.length, 0);
}

function testPresentAndFrontendSafety() {
  const access = {
    imageUrl: 'https://private.example/product',
    imageUrlExpiresAt: '2026-07-18T01:00:00.000Z',
    imageAvailable: true
  };
  const product = presentProduct(createProduct(), access);
  const warehouseProduct = presentWarehouseProduct(createWarehouseProduct(), access);
  [product.cover, warehouseProduct.cover].forEach((cover) => {
    assert.strictEqual(cover.imageUrl, access.imageUrl);
    assert.strictEqual(cover.fileId, undefined);
    assert.strictEqual(cover.assetKey, undefined);
  });

  const root = path.resolve(__dirname, '..');
  const pageFiles = [
    'miniprogram/pages/inventory/inventory.js',
    'miniprogram/pages/inventory/inventory.wxml',
    'miniprogram/pages/product-detail/product-detail.js',
    'miniprogram/pages/product-detail/product-detail.wxml',
    'miniprogram/pages/product-edit/product-edit.js',
    'miniprogram/pages/product-edit/product-edit.wxml',
    'miniprogram/pages/product-recycle-bin/product-recycle-bin.js',
    'miniprogram/pages/product-recycle-bin/product-recycle-bin.wxml',
    'miniprogram/pages/catalog-recycle-bin/catalog-recycle-bin.js',
    'miniprogram/pages/catalog-recycle-bin/catalog-recycle-bin.wxml',
    'miniprogram/utils/product-view.js'
  ];
  const source = pageFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert(!source.includes('getTempFileURL'));
  assert(!source.includes('cover.fileId'));
  assert(!source.includes('cloud://'));
  assert(!source.includes('wx.cloud.uploadFile'));
  assert(source.includes('imageUrl'));
  assert(source.includes('binderror'));

  const allMiniprogramJs = [];
  function collectJs(directory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) collectJs(full);
      else if (entry.name.endsWith('.js')) allMiniprogramJs.push(full);
    });
  }
  collectJs(path.join(root, 'miniprogram'));
  const miniprogramSource = allMiniprogramJs.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert(!miniprogramSource.includes('getTempFileURL'));
  assert(!/wx\.(?:setStorage|setStorageSync)\s*\([^)]*imageUrl/.test(miniprogramSource));
}

async function run() {
  await testBoundStateAndMismatchProtection();
  await testBatchDedupAndPartialFailure();
  await testProductDetailRoleAccessAndPublicResponse();
  testPresentAndFrontendSafety();
  console.log('stage2c3c1a tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
