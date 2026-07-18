const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ApiError, ERROR_CODES } = require('../cloudfunctions/warehouse-api/common/errors.js');
const {
  createMembershipId,
  createStockMutationRecordId
} = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const {
  STOCK_ACTIONS,
  sanitizeStockInput,
  createStockRequestHash,
  calculateStockMutation
} = require('../cloudfunctions/warehouse-api/common/stock-utils.js');
const {
  resolveStockVersion,
  mutateStock
} = require('../cloudfunctions/warehouse-api/modules/stock/stock-service.js');
const { ACTION_HANDLERS } = require('../cloudfunctions/warehouse-api/router.js');
const stockService = require('../miniprogram/services/stock-service.js');

const ROOT = path.resolve(__dirname, '..');
const TEAM_ID = 'team_12345678';
const WAREHOUSE_ID = 'warehouse_12345678';
const USER_ID = 'user_12345678';
const PRODUCT_ID = 'product_12345678';
const WAREHOUSE_PRODUCT_ID = 'warehouse_product_12345678';

function expectCode(callback, code) {
  assert.throws(callback, (error) => error instanceof ApiError && error.code === code);
}

async function expectAsyncCode(callback, code) {
  await assert.rejects(callback, (error) => error && error.code === code);
}

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

function matches(document, where) {
  return Object.keys(where || {}).every((key) => document[key] === where[key]);
}

function createFixture(role = 'owner', options = {}) {
  const membershipId = createMembershipId(TEAM_ID, USER_ID);
  const documents = {
    users: new Map([[USER_ID, {
      _id: USER_ID,
      status: 'active',
      displayName: 'Stock Tester',
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
      name: 'Test Product',
      productCode: 'TEST-001',
      unit: 'item',
      status: 'active'
    }]]),
    warehouse_products: new Map([[WAREHOUSE_PRODUCT_ID, {
      _id: WAREHOUSE_PRODUCT_ID,
      teamId: TEAM_ID,
      warehouseId: WAREHOUSE_ID,
      productId: PRODUCT_ID,
      productNameSnapshot: 'Test Product',
      productCodeSnapshot: 'TEST-001',
      unitSnapshot: 'item',
      status: 'active',
      stock: options.stock === undefined ? 10 : options.stock,
      minStock: options.minStock === undefined ? 3 : options.minStock,
      stockStatus: 'normal',
      stockVersion: options.omitStockVersion ? undefined : 1
    }]]),
    stock_records: new Map()
  };
  const failures = {
    stockRecordSet: Boolean(options.failStockRecordSet)
  };

  function source(store) {
    return {
      collection(name) {
        const collection = store[name];
        assert.ok(collection, `unknown collection ${name}`);
        let where = {};
        let limit = Infinity;
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
                collection.set(id, Object.assign({ _id: id }, data));
              },
              async update({ data }) {
                const current = collection.get(id);
                assert.ok(current, `missing ${name}/${id}`);
                collection.set(id, Object.assign({}, current, data));
              }
            };
          },
          where(value) {
            where = value;
            return api;
          },
          limit(value) {
            limit = value;
            return api;
          },
          async get() {
            return {
              data: Array.from(collection.values())
                .filter((document) => matches(document, where))
                .slice(0, limit)
            };
          }
        };
        return api;
      }
    };
  }

  const db = source(documents);
  let clock = 0;
  let transactionTail = Promise.resolve();
  db.serverDate = () => new Date(Date.UTC(2026, 6, 18, 0, 0, clock++));
  db.runTransaction = (callback) => {
    const execute = async () => {
      const staged = cloneCollections(documents);
      const result = await callback(source(staged));
      replaceCollections(documents, staged);
      return result;
    };
    const pending = transactionTail.then(execute, execute);
    transactionTail = pending.catch(() => {});
    return pending;
  };

  return {
    db,
    documents,
    failures,
    user: documents.users.get(USER_ID),
    membershipId
  };
}

