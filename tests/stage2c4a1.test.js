const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createMembershipId } = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const { ERROR_CODES } = require('../cloudfunctions/warehouse-api/common/errors.js');
const {
  SEARCH_FRAGMENT_MAX_LENGTH,
  SEARCH_FRAGMENT_LIMIT_PER_FIELD,
  SEARCH_KEYWORD_LIMIT,
  normalizeSearchText,
  buildSearchKeywords,
  validateProductListInput
} = require('../cloudfunctions/warehouse-api/common/product-utils.js');
const {
  buildProductListWhere,
  buildSearchMetadata,
  listProducts,
  rebuildProductSearch
} = require('../cloudfunctions/warehouse-api/modules/product/product-service.js');

const TEAM_ID = 'team_search_12345678';
const OTHER_TEAM_ID = 'team_search_other_123';
const WAREHOUSE_ID = 'warehouse_search_123';
const OTHER_WAREHOUSE_ID = 'warehouse_search_other';
const USER_ID = 'user_search_12345678';

function operation(type, value) {
  return {
    __operation: type,
    value,
    and(other) {
      return { __operation: 'and', operations: [this, other] };
    }
  };
}

function matchesValue(actual, expected) {
  if (expected && expected.__operation === 'and') {
    return expected.operations.every((item) => matchesValue(actual, item));
  }
  if (expected && expected.__operation === 'gte') return actual >= expected.value;
  if (expected && expected.__operation === 'lt') return actual < expected.value;
  if (expected && expected.__operation === 'eq') return actual === expected.value;
  if (expected && expected.__operation === 'in') return expected.value.includes(actual);
  if (Array.isArray(actual)) return actual.includes(expected);
  return actual === expected;
}

function matchesWhere(document, where) {
  if (where && where.__operation === 'or') {
    return where.branches.some((branch) => matchesWhere(document, branch));
  }
  return Object.keys(where || {}).every((field) => matchesValue(document[field], where[field]));
}

function createProduct(id, overrides = {}) {
  return Object.assign({
    _id: id,
    teamId: TEAM_ID,
    status: 'active',
    name: '测试产品',
    normalizedName: '测试产品',
    productCode: 'RA1809010',
    normalizedCode: 'ra1809010',
    category: '工具',
    unit: '个',
    brand: '口袋',
    specification: '标准型',
    searchKeywords: ['测试产品', 'ra1809010', '工具'],
    coverType: 'text',
    coverText: '测',
    coverEmoji: '',
    coverAssetKey: '',
    coverFileId: '',
    coverBackground: '#EAF6EF',
    version: 1
  }, overrides);
}

function createWarehouseProduct(id, product, updatedAt, overrides = {}) {
  return Object.assign({
    _id: id,
    teamId: product.teamId,
    warehouseId: WAREHOUSE_ID,
    productId: product._id,
    status: 'active',
    stock: 12,
    minStock: 2,
    stockStatus: 'normal',
    stockVersion: 1,
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
    coverSummarySnapshot: { type: 'text', text: '测', background: '#EAF6EF' },
    updatedAt
  }, overrides);
}

