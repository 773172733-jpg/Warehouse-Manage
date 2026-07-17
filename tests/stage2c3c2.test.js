const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  FORMAL_ENV_ID,
  BATCH_SIZE,
  LEASE_MS,
  MAX_CLEANUP_ATTEMPTS,
  ERROR_CODES,
  isDue,
  getRetryDelayMs,
  validateCleanupFile,
  claimCleanupLease,
  buildDeletionPlan,
  deletePlannedFiles,
  finalizeCleanupLease,
  runCleanupWorker
} = require('../cloudfunctions/product-image-cleanup-worker/cleanup-worker.js');
const { ApiError, ERROR_CODES: API_ERROR_CODES } = require(
  '../cloudfunctions/warehouse-api/common/errors.js'
);
const {
  assertBindableImageAsset
} = require('../cloudfunctions/warehouse-api/modules/product/image-service.js');

const NOW = new Date('2026-07-18T02:00:00.000Z');
const TEAM_ID = 'team_12345678';
const USER_ID = 'user_12345678';

function sourcePath(name) {
  return `product-images/uploads/${name}.jpg`;
}

function verifiedPath(name) {
  return `product-images/verified/${name}.jpg`;
}

function fileId(cloudPath, envId = FORMAL_ENV_ID) {
  return `cloud://${envId}.bucket/${cloudPath}`;
}

function createAsset(id, status, overrides = {}) {
  const sourceCloudPath = sourcePath(`${id}_source`);
  const verifiedCloudPath = verifiedPath(`${id}_verified`);
  return Object.assign({
    _id: id,
    teamId: TEAM_ID,
    createdBy: USER_ID,
    status,
    productId: '',
    uploadCloudPath: sourceCloudPath,
    verifiedCloudPath,
    sourceUploadFileId: fileId(sourceCloudPath),
    fileId: fileId(verifiedCloudPath),
    cleanupAfter: new Date(NOW.getTime() - 1000),
    cleanupState: 'pending',
    cleanupAttemptCount: 0,
    cleanupLeaseToken: '',
    cleanupLeaseUntil: null,
    sourceDeletedAt: null,
    verifiedDeletedAt: null,
    cleanedAt: null
  }, overrides);
}

function cloneCollections(collections) {
  return Object.keys(collections).reduce((result, name) => {
    result[name] = new Map(Array.from(collections[name].entries()).map(([id, value]) => {
      return [id, structuredClone(value)];
    }));
    return result;
  }, {});
}

function replaceCollections(target, source) {
  Object.keys(target).forEach((name) => {
    target[name].clear();
    source[name].forEach((value, id) => target[name].set(id, value));
  });
}

function matchesQuery(document, query) {
  return Object.keys(query || {}).every((key) => {
    const expected = query[key];
    if (expected && expected.operator === 'in') return expected.values.includes(document[key]);
    if (expected && expected.operator === 'lte') {
      const actualTime = new Date(document[key]).getTime();
      return Number.isFinite(actualTime) && actualTime <= expected.value.getTime();
    }
    return document[key] === expected;
  });
}

function createDatabase(assets = [], products = [], stockRecords = []) {
  const collections = {
    product_image_assets: new Map(assets.map((asset) => [asset._id, structuredClone(asset)])),
    products: new Map(products.map((product) => [product._id, structuredClone(product)])),
    stock_records: new Map(stockRecords.map((record) => [record._id, structuredClone(record)]))
  };

  function createSource(store) {
    return {
      collection(name) {
        const collection = store[name];
        assert.ok(collection, `unknown collection ${name}`);
        let query = {};
        let limit = Infinity;
        const orders = [];
        const api = {
          doc(id) {
            return {
              async get() {
                return { data: collection.get(id) || null };
              },
              async update({ data }) {
                const current = collection.get(id);
                assert.ok(current, `missing ${name}/${id}`);
                collection.set(id, Object.assign({}, current, data));
              }
            };
          },
          where(value) {
            query = value;
            return api;
          },
          orderBy(field, direction) {
            orders.push({ field, direction });
            return api;
          },
          limit(value) {
            limit = value;
            return api;
          },
          async get() {
            const data = Array.from(collection.values())
              .filter((document) => matchesQuery(document, query))
              .sort((left, right) => {
                for (const order of orders) {
                  const leftValue = left[order.field] instanceof Date
                    ? left[order.field].getTime()
                    : left[order.field];
                  const rightValue = right[order.field] instanceof Date
                    ? right[order.field].getTime()
                    : right[order.field];
                  if (leftValue === rightValue) continue;
                  const result = leftValue < rightValue ? -1 : 1;
                  return order.direction === 'desc' ? -result : result;
                }
                return 0;
              })
              .slice(0, limit);
            return { data };
          }
        };
        return api;
      }
    };
  }

  const db = createSource(collections);
  db.command = {
    in(values) {
      return { operator: 'in', values };
    },
    lte(value) {
      return { operator: 'lte', value };
    }
  };
  db.runTransaction = async (callback) => {
    const staged = cloneCollections(collections);
    const result = await callback(createSource(staged));
    replaceCollections(collections, staged);
    return result;
  };
  return { db, collections };
}