function quantityInput(overrides = {}) {
  return Object.assign({
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    quantity: 4,
    expectedStockVersion: 1,
    reason: '',
    referenceNo: '',
    requestKey: 'stock_request_123456'
  }, overrides);
}

function adjustmentInput(overrides = {}) {
  return Object.assign({
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    targetStock: 7,
    expectedStockVersion: 1,
    reason: 'Cycle count',
    referenceNo: '',
    requestKey: 'adjust_request_123456'
  }, overrides);
}

function testValidationCalculationAndHashing() {
  const inbound = sanitizeStockInput(STOCK_ACTIONS.INBOUND, quantityInput());
  assert.strictEqual(inbound.quantity, 4);
  assert.deepStrictEqual(calculateStockMutation(STOCK_ACTIONS.INBOUND, inbound, 10), {
    beforeStock: 10,
    afterStock: 14,
    delta: 4,
    quantity: 4
  });
  assert.deepStrictEqual(calculateStockMutation(STOCK_ACTIONS.OUTBOUND, inbound, 10), {
    beforeStock: 10,
    afterStock: 6,
    delta: -4,
    quantity: 4
  });
  assert.strictEqual(calculateStockMutation(
    STOCK_ACTIONS.ADJUST,
    sanitizeStockInput(STOCK_ACTIONS.ADJUST, adjustmentInput()),
    10
  ).delta, -3);

  [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].forEach((quantity) => {
    expectCode(
      () => sanitizeStockInput(STOCK_ACTIONS.INBOUND, quantityInput({ quantity })),
      ERROR_CODES.INVALID_STOCK_QUANTITY
    );
  });
  [-1, 1000000000, 1.5].forEach((targetStock) => {
    expectCode(
      () => sanitizeStockInput(STOCK_ACTIONS.ADJUST, adjustmentInput({ targetStock })),
      ERROR_CODES.INVALID_TARGET_STOCK
    );
  });
  expectCode(
    () => sanitizeStockInput(STOCK_ACTIONS.ADJUST, adjustmentInput({ reason: '' })),
    ERROR_CODES.INVALID_INPUT
  );
  expectCode(
    () => sanitizeStockInput(STOCK_ACTIONS.INBOUND, quantityInput({ reason: 'x'.repeat(101) })),
    ERROR_CODES.INVALID_INPUT
  );
  expectCode(
    () => sanitizeStockInput(STOCK_ACTIONS.INBOUND, quantityInput({ referenceNo: 'x'.repeat(51) })),
    ERROR_CODES.INVALID_INPUT
  );
  expectCode(
    () => sanitizeStockInput(STOCK_ACTIONS.INBOUND, Object.assign(quantityInput(), { teamId: TEAM_ID })),
    ERROR_CODES.FORBIDDEN
  );
  expectCode(
    () => calculateStockMutation(STOCK_ACTIONS.INBOUND, quantityInput({ quantity: 1 }), 999999999),
    ERROR_CODES.STOCK_LIMIT_EXCEEDED
  );
  expectCode(
    () => calculateStockMutation(STOCK_ACTIONS.OUTBOUND, quantityInput({ quantity: 11 }), 10),
    ERROR_CODES.INSUFFICIENT_STOCK
  );
  expectCode(
    () => calculateStockMutation(STOCK_ACTIONS.ADJUST, adjustmentInput({ targetStock: 10 }), 10),
    ERROR_CODES.NO_STOCK_CHANGE
  );

  const first = sanitizeStockInput(STOCK_ACTIONS.INBOUND, quantityInput());
  const same = sanitizeStockInput(STOCK_ACTIONS.INBOUND, quantityInput());
  const changed = sanitizeStockInput(STOCK_ACTIONS.INBOUND, quantityInput({ quantity: 5 }));
  assert.strictEqual(
    createStockRequestHash(STOCK_ACTIONS.INBOUND, first),
    createStockRequestHash(STOCK_ACTIONS.INBOUND, same)
  );
  assert.notStrictEqual(
    createStockRequestHash(STOCK_ACTIONS.INBOUND, first),
    createStockRequestHash(STOCK_ACTIONS.INBOUND, changed)
  );
  assert.notStrictEqual(
    createStockRequestHash(STOCK_ACTIONS.INBOUND, first),
    createStockRequestHash(STOCK_ACTIONS.OUTBOUND, first)
  );
}