function createFixture(role = 'owner') {
  const first = createProduct('product_search_ra_001');
  const second = createProduct('product_search_ra_002', {
    name: '备用型号',
    normalizedName: '备用型号',
    productCode: 'XB1809011',
    normalizedCode: 'xb1809011'
  });
  const chinese = createProduct('product_search_cn_001', {
    name: '工业扳手',
    normalizedName: '工业扳手',
    productCode: 'TOOL-001',
    normalizedCode: 'tool-001',
    specification: '12 MM',
    searchKeywords: buildSearchKeywords({
      name: '工业扳手',
      productCode: 'TOOL-001',
      category: '工具',
      brand: '口袋',
      specification: '12 MM'
    })
  });
  const specification = createProduct('product_search_spec_01', {
    name: '规格型号产品',
    normalizedName: '规格型号产品',
    productCode: '',
    normalizedCode: '',
    specification: 'RA-180-9010',
    searchKeywords: ['规格型号产品', 'ra-180-9010']
  });
  const foreign = createProduct('product_search_foreign', {
    teamId: OTHER_TEAM_ID,
    name: '其他团队产品'
  });
  const allProducts = [first, second, chinese, specification, foreign];
  const now = Date.UTC(2026, 6, 18, 10, 0, 0);
  const warehouseProducts = [
    createWarehouseProduct('warehouse_product_ra_001', first, new Date(now + 5000)),
    createWarehouseProduct('warehouse_product_ra_002', second, new Date(now + 4000), {
      stock: 1,
      minStock: 2,
      stockStatus: 'low'
    }),
    createWarehouseProduct('warehouse_product_cn_001', chinese, new Date(now + 3000), {
      stock: 0,
      stockStatus: 'out'
    }),
    createWarehouseProduct('warehouse_product_spec_1', specification, new Date(now + 2000)),
    createWarehouseProduct('warehouse_product_other_wh', first, new Date(now + 1000), {
      warehouseId: OTHER_WAREHOUSE_ID
    }),
    createWarehouseProduct('warehouse_product_foreign', foreign, new Date(now), {
      teamId: OTHER_TEAM_ID
    })
  ];
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
      status: 'active'
    }]]),
    warehouses: new Map([
      [WAREHOUSE_ID, { _id: WAREHOUSE_ID, teamId: TEAM_ID, status: 'active' }],
      [OTHER_WAREHOUSE_ID, { _id: OTHER_WAREHOUSE_ID, teamId: TEAM_ID, status: 'active' }]
    ]),
    products: new Map(allProducts.map((item) => [item._id, item])),
    warehouse_products: new Map(warehouseProducts.map((item) => [item._id, item])),
    product_image_assets: new Map()
  };
  const queryCalls = [];

  const command = {
    gte: (value) => operation('gte', value),
    lt: (value) => operation('lt', value),
    eq: (value) => operation('eq', value),
    in: (value) => operation('in', value),
    or: (branches) => ({ __operation: 'or', branches })
  };

  function collection(name) {
    const store = documents[name] || new Map();
    return {
      doc(id) {
        return {
          async get() {
            return { data: store.get(id) || null };
          },
          async update({ data }) {
            const current = store.get(id);
            if (!current) throw new Error('document not found');
            store.set(id, Object.assign({}, current, data));
            return { stats: { updated: 1 } };
          }
        };
      },
      where(where) {
        const query = { collection: name, where, orders: [], limit: null };
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
          async get() {
            queryCalls.push(query);
            let rows = Array.from(store.values()).filter((item) => matchesWhere(item, where));
            rows.sort((left, right) => {
              for (const order of query.orders) {
                const factor = order.direction === 'desc' ? -1 : 1;
                if (left[order.field] < right[order.field]) return -1 * factor;
                if (left[order.field] > right[order.field]) return factor;
              }
              return 0;
            });
            if (query.limit !== null) rows = rows.slice(0, query.limit);
            return { data: rows };
          }
        };
        return api;
      }
    };
  }

  return {
    db: { command, collection },
    user: documents.users.get(USER_ID),
    documents,
    queryCalls
  };
}

async function expectCode(action, code) {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.strictEqual(caught.code, code);
}

function testNormalizationAndTokens() {
  [
    'RA1809010',
    'ra1809010',
    'RA-180-9010',
    'RA 180 9010',
    'ＲＡ１８０９０１０',
    'RA_180/9010',
    'RA\\180.9010',
    'RA·1809010'
  ].forEach((value) => assert.strictEqual(normalizeSearchText(value), 'ra1809010'));
  const keywords = buildSearchKeywords({
    name: '工业 扳手',
    productCode: 'RA1809010',
    category: '工具',
    brand: '口袋',
    specification: 'SPEC-1809010'
  });
  ['180', '1809', '1809010', 'ra180', 'ra1809010'].forEach((token) => {
    assert.ok(keywords.includes(token), token);
  });
  assert.strictEqual(keywords.includes('1810'), false);
  assert.strictEqual(keywords.includes('r901'), false);
  assert.ok(keywords.includes('工业 扳手'));
  assert.ok(keywords.includes('工业扳手'));
  assert.ok(keywords.includes('spec1809010'));
  assert.ok(keywords.length <= SEARCH_KEYWORD_LIMIT);
  assert.strictEqual(SEARCH_FRAGMENT_MAX_LENGTH, 20);
  assert.strictEqual(SEARCH_FRAGMENT_LIMIT_PER_FIELD, 40);
}

