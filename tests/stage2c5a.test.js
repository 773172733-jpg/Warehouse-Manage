const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ApiError, ERROR_CODES } = require('../cloudfunctions/warehouse-api/common/errors.js');
const { createMembershipId } = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const {
  MAX_PAGE_SIZE,
  validateWarehouseRecordListInput,
  listWarehouseStockRecords
} = require('../cloudfunctions/warehouse-api/modules/stock/record-service.js');
const { ACTION_HANDLERS } = require('../cloudfunctions/warehouse-api/router.js');
const stockService = require('../miniprogram/services/stock-service.js');
global.Page = (definition) => definition;
const recordsPage = require('../miniprogram/pages/records/records.js');

const ROOT = path.resolve(__dirname, '..');
const TEAM_ID = 'team_stage2c5a';
const OTHER_TEAM_ID = 'team_stage2c5a_other';
const WAREHOUSE_ID = 'warehouse_stage2c5a';
const OTHER_WAREHOUSE_ID = 'warehouse_stage2c5a_other';
const USER_ID = 'user_stage2c5a';
const PRODUCT_A_ID = 'product_stage2c5a_a';
const PRODUCT_B_ID = 'product_stage2c5a_b';
const PRODUCT_DELETED_ID = 'product_stage2c5a_deleted';
const WAREHOUSE_PRODUCT_A_ID = 'whp_stage2c5a_a';
const WAREHOUSE_PRODUCT_B_ID = 'whp_stage2c5a_b';
const WAREHOUSE_PRODUCT_DELETED_ID = 'whp_stage2c5a_deleted';