async function testOwnerAdminViewerAndResponses() {
  for (const role of ['owner', 'admin']) {
    const fixture = createFixture(role);
    const result = await mutateStock(
      fixture.db,
      fixture.user,
      STOCK_ACTIONS.INBOUND,
      quantityInput({ requestKey: `${role}_inbound_123456` })
    );
    assert.strictEqual(result.afterStock, 14);
    assert.strictEqual(result.stockVersion, 2);
    assert.strictEqual(result.stockStatus, 'normal');
    assert.strictEqual(result.idempotent, false);
    assert.strictEqual(fixture.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).stock, 14);
    assert.strictEqual(fixture.documents.stock_records.size, 1);
    ['operatorUserId', 'operatorRole', 'requestHash', 'requestKey', 'teamId', 'warehouseId']
      .forEach((field) => assert.strictEqual(Object.prototype.hasOwnProperty.call(result, field), false));
  }

  const viewer = createFixture('viewer');
  await expectAsyncCode(
    () => mutateStock(viewer.db, viewer.user, STOCK_ACTIONS.INBOUND, quantityInput()),
    ERROR_CODES.FORBIDDEN
  );
  assert.strictEqual(viewer.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).stock, 10);
  assert.strictEqual(viewer.documents.stock_records.size, 0);

  for (const status of ['pending', 'removed']) {
    const fixture = createFixture('admin');
    fixture.documents.team_members.get(fixture.membershipId).status = status;
    await expectAsyncCode(
      () => mutateStock(fixture.db, fixture.user, STOCK_ACTIONS.INBOUND, quantityInput()),
      ERROR_CODES.FORBIDDEN
    );
    assert.strictEqual(fixture.documents.stock_records.size, 0);
  }
}

async function testOutboundAndStatuses() {
  const success = createFixture('owner');
  const result = await mutateStock(
    success.db,
    success.user,
    STOCK_ACTIONS.OUTBOUND,
    quantityInput({ quantity: 4, requestKey: 'outbound_success_123456' })
  );
  assert.strictEqual(result.afterStock, 6);
  assert.strictEqual(result.delta, -4);

  const all = createFixture('owner');
  const out = await mutateStock(
    all.db,
    all.user,
    STOCK_ACTIONS.OUTBOUND,
    quantityInput({ quantity: 10, requestKey: 'outbound_all_123456' })
  );
  assert.strictEqual(out.afterStock, 0);
  assert.strictEqual(out.stockStatus, 'out');

  const low = createFixture('owner');
  const lowResult = await mutateStock(
    low.db,
    low.user,
    STOCK_ACTIONS.OUTBOUND,
    quantityInput({ quantity: 7, requestKey: 'outbound_low_123456' })
  );
  assert.strictEqual(lowResult.stockStatus, 'low');

  const insufficient = createFixture('owner');
  await expectAsyncCode(
    () => mutateStock(
      insufficient.db,
      insufficient.user,
      STOCK_ACTIONS.OUTBOUND,
      quantityInput({ quantity: 11, requestKey: 'outbound_insufficient_123' })
    ),
    ERROR_CODES.INSUFFICIENT_STOCK
  );
  assert.strictEqual(insufficient.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).stock, 10);
  assert.strictEqual(insufficient.documents.stock_records.size, 0);
}