function testQueryShape() {
  const input = validateProductListInput({
    keyword: ' RA-180 ',
    category: '工具',
    stockStatus: 'low'
  });
  assert.strictEqual(input.keyword, 'ra-180');
  assert.strictEqual(input.searchToken, 'ra180');
  const command = {
    gte: (value) => operation('gte', value),
    lt: (value) => operation('lt', value),
    eq: (value) => operation('eq', value),
    or: (branches) => ({ __operation: 'or', branches })
  };
  const where = buildProductListWhere(command, input, {
    team: { _id: TEAM_ID },
    warehouse: { _id: WAREHOUSE_ID }
  });
  assert.strictEqual(where.branches.length, 3);
  assert.ok(where.branches.every((branch) => {
    return branch.teamId === TEAM_ID &&
      branch.warehouseId === WAREHOUSE_ID &&
      branch.status === 'active' &&
      branch.categorySnapshot === '工具' &&
      branch.stockStatus === 'low';
  }));
  assert.ok(where.branches.some((branch) => branch.searchKeywordsSnapshot === 'ra180'));
}

async function rebuildAll(fixture, pageSize = 2) {
  let cursor;
  let batches = 0;
  do {
    const result = await rebuildProductSearch(fixture.db, fixture.user, { cursor, pageSize });
    cursor = result.nextCursor;
    batches += 1;
    assert.ok(batches < 10);
  } while (cursor);
}

async function testHistoricalRebuildAndSearch() {
  const fixture = createFixture();
  const before = await listProducts(fixture.db, fixture.user, { keyword: '180', pageSize: 20 }, {});
  assert.strictEqual(before.items.length, 0);

  await rebuildAll(fixture);
  const firstProduct = fixture.documents.products.get('product_search_ra_001');
  const firstWarehouse = fixture.documents.warehouse_products.get('warehouse_product_ra_001');
  assert.ok(firstProduct.searchKeywords.includes('180'));
  assert.ok(firstWarehouse.searchKeywordsSnapshot.includes('180'));
  assert.strictEqual(firstProduct.version, 1);
  assert.strictEqual(firstWarehouse.stock, 12);
  assert.strictEqual(firstWarehouse.stockVersion, 1);

  const writesBeforeRetry = JSON.stringify(Array.from(fixture.documents.products.entries())) +
    JSON.stringify(Array.from(fixture.documents.warehouse_products.entries()));
  await rebuildAll(fixture, 50);
  const writesAfterRetry = JSON.stringify(Array.from(fixture.documents.products.entries())) +
    JSON.stringify(Array.from(fixture.documents.warehouse_products.entries()));
  assert.strictEqual(writesAfterRetry, writesBeforeRetry);

  for (const keyword of [
    '180', '1809', '1809010', 'ra180', 'RA180', 'ra1809010', 'RA-180', 'RA 180 9010'
  ]) {
    const result = await listProducts(fixture.db, fixture.user, { keyword, pageSize: 20 }, {});
    assert.ok(result.items.some((item) => item.productCode === 'RA1809010'), keyword);
  }
  for (const keyword of ['1810', 'R901']) {
    const result = await listProducts(fixture.db, fixture.user, { keyword, pageSize: 20 }, {});
    assert.strictEqual(result.items.some((item) => item.productCode === 'RA1809010'), false);
  }

  const specification = await listProducts(
    fixture.db,
    fixture.user,
    { keyword: '1809010', pageSize: 20 },
    {}
  );
  assert.ok(specification.items.some((item) => item.name === '规格型号产品'));

  const chinese = await listProducts(fixture.db, fixture.user, { keyword: '工业', pageSize: 20 }, {});
  assert.strictEqual(chinese.items.length, 1);
  assert.strictEqual(chinese.items[0].name, '工业扳手');

  const category = await listProducts(fixture.db, fixture.user, {
    keyword: '180',
    category: '工具',
    stockStatus: 'low',
    pageSize: 20
  }, {});
  assert.strictEqual(category.items.length, 1);
  assert.strictEqual(category.items[0].productCode, 'XB1809011');
  for (const stockStatus of ['normal', 'low']) {
    const result = await listProducts(fixture.db, fixture.user, {
      keyword: '180',
      stockStatus,
      pageSize: 20
    }, {});
    assert.ok(result.items.length >= 1);
    assert.ok(result.items.every((item) => item.stockStatus === stockStatus));
  }
  const out = await listProducts(fixture.db, fixture.user, {
    keyword: '工业',
    stockStatus: 'out',
    pageSize: 20
  }, {});
  assert.strictEqual(out.items.length, 1);

  const firstPage = await listProducts(fixture.db, fixture.user, {
    keyword: '180',
    pageSize: 1
  }, {});
  const secondPage = await listProducts(fixture.db, fixture.user, {
    keyword: '180',
    pageSize: 1,
    cursor: firstPage.nextCursor
  }, {});
  assert.strictEqual(firstPage.items.length, 1);
  assert.strictEqual(secondPage.items.length, 1);
  assert.notStrictEqual(firstPage.items[0].id, secondPage.items[0].id);
  await expectCode(() => listProducts(fixture.db, fixture.user, {
    keyword: '工业',
    pageSize: 1,
    cursor: firstPage.nextCursor
  }, {}), ERROR_CODES.INVALID_CURSOR);

  const emptySearch = await listProducts(fixture.db, fixture.user, {
    keyword: '   ',
    pageSize: 20
  }, {});
  assert.strictEqual(emptySearch.items.length, 4);

  const productQueries = fixture.queryCalls.filter((item) => item.collection === 'products');
  assert.ok(productQueries.length > 0);
  assert.ok(productQueries.every((query) => query.where._id.__operation === 'in'));
}