function createCloud(handler) {
  const calls = [];
  return {
    calls,
    async deleteFile({ fileList }) {
      calls.push(fileList.slice());
      if (handler) return handler(fileList);
      return {
        fileList: fileList.map((value) => ({
          fileID: value,
          status: 0,
          errMsg: 'ok'
        }))
      };
    }
  };
}

function createLogger() {
  const entries = [];
  return {
    entries,
    info(message, value) {
      entries.push({ message, value });
    }
  };
}

async function runFixture(assets, options = {}) {
  const fixture = createDatabase(
    assets,
    options.products || [],
    options.stockRecords || []
  );
  const cloud = options.cloud || createCloud();
  const logger = options.logger || createLogger();
  const summary = await runCleanupWorker({
    db: fixture.db,
    cloud,
    envId: FORMAL_ENV_ID,
    now: NOW,
    runId: 'cleanup_test_run',
    logger,
    event: options.event
  });
  return Object.assign({ summary, cloud, logger }, fixture);
}

async function testDueStatesAndTimestamps() {
  const future = createAsset('asset_future_awaiting', 'awaiting_upload', {
    cleanupAfter: new Date(NOW.getTime() + 1000)
  });
  assert.strictEqual(isDue(future, NOW), false);
  let result = await runFixture([future]);
  assert.strictEqual(result.summary.candidateCount, 0);
  assert.strictEqual(result.cloud.calls.length, 0);

  const awaiting = createAsset('asset_due_awaiting', 'awaiting_upload', {
    fileId: '',
    verifiedCloudPath: ''
  });
  result = await runFixture([awaiting]);
  let stored = result.collections.product_image_assets.get(awaiting._id);
  assert.strictEqual(stored.status, 'rejected');
  assert.strictEqual(stored.rejectionReasonCode, 'IMAGE_UPLOAD_EXPIRED');
  assert.ok(stored.sourceDeletedAt instanceof Date);
  assert.strictEqual(stored.verifiedDeletedAt, null);
  assert.strictEqual(stored.cleanupState, 'completed');
  assert.ok(stored.cleanedAt instanceof Date);

  const stagedFuture = createAsset('asset_future_staged', 'staged', {
    cleanupAfter: new Date(NOW.getTime() + 1000)
  });
  result = await runFixture([stagedFuture]);
  assert.strictEqual(result.summary.candidateCount, 0);

  const staged = createAsset('asset_due_staged', 'staged');
  result = await runFixture([staged]);
  stored = result.collections.product_image_assets.get(staged._id);
  assert.strictEqual(stored.status, 'rejected');
  assert.strictEqual(stored.rejectionReasonCode, 'IMAGE_STAGE_EXPIRED');
  assert.ok(stored.sourceDeletedAt instanceof Date);
  assert.ok(stored.verifiedDeletedAt instanceof Date);
  assert.strictEqual(stored.cleanupState, 'completed');

  for (const status of ['rejected', 'orphaned']) {
    const asset = createAsset(`asset_due_${status}`, status);
    result = await runFixture([asset]);
    stored = result.collections.product_image_assets.get(asset._id);
    assert.ok(stored.sourceDeletedAt instanceof Date);
    assert.ok(stored.verifiedDeletedAt instanceof Date);
    assert.strictEqual(stored.status, status);
    assert.strictEqual(stored.cleanupState, 'completed');
  }
}