async function testAdjustments() {
  const cases = [
    { targetStock: 15, expectedDelta: 5, expectedStatus: 'normal' },
    { targetStock: 2, expectedDelta: -8, expectedStatus: 'low' },
    { targetStock: 0, expectedDelta: -10, expectedStatus: 'out' }
  ];
  for (const [index, item] of cases.entries()) {
    const fixture = createFixture('admin');
    const result = await mutateStock(
      fixture.db,
      fixture.user,
      STOCK_ACTIONS.ADJUST,
      adjustmentInput({
        targetStock: item.targetStock,
        requestKey: `adjust_case_${index}_123456`
      })
    );
    assert.strictEqual(result.afterStock, item.targetStock);
    assert.strictEqual(result.delta, item.expectedDelta);
    assert.strictEqual(result.stockStatus, item.expectedStatus);
    const record = Array.from(fixture.documents.stock_records.values())[0];
    assert.strictEqual(record.type, 'adjustment');
    assert.strictEqual(record.quantity, Math.abs(item.expectedDelta));
    assert.strictEqual(record.changeQuantity, item.expectedDelta);
  }
}

async function testVersionsIdempotencyAndConcurrency() {
  const legacy = createFixture('owner', { omitStockVersion: true });
  assert.strictEqual(resolveStockVersion(legacy.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID)), 1);
  const legacyResult = await mutateStock(
    legacy.db,
    legacy.user,
    STOCK_ACTIONS.INBOUND,
    quantityInput({ requestKey: 'legacy_version_123456' })
  );
  assert.strictEqual(legacyResult.stockVersion, 2);

  const conflict = createFixture('owner');
  await expectAsyncCode(
    () => mutateStock(
      conflict.db,
      conflict.user,
      STOCK_ACTIONS.INBOUND,
      quantityInput({ expectedStockVersion: 2, requestKey: 'version_conflict_123456' })
    ),
    ERROR_CODES.STOCK_VERSION_CONFLICT
  );
  assert.strictEqual(conflict.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).stockVersion, 1);
  assert.strictEqual(conflict.documents.stock_records.size, 0);

  for (const action of [STOCK_ACTIONS.INBOUND, STOCK_ACTIONS.OUTBOUND]) {
    const fixture = createFixture('owner');
    const input = quantityInput({
      quantity: 2,
      requestKey: action === STOCK_ACTIONS.INBOUND
        ? 'idem_inbound_123456'
        : 'idem_outbound_123456'
    });
    const first = await mutateStock(fixture.db, fixture.user, action, input);
    const second = await mutateStock(fixture.db, fixture.user, action, input);
    assert.strictEqual(first.idempotent, false);
    assert.strictEqual(second.idempotent, true);
    assert.strictEqual(second.recordId, first.recordId);
    assert.strictEqual(fixture.documents.stock_records.size, 1);
    assert.strictEqual(
      fixture.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).stock,
      action === STOCK_ACTIONS.INBOUND ? 12 : 8
    );
  }

  const keyConflict = createFixture('owner');
  await mutateStock(
    keyConflict.db,
    keyConflict.user,
    STOCK_ACTIONS.INBOUND,
    quantityInput({ requestKey: 'same_key_conflict_123456' })
  );
  await expectAsyncCode(
    () => mutateStock(
      keyConflict.db,
      keyConflict.user,
      STOCK_ACTIONS.OUTBOUND,
      quantityInput({ requestKey: 'same_key_conflict_123456' })
    ),
    ERROR_CODES.REQUEST_KEY_CONFLICT
  );
  assert.strictEqual(keyConflict.documents.stock_records.size, 1);

  const concurrent = createFixture('owner');
  const settled = await Promise.allSettled([
    mutateStock(
      concurrent.db,
      concurrent.user,
      STOCK_ACTIONS.OUTBOUND,
      quantityInput({ quantity: 6, requestKey: 'concurrent_one_123456' })
    ),
    mutateStock(
      concurrent.db,
      concurrent.user,
      STOCK_ACTIONS.OUTBOUND,
      quantityInput({ quantity: 6, requestKey: 'concurrent_two_123456' })
    )
  ]);
  assert.strictEqual(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.strictEqual(settled.filter((item) => {
    return item.status === 'rejected' && item.reason.code === ERROR_CODES.STOCK_VERSION_CONFLICT;
  }).length, 1);
  assert.strictEqual(concurrent.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).stock, 4);
  assert.strictEqual(concurrent.documents.stock_records.size, 1);
}