async function testRolesAndScope() {
  for (const role of ['owner', 'admin', 'viewer']) {
    const fixture = createFixture(role);
    if (role === 'viewer') {
      await expectCode(
        () => rebuildProductSearch(fixture.db, fixture.user, { pageSize: 20 }),
        ERROR_CODES.FORBIDDEN
      );
      fixture.documents.products.forEach((product) => {
        product.searchKeywords = buildSearchKeywords(product);
      });
      fixture.documents.warehouse_products.forEach((warehouseProduct) => {
        const product = fixture.documents.products.get(warehouseProduct.productId);
        if (product) warehouseProduct.searchKeywordsSnapshot = buildSearchKeywords(product);
      });
    } else {
      await rebuildAll(fixture, 50);
    }
    const result = await listProducts(fixture.db, fixture.user, { keyword: '180', pageSize: 20 }, {});
    assert.ok(result.items.length >= 2);
    assert.ok(result.items.every((item) => item.productCode !== 'RA1809010' ||
      item.id === 'warehouse_product_ra_001'));
    assert.strictEqual(result.items.some((item) => item.id === 'warehouse_product_other_wh'), false);
    assert.strictEqual(result.items.some((item) => item.id === 'warehouse_product_foreign'), false);
  }
}

function testEditAndStaticBoundaries() {
  const oldMetadata = buildSearchMetadata(createProduct('product_edit_old'));
  const nextMetadata = buildSearchMetadata(createProduct('product_edit_new', {
    productCode: 'ZX7770001'
  }));
  assert.ok(oldMetadata.searchKeywords.includes('180'));
  assert.strictEqual(nextMetadata.searchKeywords.includes('180'), false);
  assert.ok(nextMetadata.searchKeywords.includes('777'));

  const root = path.resolve(__dirname, '..');
  const inventory = fs.readFileSync(
    path.join(root, 'miniprogram/pages/inventory/inventory.js'),
    'utf8'
  );
  const service = fs.readFileSync(
    path.join(root, 'cloudfunctions/warehouse-api/modules/product/product-service.js'),
    'utf8'
  );
  const router = fs.readFileSync(path.join(root, 'cloudfunctions/warehouse-api/router.js'), 'utf8');
  const indexes = fs.readFileSync(path.join(root, 'database/indexes.md'), 'utf8');
  assert.ok(inventory.includes('SEARCH_DEBOUNCE_MS'));
  assert.ok(inventory.includes('productService.listProducts'));
  assert.strictEqual(inventory.includes('.filter('), false);
  assert.ok(service.includes('searchKeywordsSnapshot: input.searchToken'));
  assert.ok(service.includes('db.command.in(productIds)'));
  assert.strictEqual(service.includes('new RegExp'), false);
  assert.ok(router.includes("'product.search.rebuild': productSearchRebuild"));
  assert.strictEqual(indexes.includes('stage2c4a1'), false);
}

async function run() {
  testNormalizationAndTokens();
  testQueryShape();
  await testHistoricalRebuildAndSearch();
  await testRolesAndScope();
  testEditAndStaticBoundaries();
  console.log('stage2c4a1 tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