function compareValue(left, right) {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function condition(operator, value) {
  return {
    operator,
    value,
    and(next) {
      return { and: [this, next] };
    }
  };
}

function matchesValue(value, expected) {
  if (expected && expected.operator === 'lt') return compareValue(value, expected.value) < 0;
  if (expected && expected.operator === 'lte') return compareValue(value, expected.value) <= 0;
  if (expected && expected.operator === 'gte') return compareValue(value, expected.value) >= 0;
  if (expected && expected.operator === 'eq') return compareValue(value, expected.value) === 0;
  if (expected && expected.operator === 'in') return expected.value.includes(value);
  if (expected && Array.isArray(expected.and)) {
    return expected.and.every((item) => matchesValue(value, item));
  }
  return compareValue(value, expected) === 0;
}

function matches(document, where) {
  if (where && Array.isArray(where.or)) return where.or.some((branch) => matches(document, branch));
  return Object.keys(where || {}).every((key) => matchesValue(document[key], where[key]));
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createRecord(index, overrides = {}) {
  const types = ['initial', 'inbound', 'outbound', 'adjustment'];
  const type = overrides.type || types[index % types.length];
  const delta = type === 'outbound' ? -3 : (type === 'adjustment' ? -1 : 5);
  const afterStock = 200 - index;
  const productId = index % 2 ? PRODUCT_B_ID : PRODUCT_A_ID;
  const warehouseProductId = index % 2 ? WAREHOUSE_PRODUCT_B_ID : WAREHOUSE_PRODUCT_A_ID;
  return Object.assign({
    _id: `stock_record_stage2c5a_${String(index).padStart(4, '0')}`,
    teamId: TEAM_ID,
    warehouseId: WAREHOUSE_ID,
    productId,
    warehouseProductId,
    productNameSnapshot: index % 2 ? '管件 B' : '瓷砖 RA1809100',
    productCodeSnapshot: index % 2 ? 'B-200' : 'RA1809100',
    unitSnapshot: '件',
    type,
    beforeStock: afterStock - delta,
    afterStock,
    delta,
    quantity: Math.abs(delta),
    reason: type === 'initial' ? 'initial_stock' : `reason-${index}`,
    referenceNo: `REF-${index}`,
    operatorUserId: USER_ID,
    operatorRole: index % 2 ? 'admin' : 'owner',
    operatorNameSnapshot: `operator-${index}`,
    requestKey: `secret-request-${index}`,
    requestHash: `secret-hash-${index}`,
    stockVersionBefore: index + 1,
    stockVersionAfter: index + 2,
    createdAt: new Date(Date.UTC(2026, 6, 18, 8, 0, 60 - index))
  }, overrides);
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
      status: options.warehouseStatus || 'active'
    }]]),
    products: new Map([
      [PRODUCT_A_ID, {
        _id: PRODUCT_A_ID,
        teamId: TEAM_ID,
        status: 'active',
        name: '瓷砖 RA1809100',
        productCode: 'RA1809100',
        unit: '件',
        coverType: 'text',
        coverText: 'RA',
        coverEmoji: '',
        coverAssetKey: '',
        coverFileId: '',
        coverBackground: '#EAF6EF'
      }],
      [PRODUCT_B_ID, {
        _id: PRODUCT_B_ID,
        teamId: TEAM_ID,
        status: 'active',
        name: '管件 B',
        productCode: 'B-200',
        unit: '箱',
        coverType: 'none',
        coverText: '',
        coverEmoji: '',
        coverAssetKey: '',
        coverFileId: '',
        coverBackground: ''
      }],
      [PRODUCT_DELETED_ID, {
        _id: PRODUCT_DELETED_ID,
        teamId: TEAM_ID,
        status: 'deleted',
        name: '已删商品',
        productCode: 'DEL-1',
        unit: '个',
        coverType: 'none'
      }]
    ]),
    warehouse_products: new Map([
      [WAREHOUSE_PRODUCT_A_ID, {
        _id: WAREHOUSE_PRODUCT_A_ID,
        teamId: TEAM_ID,
        warehouseId: WAREHOUSE_ID,
        productId: PRODUCT_A_ID,
        status: 'active',
        productNameSnapshot: '瓷砖 RA1809100',
        productCodeSnapshot: 'RA1809100',
        unitSnapshot: '件',
        coverSummarySnapshot: { type: 'text', text: 'RA', background: '#EAF6EF' }
      }],
      [WAREHOUSE_PRODUCT_B_ID, {
        _id: WAREHOUSE_PRODUCT_B_ID,
        teamId: TEAM_ID,
        warehouseId: WAREHOUSE_ID,
        productId: PRODUCT_B_ID,
        status: 'active',
        productNameSnapshot: '管件 B',
        productCodeSnapshot: 'B-200',
        unitSnapshot: '箱',
        coverSummarySnapshot: { type: 'none' }
      }],
      [WAREHOUSE_PRODUCT_DELETED_ID, {
        _id: WAREHOUSE_PRODUCT_DELETED_ID,
        teamId: TEAM_ID,
        warehouseId: WAREHOUSE_ID,
        productId: PRODUCT_DELETED_ID,
        status: 'removed',
        productNameSnapshot: '已删商品快照',
        productCodeSnapshot: 'DEL-SNAP',
        unitSnapshot: '个',
        coverSummarySnapshot: { type: 'text', text: '删', background: '#F2F4F2' }
      }]
    ]),
    stock_records: new Map()
  };

  for (let index = 0; index < 26; index += 1) {
    const record = createRecord(index);
    documents.stock_records.set(record._id, record);
  }
  const deletedRecord = createRecord(80, {
    _id: 'stock_record_stage2c5a_deleted',
    productId: PRODUCT_DELETED_ID,
    warehouseProductId: WAREHOUSE_PRODUCT_DELETED_ID,
    productNameSnapshot: '已删商品快照',
    productCodeSnapshot: 'DEL-SNAP',
    unitSnapshot: '个',
    type: 'inbound',
    createdAt: new Date(Date.UTC(2026, 6, 17, 1, 0, 0))
  });
  documents.stock_records.set(deletedRecord._id, deletedRecord);
  documents.stock_records.set('stock_record_stage2c5a_other_team', createRecord(90, {
    _id: 'stock_record_stage2c5a_other_team',
    teamId: OTHER_TEAM_ID
  }));
  documents.stock_records.set('stock_record_stage2c5a_other_wh', createRecord(91, {
    _id: 'stock_record_stage2c5a_other_wh',
    warehouseId: OTHER_WAREHOUSE_ID
  }));

  const counters = { get: {}, docGet: {} };
  const lastWhere = {};
  const db = {
    command: {
      lt(value) { return condition('lt', value); },
      lte(value) { return condition('lte', value); },
      gte(value) { return condition('gte', value); },
      eq(value) { return condition('eq', value); },
      in(value) { return condition('in', value); },
      or(branches) { return { or: branches }; }
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
              counters.docGet[name] = (counters.docGet[name] || 0) + 1;
              return { data: collection.get(id) || null };
            }
          };
        },
        where(value) {
          where = value;
          lastWhere[name] = value;
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
          counters.get[name] = (counters.get[name] || 0) + 1;
          let data = Array.from(collection.values()).filter((item) => matches(item, where));
          data.sort((left, right) => {
            for (const order of ordering) {
              const compared = compareValue(left[order.field], right[order.field]);
              if (compared) return order.direction === 'desc' ? -compared : compared;
            }
            return 0;
          });
          data = data.slice(0, limit).map((item) => {
            const source = clone(item);
            if (!selectedFields) return source;
            return Object.keys(selectedFields).reduce((result, field) => {
              if (selectedFields[field] && source[field] !== undefined) result[field] = source[field];
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
    counters,
    lastWhere,
    user: documents.users.get(USER_ID)
  };
}

async function expectCode(callback, code) {
  await assert.rejects(callback, (error) => error instanceof ApiError && error.code === code);
}

function assertNoSensitiveFields(item) {
  ['teamId', 'warehouseId', 'operatorUserId', 'requestKey', 'requestHash'].forEach((field) => {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(item, field), false, field);
  });
}

function testInputValidation() {
  const input = validateWarehouseRecordListInput({ type: 'inbound', pageSize: 50 });
  assert.strictEqual(input.type, 'inbound');
  assert.strictEqual(input.pageSize, MAX_PAGE_SIZE);
  assert.throws(
    () => validateWarehouseRecordListInput({ type: 'bad' }),
    (error) => error.code === ERROR_CODES.INVALID_RECORD_TYPE
  );
  assert.throws(
    () => validateWarehouseRecordListInput({ teamId: TEAM_ID }),
    (error) => error.code === ERROR_CODES.FORBIDDEN
  );
  assert.throws(
    () => validateWarehouseRecordListInput({ startAt: '2026-07-19T00:00:00.000Z', endAt: '2026-07-18T00:00:00.000Z' }),
    (error) => error.code === ERROR_CODES.INVALID_DATE_RANGE
  );
  assert.throws(
    () => validateWarehouseRecordListInput({ startAt: '2025-01-01T00:00:00.000Z', endAt: '2026-07-18T00:00:00.000Z' }),
    (error) => error.code === ERROR_CODES.INVALID_DATE_RANGE
  );
}

async function testRolesAndScope() {
  for (const role of ['owner', 'admin', 'viewer']) {
    const fixture = createFixture(role);
    const result = await listWarehouseStockRecords(fixture.db, fixture.user, { pageSize: 5 });
    assert.strictEqual(result.items.length, 5);
    assert.ok(result.items.every((item) => item.productId !== 'stock_record_stage2c5a_other_team'));
    assert.ok(fixture.lastWhere.stock_records.teamId === TEAM_ID ||
      fixture.lastWhere.stock_records.or[0].teamId === TEAM_ID);
    assert.ok(fixture.lastWhere.stock_records.warehouseId === WAREHOUSE_ID ||
      fixture.lastWhere.stock_records.or[0].warehouseId === WAREHOUSE_ID);
  }

  await expectCode(
    () => listWarehouseStockRecords(createFixture('viewer', { membershipStatus: 'pending' }).db,
      createFixture('viewer', { membershipStatus: 'pending' }).user, {}),
    ERROR_CODES.FORBIDDEN
  );
  const removed = createFixture('viewer', { membershipStatus: 'removed' });
  await expectCode(() => listWarehouseStockRecords(removed.db, removed.user, {}), ERROR_CODES.FORBIDDEN);
  const inactiveWarehouse = createFixture('viewer', { warehouseStatus: 'removed' });
  await expectCode(() => listWarehouseStockRecords(inactiveWarehouse.db, inactiveWarehouse.user, {}), ERROR_CODES.WAREHOUSE_NOT_ACTIVE);
}

async function testFilteringSortingCursorAndMapping() {
  const fixture = createFixture('viewer');
  const all = await listWarehouseStockRecords(fixture.db, fixture.user, { pageSize: 10 });
  assert.strictEqual(all.items.length, 10);
  assert.strictEqual(all.hasMore, true);
  for (let index = 1; index < all.items.length; index += 1) {
    const previous = all.items[index - 1];
    const current = all.items[index];
    assert.ok(new Date(previous.createdAt).getTime() >= new Date(current.createdAt).getTime());
  }
  all.items.forEach(assertNoSensitiveFields);

  const inbound = await listWarehouseStockRecords(fixture.db, fixture.user, {
    type: 'inbound',
    pageSize: 8
  });
  assert.ok(inbound.items.length > 0);
  assert.ok(inbound.items.every((item) => item.type === 'inbound'));
  assert.strictEqual(fixture.lastWhere.stock_records.type, 'inbound');

  const ranged = await listWarehouseStockRecords(fixture.db, fixture.user, {
    startAt: '2026-07-18T08:00:50.000Z',
    endAt: '2026-07-18T08:01:00.000Z',
    pageSize: 20
  });
  assert.ok(ranged.items.length > 0);
  assert.ok(ranged.items.every((item) => {
    const time = new Date(item.createdAt).getTime();
    return time >= Date.parse('2026-07-18T08:00:50.000Z') &&
      time <= Date.parse('2026-07-18T08:01:00.000Z');
  }));

  const firstPage = await listWarehouseStockRecords(fixture.db, fixture.user, { pageSize: 6 });
  const secondPage = await listWarehouseStockRecords(fixture.db, fixture.user, {
    cursor: firstPage.nextCursor,
    pageSize: 6
  });
  const ids = new Set(firstPage.items.map((item) => item.id));
  secondPage.items.forEach((item) => assert.strictEqual(ids.has(item.id), false));
  await expectCode(
    () => listWarehouseStockRecords(fixture.db, fixture.user, {
      cursor: firstPage.nextCursor,
      type: 'inbound',
      pageSize: 6
    }),
    ERROR_CODES.INVALID_CURSOR
  );

  assert.strictEqual(fixture.counters.get.products > 0, true);
  assert.strictEqual(fixture.counters.get.warehouse_products > 0, true);
  assert.ok((fixture.counters.docGet.products || 0) === 0);
  assert.ok((fixture.counters.docGet.warehouse_products || 0) === 0);
  const deleted = await listWarehouseStockRecords(fixture.db, fixture.user, {
    startAt: '2026-07-17T00:00:00.000Z',
    endAt: '2026-07-17T23:59:59.999Z',
    pageSize: 10
  });
  const historical = deleted.items.filter((item) => item.id === 'stock_record_stage2c5a_deleted')[0];
  assert.ok(historical);
  assert.strictEqual(historical.productName, '已删商品快照');
  assert.strictEqual(historical.canNavigate, false);
}

function testClientAndStaticWiring() {
  assert.ok(ACTION_HANDLERS['stock.records.listWarehouse']);
  const payload = stockService.buildWarehouseRecordListPayload({
    type: 'inbound',
    startAt: '2026-07-18T00:00:00.000Z',
    endAt: '2026-07-18T23:59:59.999Z',
    cursor: 'abc',
    pageSize: 20,
    teamId: TEAM_ID
  });
  assert.deepStrictEqual(payload, {
    type: 'inbound',
    startAt: '2026-07-18T00:00:00.000Z',
    endAt: '2026-07-18T23:59:59.999Z',
    cursor: 'abc',
    pageSize: 20
  });
  assert.strictEqual(recordsPage.getDateRange('all').startAt, undefined);
  assert.strictEqual(recordsPage.TYPE_OPTIONS.some((item) => item.value === 'initial'), true);
  const mapped = recordsPage.mapRecord({
    id: 'record_1',
    productName: '瓷砖 RA1809100',
    productCode: 'RA1809100',
    unit: '件',
    type: 'inbound',
    beforeStock: 20,
    afterStock: 30,
    delta: 10,
    reason: '采购到货',
    referenceNo: 'PO-1',
    operatorRole: 'admin',
    createdAt: '2026-07-18T13:20:00.000Z',
    canNavigate: true
  });
  assert.strictEqual(mapped.deltaText, '+10');
  assert.strictEqual(mapped.stockText, '20 → 30');
  assert.strictEqual(mapped.operatorText, '管理员');
}

function testStaticSourceRules() {
  const routerSource = fs.readFileSync(path.join(ROOT, 'cloudfunctions/warehouse-api/router.js'), 'utf8');
  assert.ok(routerSource.includes("'stock.records.listWarehouse'"));
  const serviceSource = fs.readFileSync(
    path.join(ROOT, 'cloudfunctions/warehouse-api/modules/stock/record-service.js'),
    'utf8'
  );
  assert.ok(serviceSource.includes("orderBy('createdAt', 'desc')"));
  assert.ok(serviceSource.includes("orderBy('_id', 'desc')"));
  assert.ok(serviceSource.includes('resolveProductImageAccessUrls'));
  const warehouseFunction = serviceSource.slice(
    serviceSource.indexOf('async function listWarehouseStockRecords'),
    serviceSource.indexOf('\nmodule.exports')
  );
  assert.ok(!warehouseFunction.includes('MAX_SCAN_RECORDS'));
  const recordsSource = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/records/records.js'), 'utf8');
  assert.ok(!/require\s*\(\s*['"]\.\/mock-records(?:\.js)?['"]\s*\)/.test(recordsSource));
  assert.ok(!/require\s*\(\s*['"]\.\.\/inventory\/mock-data(?:\.js)?['"]\s*\)/.test(recordsSource));
  assert.ok(recordsSource.includes('listWarehouseStockRecords'));
  const cleanupWorker = fs.readFileSync(
    path.join(ROOT, 'cloudfunctions/product-image-cleanup-worker/index.js'),
    'utf8'
  );
  assert.ok(!cleanupWorker.includes('stock_records'));
}

async function run() {
  testInputValidation();
  await testRolesAndScope();
  await testFilteringSortingCursorAndMapping();
  testClientAndStaticWiring();
  testStaticSourceRules();
  console.log('stage2c5a tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