async function testAtomicityScopesAndLifecycle() {
  const atomic = createFixture('owner', { failStockRecordSet: true });
  await expectAsyncCode(
    () => mutateStock(
      atomic.db,
      atomic.user,
      STOCK_ACTIONS.INBOUND,
      quantityInput({ requestKey: 'atomic_failure_123456' })
    ),
    ERROR_CODES.DATABASE_ERROR
  );
  assert.strictEqual(atomic.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).stock, 10);
  assert.strictEqual(atomic.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).stockVersion, 1);
  assert.strictEqual(atomic.documents.stock_records.size, 0);

  const inactiveTeam = createFixture('owner');
  inactiveTeam.documents.teams.get(TEAM_ID).status = 'disabled';
  await expectAsyncCode(
    () => mutateStock(inactiveTeam.db, inactiveTeam.user, STOCK_ACTIONS.INBOUND, quantityInput()),
    ERROR_CODES.TEAM_NOT_ACTIVE
  );

  const inactiveWarehouse = createFixture('owner');
  inactiveWarehouse.documents.warehouses.get(WAREHOUSE_ID).status = 'disabled';
  await expectAsyncCode(
    () => mutateStock(
      inactiveWarehouse.db,
      inactiveWarehouse.user,
      STOCK_ACTIONS.INBOUND,
      quantityInput()
    ),
    ERROR_CODES.WAREHOUSE_NOT_ACTIVE
  );

  const removed = createFixture('owner');
  removed.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).status = 'removed';
  await expectAsyncCode(
    () => mutateStock(removed.db, removed.user, STOCK_ACTIONS.INBOUND, quantityInput()),
    ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE
  );

  const deleted = createFixture('owner');
  deleted.documents.products.get(PRODUCT_ID).status = 'deleted';
  await expectAsyncCode(
    () => mutateStock(deleted.db, deleted.user, STOCK_ACTIONS.INBOUND, quantityInput()),
    ERROR_CODES.PRODUCT_NOT_ACTIVE
  );

  const otherTeam = createFixture('owner');
  otherTeam.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).teamId = 'team_other_12345678';
  await expectAsyncCode(
    () => mutateStock(otherTeam.db, otherTeam.user, STOCK_ACTIONS.INBOUND, quantityInput()),
    ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE
  );

  const otherWarehouse = createFixture('owner');
  otherWarehouse.documents.warehouse_products.get(WAREHOUSE_PRODUCT_ID).warehouseId =
    'warehouse_other_12345678';
  await expectAsyncCode(
    () => mutateStock(otherWarehouse.db, otherWarehouse.user, STOCK_ACTIONS.INBOUND, quantityInput()),
    ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE
  );
}