async function testBoundAndBindingCompetition() {
  const bound = createAsset('asset_bound_source', 'bound', {
    productId: 'product_bound_12345678'
  });
  let result = await runFixture([bound]);
  let stored = result.collections.product_image_assets.get(bound._id);
  assert.ok(stored.sourceDeletedAt instanceof Date);
  assert.strictEqual(stored.verifiedDeletedAt, null);
  assert.strictEqual(stored.fileId, bound.fileId);
  assert.deepStrictEqual(result.cloud.calls[0], [bound.sourceUploadFileId]);

  const staged = createAsset('asset_worker_wins', 'staged', {
    expiresAt: new Date(NOW.getTime() - 1000),
    detectedMimeType: 'image/jpeg',
    detectedExtension: 'jpg',
    sizeBytes: 8,
    sha256: 'a'.repeat(64)
  });
  const fixture = createDatabase([staged]);
  const claim = await claimCleanupLease(fixture.db, staged._id, NOW, {
    createLeaseToken: () => 'lease_worker_wins'
  });
  assert.strictEqual(claim.claimed, true);
  stored = fixture.collections.product_image_assets.get(staged._id);
  assert.strictEqual(stored.status, 'rejected');
  assert.throws(() => assertBindableImageAsset(stored, {
    teamId: TEAM_ID,
    userId: USER_ID
  }, 'product_new_12345678', NOW), (error) => {
    return error instanceof ApiError && error.code === API_ERROR_CODES.IMAGE_ASSET_NOT_READY;
  });

  const boundFirst = createAsset('asset_product_wins', 'bound', {
    productId: 'product_bound_first',
    sourceUploadFileId: '',
    sourceDeletedAt: NOW
  });
  result = await runFixture([boundFirst]);
  assert.strictEqual(result.cloud.calls.length, 0);
  assert.strictEqual(
    result.collections.product_image_assets.get(boundFirst._id).verifiedDeletedAt,
    null
  );
}

async function testReferenceAndPathSafety() {
  const orphaned = createAsset('asset_still_referenced', 'orphaned', {
    productId: 'product_ref_12345678'
  });
  let result = await runFixture([orphaned], {
    products: [{
      _id: orphaned.productId,
      teamId: TEAM_ID,
      coverAssetKey: orphaned._id,
      coverFileId: orphaned.fileId
    }]
  });
  let stored = result.collections.product_image_assets.get(orphaned._id);
  assert.strictEqual(result.cloud.calls.length, 0);
  assert.strictEqual(stored.cleanupState, 'retry');
  assert.strictEqual(stored.lastCleanupErrorCode, ERROR_CODES.FILE_IN_USE);

  const badCases = [{
    id: 'asset_wrong_env',
    file: fileId(verifiedPath('wrong_env'), 'other-env'),
    path: verifiedPath('wrong_env')
  }, {
    id: 'asset_wrong_directory',
    file: fileId('other/path/file.jpg'),
    path: 'other/path/file.jpg'
  }, {
    id: 'asset_invalid_file',
    file: 'invalid-file-id',
    path: verifiedPath('invalid')
  }];
  for (const item of badCases) {
    const asset = createAsset(item.id, 'rejected', {
      sourceUploadFileId: '',
      sourceDeletedAt: NOW,
      fileId: item.file,
      verifiedCloudPath: item.path
    });
    result = await runFixture([asset]);
    stored = result.collections.product_image_assets.get(asset._id);
    assert.strictEqual(result.cloud.calls.length, 0);
    assert.strictEqual(stored.cleanupState, 'retry');
    assert.strictEqual(stored.lastCleanupErrorCode, ERROR_CODES.PATH_INVALID);
  }

  assert.strictEqual(validateCleanupFile(
    fileId(sourcePath('valid_source')),
    FORMAL_ENV_ID,
    'source',
    sourcePath('valid_source')
  ).valid, true);
  assert.strictEqual(validateCleanupFile(
    fileId(verifiedPath('valid_verified')),
    FORMAL_ENV_ID,
    'verified',
    verifiedPath('other_verified')
  ).valid, false);
}