async function testRecordSchemaAndLegacyCompatibility() {
  const fixture = createFixture('owner');
  const initialId = 'stock_record_initial_12345678';
  const initial = {
    _id: initialId,
    teamId: TEAM_ID,
    warehouseId: WAREHOUSE_ID,
    productId: PRODUCT_ID,
    warehouseProductId: WAREHOUSE_PRODUCT_ID,
    type: 'initial',
    changeQuantity: 10,
    beforeStock: 0,
    afterStock: 10,
    requestAction: 'product.create',
    requestKey: 'product_create_123456',
    requestHash: 'legacy_hash'
  };
  fixture.documents.stock_records.set(initialId, structuredClone(initial));
  await mutateStock(
    fixture.db,
    fixture.user,
    STOCK_ACTIONS.INBOUND,
    quantityInput({ requestKey: 'record_schema_123456' })
  );
  assert.deepStrictEqual(fixture.documents.stock_records.get(initialId), initial);
  assert.strictEqual(fixture.documents.stock_records.size, 2);

  const recordId = createStockMutationRecordId(
    TEAM_ID,
    WAREHOUSE_ID,
    'record_schema_123456'
  );
  const record = fixture.documents.stock_records.get(recordId);
  [
    '_id',
    'teamId',
    'warehouseId',
    'warehouseProductId',
    'productId',
    'type',
    'beforeStock',
    'afterStock',
    'delta',
    'quantity',
    'reason',
    'referenceNo',
    'requestKey',
    'requestHash',
    'operatorUserId',
    'operatorRole',
    'stockVersionBefore',
    'stockVersionAfter',
    'createdAt'
  ].forEach((field) => assert.ok(Object.prototype.hasOwnProperty.call(record, field), field));
}

async function testClientServiceAndStaticBoundaries() {
  assert.deepStrictEqual(stockService.buildQuantityPayload(Object.assign(quantityInput(), {
    teamId: 'forged',
    operatorRole: 'owner',
    delta: 99
  })), quantityInput());
  assert.deepStrictEqual(stockService.buildAdjustmentPayload(Object.assign(adjustmentInput(), {
    recordId: 'forged',
    stockStatus: 'normal'
  })), adjustmentInput());

  const calls = [];
  global.wx = {
    cloud: {
      callFunction(options) {
        calls.push(options);
        return Promise.resolve({
          result: {
            success: false,
            requestId: 'request_stock_123456',
            error: {
              code: ERROR_CODES.INSUFFICIENT_STOCK,
              message: 'Insufficient stock.'
            }
          }
        });
      }
    },
    showLoading() {},
    hideLoading() {}
  };
  await assert.rejects(
    () => stockService.outboundStock(quantityInput()),
    (error) => error.code === ERROR_CODES.INSUFFICIENT_STOCK &&
      error.requestId === 'request_stock_123456'
  );
  assert.strictEqual(calls[0].data.action, STOCK_ACTIONS.OUTBOUND);
  delete global.wx;

  assert.ok(ACTION_HANDLERS[STOCK_ACTIONS.INBOUND]);
  assert.ok(ACTION_HANDLERS[STOCK_ACTIONS.OUTBOUND]);
  assert.ok(ACTION_HANDLERS[STOCK_ACTIONS.ADJUST]);
  assert.strictEqual(ACTION_HANDLERS['stock.record.update'], undefined);
  assert.strictEqual(ACTION_HANDLERS['stock.record.delete'], undefined);

  const stockBackend = fs.readFileSync(
    path.join(ROOT, 'cloudfunctions/warehouse-api/modules/stock/stock-service.js'),
    'utf8'
  );
  assert.strictEqual(/STOCK_RECORDS\)[\s\S]*?\.update\(/.test(stockBackend), false);
  assert.strictEqual(/STOCK_RECORDS\)[\s\S]*?\.remove\(/.test(stockBackend), false);

  const cleanupWorker = fs.readFileSync(
    path.join(ROOT, 'cloudfunctions/product-image-cleanup-worker/index.js'),
    'utf8'
  );
  assert.strictEqual(cleanupWorker.includes('stock_records'), false);
  assert.strictEqual(cleanupWorker.includes('warehouse_products'), false);
}

async function run() {
  testValidationCalculationAndHashing();
  await testOwnerAdminViewerAndResponses();
  await testOutboundAndStatuses();
  await testAdjustments();
  await testVersionsIdempotencyAndConcurrency();
  await testAtomicityScopesAndLifecycle();
  await testRecordSchemaAndLegacyCompatibility();
  await testClientServiceAndStaticBoundaries();
  console.log('stage2c4a tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