async function testDeleteResultsAndRetry() {
  const duplicateId = fileId(sourcePath('duplicate'));
  const plans = [{
    errorCode: '',
    targets: [{ kind: 'source', fileId: duplicateId }]
  }, {
    errorCode: '',
    targets: [{ kind: 'source', fileId: duplicateId }]
  }];
  let cloud = createCloud();
  await deletePlannedFiles(cloud, plans);
  assert.deepStrictEqual(cloud.calls[0], [duplicateId]);

  cloud = createCloud((fileList) => ({
    fileList: fileList.map((value) => ({
      fileID: value,
      status: -503003,
      errMsg: 'storage file not exists'
    }))
  }));
  let asset = createAsset('asset_missing_files', 'rejected');
  let result = await runFixture([asset], { cloud });
  assert.strictEqual(
    result.collections.product_image_assets.get(asset._id).cleanupState,
    'completed'
  );

  asset = createAsset('asset_partial_delete', 'rejected');
  cloud = createCloud((fileList) => ({
    fileList: fileList.map((value, index) => ({
      fileID: value,
      status: index === 0 ? 0 : -1,
      errMsg: index === 0 ? 'ok' : 'delete failed'
    }))
  }));
  result = await runFixture([asset], { cloud });
  let stored = result.collections.product_image_assets.get(asset._id);
  assert.ok(stored.sourceDeletedAt instanceof Date);
  assert.strictEqual(stored.verifiedDeletedAt, null);
  assert.strictEqual(stored.cleanupState, 'retry');
  assert.strictEqual(stored.lastCleanupErrorCode, ERROR_CODES.PARTIAL_FAILED);

  asset = createAsset('asset_whole_failure', 'rejected');
  cloud = createCloud(() => {
    throw new Error('storage unavailable');
  });
  result = await runFixture([asset], { cloud });
  stored = result.collections.product_image_assets.get(asset._id);
  assert.strictEqual(stored.sourceDeletedAt, null);
  assert.strictEqual(stored.verifiedDeletedAt, null);
  assert.strictEqual(stored.cleanupState, 'retry');
  assert.strictEqual(stored.lastCleanupErrorCode, ERROR_CODES.DELETE_FAILED);
  assert.strictEqual(stored.cleanupAfter.getTime(), NOW.getTime() + getRetryDelayMs(1));

  assert.strictEqual(getRetryDelayMs(1), 15 * 60 * 1000);
  assert.strictEqual(getRetryDelayMs(2), 30 * 60 * 1000);
  assert.strictEqual(getRetryDelayMs(3), 60 * 60 * 1000);
  assert.strictEqual(getRetryDelayMs(4), 2 * 60 * 60 * 1000);
  assert.strictEqual(getRetryDelayMs(MAX_CLEANUP_ATTEMPTS), 24 * 60 * 60 * 1000);

  asset = createAsset('asset_retry_exhausted', 'rejected', {
    cleanupAttemptCount: MAX_CLEANUP_ATTEMPTS - 1
  });
  result = await runFixture([asset], { cloud });
  stored = result.collections.product_image_assets.get(asset._id);
  assert.strictEqual(stored.cleanupAfter, null);
  assert.strictEqual(stored.lastCleanupErrorCode, ERROR_CODES.RETRY_EXHAUSTED);
}

async function testLeaseAndBatchIsolation() {
  const asset = createAsset('asset_lease_concurrent', 'rejected');
  let fixture = createDatabase([asset]);
  const first = await claimCleanupLease(fixture.db, asset._id, NOW, {
    createLeaseToken: () => 'lease_first'
  });
  const second = await claimCleanupLease(fixture.db, asset._id, NOW, {
    createLeaseToken: () => 'lease_second'
  });
  assert.strictEqual(first.claimed, true);
  assert.strictEqual(second.claimed, false);
  assert.strictEqual(second.errorCode, ERROR_CODES.LEASE_CONFLICT);
  assert.strictEqual(
    fixture.collections.product_image_assets.get(asset._id).cleanupLeaseUntil.getTime(),
    NOW.getTime() + LEASE_MS
  );

  const expiredLease = createAsset('asset_expired_lease', 'rejected', {
    cleanupState: 'processing',
    cleanupLeaseToken: 'old',
    cleanupLeaseUntil: new Date(NOW.getTime() - 1)
  });
  fixture = createDatabase([expiredLease]);
  const recovered = await claimCleanupLease(fixture.db, expiredLease._id, NOW, {
    createLeaseToken: () => 'lease_recovered'
  });
  assert.strictEqual(recovered.claimed, true);
  assert.strictEqual(recovered.leaseToken, 'lease_recovered');

  const plan = await buildDeletionPlan(fixture.db, recovered.asset, FORMAL_ENV_ID);
  plan.asset.cleanupLeaseToken = 'wrong-token';
  const outcome = await finalizeCleanupLease(
    fixture.db,
    plan,
    { results: new Map(), wholeFailure: false },
    NOW
  );
  assert.strictEqual(outcome.skipped, true);
  assert.strictEqual(outcome.errorCode, ERROR_CODES.LEASE_CONFLICT);

  const good = createAsset('asset_batch_good', 'rejected');
  const bad = createAsset('asset_batch_bad', 'rejected', {
    sourceUploadFileId: 'bad',
    fileId: '',
    verifiedCloudPath: ''
  });
  const stockRecord = { _id: 'stock_record_sentinel', afterStock: 9 };
  const logger = createLogger();
  const result = await runFixture([bad, good], {
    logger,
    stockRecords: [stockRecord],
    event: {
      assetKey: good._id,
      fileId: good.fileId
    }
  });
  assert.strictEqual(result.summary.successCount, 1);
  assert.strictEqual(result.summary.retryCount, 1);
  assert.strictEqual(
    result.collections.product_image_assets.get(good._id).cleanupState,
    'completed'
  );
  assert.strictEqual(
    result.collections.product_image_assets.get(bad._id).cleanupState,
    'retry'
  );
  assert.deepStrictEqual(
    result.collections.stock_records.get(stockRecord._id),
    stockRecord
  );

  const serializedLogs = JSON.stringify(logger.entries);
  assert.strictEqual(serializedLogs.includes(good.fileId), false);
  assert.strictEqual(serializedLogs.includes(good._id), false);
  assert.strictEqual(serializedLogs.includes('OPENID'), false);

  const repeated = await runCleanupWorker({
    db: result.db,
    cloud: result.cloud,
    envId: FORMAL_ENV_ID,
    now: NOW,
    runId: 'cleanup_repeat',
    logger
  });
  assert.strictEqual(repeated.successCount, 0);
  assert.strictEqual(result.cloud.calls.length, 1);
}

function testStaticScope() {
  const root = path.resolve(__dirname, '..');
  const worker = fs.readFileSync(
    path.join(root, 'cloudfunctions/product-image-cleanup-worker/cleanup-worker.js'),
    'utf8'
  );
  const index = fs.readFileSync(
    path.join(root, 'cloudfunctions/product-image-cleanup-worker/index.js'),
    'utf8'
  );
  const indexes = fs.readFileSync(path.join(root, 'database/indexes.md'), 'utf8');
  const guide = fs.readFileSync(
    path.join(root, 'docs/阶段2C3C2-产品图片资产延迟清理Worker部署指南.md'),
    'utf8'
  );
  assert.strictEqual(BATCH_SIZE, 20);
  assert(worker.includes("ASSET_COLLECTION = 'product_image_assets'"));
  assert(worker.includes("PRODUCT_COLLECTION = 'products'"));
  assert(worker.includes('cloud.deleteFile({ fileList: fileIds })'));
  assert(index.includes('exports.main = async () =>'));
  assert.strictEqual(index.includes('event.'), false);
  assert.strictEqual(worker.includes('stock_records'), false);
  assert.strictEqual(worker.includes('warehouse_products'), false);
  assert.strictEqual((indexes.match(/\|\s*`(?:u?idx_image_assets_[^`]+)`\s*\|/g) || []).length, 3);
  assert.strictEqual(indexes.includes('fileId`不得建立唯一索引'), true);
  assert(guide.includes('每小时一次'));
  assert(guide.includes('不新增集合，不新增、删除或修改索引'));
  assert(guide.includes('必须重新部署'));
  assert(guide.includes('仅创建者及管理员可读写'));
  assert(guide.includes('不需要购买'));
  assert(guide.includes('绝不删除verified'));
  assert(guide.includes('不代表已经完成真实CloudBase部署'));
}

async function run() {
  await testDueStatesAndTimestamps();
  await testBoundAndBindingCompetition();
  await testReferenceAndPathSafety();
  await testDeleteResultsAndRetry();
  await testLeaseAndBatchIsolation();
  testStaticScope();
  console.log('stage2c3c2 tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
