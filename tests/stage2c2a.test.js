const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ERROR_CODES, ApiError } = require('../cloudfunctions/warehouse-api/common/errors.js');
const { fail } = require('../cloudfunctions/warehouse-api/common/response.js');
const { requireRole } = require('../cloudfunctions/warehouse-api/common/permissions.js');
const { createMembershipId } = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const {
  PRODUCT_LIMIT,
  normalizeProductName,
  normalizeProductCode,
  buildSearchKeywords,
  sanitizeProductInput,
  createProductRequestHash,
  computeStockStatus,
  assertProductCountWithinLimit,
  encodeProductCursor,
  decodeProductCursor,
  validateProductListInput,
  getProductPermissionFlags,
  presentProduct,
  presentWarehouseProduct
} = require('../cloudfunctions/warehouse-api/common/product-utils.js');
const {
  buildProductDocument,
  buildWarehouseProductDocument,
  buildInitialRecordDocument,
  assertExistingCreate,
  buildProductListWhere,
  assertWarehouseProductAccess,
  assertProductAccess,
  requireProductAccess,
  getProductDetail
} = require('../cloudfunctions/warehouse-api/modules/product/product-service.js');
const {
  createProduct: createCloudProduct
} = require('../cloudfunctions/warehouse-api/modules/product/product-service.js');
const productService = require('../miniprogram/services/product-service.js');

const VALID_REQUEST_KEY = 'product_request_123456';

function expectCode(callback, code) {
  assert.throws(callback, (error) => error instanceof ApiError && error.code === code);
}

function createInput(overrides = {}) {
  return Object.assign({
    name: '  工业 扳手  ',
    productCode: '  Tool  001 ',
    category: '工具',
    unit: '把',
    brand: '轻仓',
    specification: '12 mm',
    description: '常用工具',
    coverType: 'text',
    coverText: '扳手',
    coverBackground: '#EAF6EF',
    minStock: 5,
    initialStock: 8,
    requestKey: VALID_REQUEST_KEY
  }, overrides);
}

function createDocumentContext(requestHash) {
  return {
    teamId: 'team_12345678',
    warehouseId: 'warehouse_12345678',
    userId: 'user_12345678',
    membershipId: 'member_12345678',
    operatorName: '测试用户',
    requestHash,
    now: new Date('2026-07-16T00:00:00.000Z')
  };
}

function testNormalizationAndValidation() {
  assert.strictEqual(normalizeProductName('  ＡBC   工具 '), 'abc 工具');
  assert.strictEqual(normalizeProductCode('  Tool  001 '), 'tool 001');

  const input = sanitizeProductInput(Object.assign(createInput(), {
    normalizedName: 'forged',
    normalizedCode: 'forged',
    searchKeywords: ['forged']
  }));
  assert.strictEqual(input.name, '工业 扳手');
  assert.strictEqual(input.normalizedName, '工业 扳手');
  assert.strictEqual(input.normalizedCode, 'tool 001');
  assert.strictEqual(input.searchKeywords.includes('forged'), false);
  assert.ok(input.searchKeywords.includes('工具'));
  assert.ok(input.searchKeywords.length <= 10);
  assert.ok(input.searchKeywords.every((keyword) => Array.from(keyword).length <= 20));

  expectCode(() => sanitizeProductInput(createInput({ name: '' })), ERROR_CODES.INVALID_PRODUCT_NAME);
  expectCode(() => sanitizeProductInput(createInput({ productCode: 'x'.repeat(41) })), ERROR_CODES.INVALID_PRODUCT_CODE);
  expectCode(() => sanitizeProductInput(createInput({ category: 'x'.repeat(21) })), ERROR_CODES.INVALID_CATEGORY);
  expectCode(() => sanitizeProductInput(createInput({ unit: 'x'.repeat(11) })), ERROR_CODES.INVALID_UNIT);
  expectCode(() => sanitizeProductInput(createInput({ brand: 'x'.repeat(41) })), ERROR_CODES.INVALID_BRAND);
  expectCode(() => sanitizeProductInput(createInput({ specification: 'x'.repeat(81) })), ERROR_CODES.INVALID_SPECIFICATION);
  expectCode(() => sanitizeProductInput(createInput({ description: 'x'.repeat(201) })), ERROR_CODES.INVALID_DESCRIPTION);
  expectCode(() => sanitizeProductInput(createInput({ initialStock: -1 })), ERROR_CODES.INVALID_STOCK_QUANTITY);
  expectCode(() => sanitizeProductInput(createInput({ minStock: 1.5 })), ERROR_CODES.INVALID_MIN_STOCK);
  expectCode(() => sanitizeProductInput(createInput({ teamId: 'forged' })), ERROR_CODES.FORBIDDEN);
  expectCode(() => sanitizeProductInput(createInput({ stockStatus: 'normal' })), ERROR_CODES.FORBIDDEN);
  expectCode(() => sanitizeProductInput(createInput({ coverType: 'image', coverFileId: 'cloud://forged' })), ERROR_CODES.INVALID_COVER);
}

function testKeywordsAndStockStatus() {
  const keywords = buildSearchKeywords({
    name: '扳手 扳手',
    productCode: 'ABC',
    category: '工具',
    brand: 'ABC',
    specification: '12 MM'
  });
  assert.strictEqual(new Set(keywords).size, keywords.length);
  assert.ok(keywords.includes('abc'));
  assert.ok(keywords.includes('工具'));
  assert.ok(keywords.includes('12 mm'));
  assert.ok(keywords.length <= 10);
  assert.strictEqual(computeStockStatus(0, 0), 'out');
  assert.strictEqual(computeStockStatus(1, 1), 'low');
  assert.strictEqual(computeStockStatus(2, 1), 'normal');
  assert.strictEqual(computeStockStatus(1, 0), 'normal');
}

function testDocumentsAndIdempotency() {
  const input = sanitizeProductInput(createInput());
  const requestHash = createProductRequestHash(input);
  const sameHash = createProductRequestHash(sanitizeProductInput(createInput()));
  const otherHash = createProductRequestHash(sanitizeProductInput(createInput({ initialStock: 9 })));
  assert.strictEqual(requestHash, sameHash);
  assert.notStrictEqual(requestHash, otherHash);

  const context = createDocumentContext(requestHash);
  const product = Object.assign({ _id: 'product_12345678' }, buildProductDocument(input, context));
  const warehouseProduct = Object.assign({ _id: 'warehouse_product_12345678' },
    buildWarehouseProductDocument(input, product._id, context));
  const initialRecord = Object.assign({ _id: 'stock_record_12345678' },
    buildInitialRecordDocument(input, product._id, warehouseProduct._id, context));
  assert.strictEqual(product.warehouseId, undefined);
  assert.strictEqual(product.stock, undefined);
  assert.strictEqual(warehouseProduct.stock, 8);
  assert.strictEqual(warehouseProduct.stockStatus, 'normal');
  assert.strictEqual(initialRecord.beforeStock, 0);
  assert.strictEqual(initialRecord.afterStock, 8);
  assert.strictEqual(initialRecord.changeQuantity, 8);
  assert.ok(initialRecord.changeQuantity > 0);
  assert.strictEqual(buildInitialRecordDocument(
    sanitizeProductInput(createInput({ initialStock: 0 })),
    product._id,
    warehouseProduct._id,
    context
  ), null);

  assert.doesNotThrow(() => assertExistingCreate(
    product,
    warehouseProduct,
    initialRecord,
    input,
    requestHash
  ));
  expectCode(() => assertExistingCreate(
    product,
    warehouseProduct,
    initialRecord,
    input,
    otherHash
  ), ERROR_CODES.REQUEST_KEY_CONFLICT);
}

function testLimitRolesAndPermissions() {
  assert.strictEqual(assertProductCountWithinLimit(undefined), 0);
  assert.strictEqual(assertProductCountWithinLimit(PRODUCT_LIMIT - 1), PRODUCT_LIMIT - 1);
  expectCode(() => assertProductCountWithinLimit(PRODUCT_LIMIT), ERROR_CODES.PRODUCT_LIMIT_REACHED);

  assert.doesNotThrow(() => requireRole({ role: 'owner', status: 'active' }, 'admin'));
  assert.doesNotThrow(() => requireRole({ role: 'admin', status: 'active' }, 'admin'));
  expectCode(() => requireRole({ role: 'viewer', status: 'active' }, 'admin'), ERROR_CODES.FORBIDDEN);
  expectCode(() => requireRole({ role: 'admin', status: 'pending' }, 'viewer'), ERROR_CODES.MEMBERSHIP_NOT_ACTIVE);
  expectCode(() => requireRole({ role: 'admin', status: 'removed' }, 'viewer'), ERROR_CODES.MEMBERSHIP_NOT_ACTIVE);
  assert.deepStrictEqual(getProductPermissionFlags('viewer'), {
    canEdit: false,
    canOperateStock: false,
    canRemove: false
  });
  assert.strictEqual(getProductPermissionFlags('admin').canEdit, true);
  assert.strictEqual(getProductPermissionFlags('owner').canRemove, true);
}

function testResourceScopeChecks() {
  const access = {
    team: { _id: 'team_12345678' },
    warehouse: { _id: 'warehouse_12345678' }
  };
  const warehouseProduct = {
    teamId: 'team_12345678',
    warehouseId: 'warehouse_12345678',
    productId: 'product_12345678',
    status: 'active'
  };
  assert.strictEqual(
    assertWarehouseProductAccess(warehouseProduct, access, 'product_12345678'),
    warehouseProduct
  );
  expectCode(() => assertWarehouseProductAccess(Object.assign({}, warehouseProduct, {
    warehouseId: 'warehouse_other'
  }), access, 'product_12345678'), ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE);
  expectCode(() => assertWarehouseProductAccess(Object.assign({}, warehouseProduct, {
    status: 'removed'
  }), access, 'product_12345678'), ERROR_CODES.PRODUCT_NOT_IN_WAREHOUSE);
  assert.strictEqual(assertProductAccess({
    teamId: 'team_12345678',
    status: 'active'
  }, 'team_12345678').status, 'active');
  expectCode(() => assertProductAccess({
    teamId: 'team_other',
    status: 'active'
  }, 'team_12345678'), ERROR_CODES.PRODUCT_NOT_FOUND);
}

function testPaginationAndResponseWhitelists() {
  assert.strictEqual(validateProductListInput({}).pageSize, 20);
  assert.strictEqual(validateProductListInput({ pageSize: 50 }).pageSize, 50);
  expectCode(() => validateProductListInput({ pageSize: 51 }), ERROR_CODES.INVALID_PAGE_SIZE);
  expectCode(() => decodeProductCursor('%%%'), ERROR_CODES.INVALID_CURSOR);
  const cursor = encodeProductCursor({
    _id: 'warehouse_product_12345678',
    updatedAt: new Date('2026-07-16T01:02:03.000Z')
  });
  const decoded = decodeProductCursor(cursor);
  assert.strictEqual(decoded.id, 'warehouse_product_12345678');
  assert.strictEqual(decoded.updatedAt.toISOString(), '2026-07-16T01:02:03.000Z');

  const input = sanitizeProductInput(createInput());
  const requestHash = createProductRequestHash(input);
  const context = createDocumentContext(requestHash);
  const product = Object.assign({
    _id: 'product_12345678',
    openId: 'secret',
    requestKey: VALID_REQUEST_KEY
  }, buildProductDocument(input, context));
  const warehouseProduct = Object.assign({
    _id: 'warehouse_product_12345678',
    openId: 'secret'
  }, buildWarehouseProductDocument(input, product._id, context));
  const presented = {
    product: presentProduct(product),
    warehouseProduct: presentWarehouseProduct(warehouseProduct)
  };
  const serialized = JSON.stringify(presented);
  ['openId', 'teamId', 'warehouseId', 'requestKey', 'requestHash', 'createdBy'].forEach((field) => {
    assert.strictEqual(serialized.includes(field), false);
  });
  const errorResponse = fail(ERROR_CODES.INVALID_PRODUCT_NAME, '名称无效', 'req_12345678');
  assert.deepStrictEqual(errorResponse.error, {
    code: ERROR_CODES.INVALID_PRODUCT_NAME,
    message: '名称无效'
  });
  assert.strictEqual(errorResponse.success, false);
}

function testListQueryShape() {
  function operation(type, value) {
    return {
      type,
      value,
      and(other) {
        return { type: 'field-and', operations: [this, other] };
      }
    };
  }
  const command = {
    gte: (value) => operation('gte', value),
    lt: (value) => operation('lt', value),
    eq: (value) => operation('eq', value),
    or: (branches) => ({ type: 'or', branches })
  };
  const cursor = encodeProductCursor({
    _id: 'warehouse_product_12345678',
    updatedAt: new Date('2026-07-16T01:02:03.000Z')
  });
  const input = validateProductListInput({
    keyword: 'TOOL',
    category: '工具',
    stockStatus: 'low',
    cursor,
    pageSize: 20
  });
  const where = buildProductListWhere(command, input, {
    team: { _id: 'team_12345678' },
    warehouse: { _id: 'warehouse_12345678' }
  });
  assert.strictEqual(where.type, 'or');
  assert.strictEqual(where.branches.length, 6);
  assert.ok(where.branches.every((branch) => {
    return branch.teamId === 'team_12345678' &&
      branch.warehouseId === 'warehouse_12345678' &&
      branch.status === 'active' &&
      branch.categorySnapshot === '工具' &&
      branch.stockStatus === 'low';
  }));
  assert.ok(where.branches.some((branch) => branch.normalizedCodeSnapshot === 'tool'));
  assert.ok(where.branches.some((branch) => branch.normalizedNameSnapshot));
  assert.ok(where.branches.some((branch) => branch.searchKeywordsSnapshot === 'tool'));
}

function testClientPayloadWhitelistsAndStaticBoundaries() {
  const forged = Object.assign(createInput(), {
    teamId: 'forged-team',
    warehouseId: 'forged-warehouse',
    userId: 'forged-user',
    openId: 'forged-openid',
    role: 'owner',
    searchKeywords: ['forged'],
    normalizedName: 'forged',
    normalizedCode: 'forged'
  });
  const createPayload = productService.buildCreateProductPayload(forged);
  ['teamId', 'warehouseId', 'userId', 'openId', 'role', 'searchKeywords', 'normalizedName', 'normalizedCode']
    .forEach((field) => assert.strictEqual(Object.prototype.hasOwnProperty.call(createPayload, field), false));
  assert.strictEqual(createPayload.requestKey, VALID_REQUEST_KEY);
  assert.deepStrictEqual(productService.buildListProductsPayload(Object.assign({}, forged, {
    keyword: '扳手',
    pageSize: 20
  })), { keyword: '扳手', category: '工具', pageSize: 20 });
  assert.deepStrictEqual(productService.buildProductDetailPayload(Object.assign({}, forged, {
    productId: 'product_12345678'
  })), { productId: 'product_12345678' });

  const root = path.resolve(__dirname, '..');
  const serviceSource = fs.readFileSync(path.join(root, 'miniprogram/services/product-service.js'), 'utf8');
  const routerSource = fs.readFileSync(path.join(root, 'cloudfunctions/warehouse-api/router.js'), 'utf8');
  const productSource = fs.readFileSync(
    path.join(root, 'cloudfunctions/warehouse-api/modules/product/product-service.js'),
    'utf8'
  );
  assert.strictEqual(serviceSource.includes('wx.cloud'), false);
  assert.strictEqual(serviceSource.includes('.database('), false);
  assert.strictEqual(routerSource.includes("'product.create': productCreate"), true);
  assert.strictEqual(routerSource.includes("'product.list': productList"), true);
  assert.strictEqual(routerSource.includes("'product.detail': productDetail"), true);
  assert.strictEqual(productSource.includes('console.log'), false);
  assert.strictEqual(productSource.includes('console.info'), false);
  assert.strictEqual(productSource.includes('console.error'), false);
}

function createFakeDatabase(role) {
  const teamId = 'team_12345678';
  const warehouseId = 'warehouse_12345678';
  const userId = 'user_12345678';
  const membershipId = createMembershipId(teamId, userId);
  const documents = {
    users: new Map([[userId, {
      _id: userId,
      status: 'active',
      displayName: '测试用户',
      currentTeamId: teamId,
      currentWarehouseId: warehouseId
    }]]),
    teams: new Map([[teamId, {
      _id: teamId,
      status: 'active',
      defaultWarehouseId: warehouseId,
      activeProductCount: 0
    }]]),
    team_members: new Map([[membershipId, {
      _id: membershipId,
      teamId,
      userId,
      role,
      status: 'active'
    }]]),
    warehouses: new Map([[warehouseId, {
      _id: warehouseId,
      teamId,
      status: 'active'
    }]]),
    products: new Map(),
    warehouse_products: new Map(),
    stock_records: new Map()
  };

  function source() {
    return {
      collection(name) {
        const collection = documents[name];
        assert.ok(collection, `unknown collection ${name}`);
        return {
          doc(id) {
            return {
              async get() {
                return { data: collection.get(id) || null };
              },
              async set({ data }) {
                collection.set(id, Object.assign({ _id: id }, data));
              },
              async update({ data }) {
                const existing = collection.get(id);
                assert.ok(existing, `missing document ${name}/${id}`);
                collection.set(id, Object.assign({}, existing, data));
              }
            };
          }
        };
      }
    };
  }

  const db = source();
  db.serverDate = () => new Date('2026-07-16T00:00:00.000Z');
  db.runTransaction = async (callback) => callback(source());
  return {
    db,
    documents,
    user: documents.users.get(userId),
    teamId
  };
}

async function testCreateTransactionAndCloudPermissions() {
  for (const role of ['owner', 'admin']) {
    const fixture = createFakeDatabase(role);
    const first = await createCloudProduct(fixture.db, fixture.user, createInput());
    assert.strictEqual(first.idempotent, false);
    assert.strictEqual(fixture.documents.products.size, 1);
    assert.strictEqual(fixture.documents.warehouse_products.size, 1);
    assert.strictEqual(fixture.documents.stock_records.size, 1);
    assert.strictEqual(fixture.documents.teams.get(fixture.teamId).activeProductCount, 1);

    const productId = first.product.id;
    const membership = Array.from(fixture.documents.team_members.values())[0];
    membership.role = 'viewer';
    await requireProductAccess(fixture.db, fixture.user);
    const detail = await getProductDetail(fixture.db, fixture.user, { productId });
    assert.strictEqual(detail.product.id, productId);
    assert.strictEqual(detail.permissions.canEdit, false);
    membership.role = role;

    const retry = await createCloudProduct(fixture.db, fixture.user, createInput());
    assert.strictEqual(retry.idempotent, true);
    assert.strictEqual(fixture.documents.products.size, 1);
    assert.strictEqual(fixture.documents.stock_records.size, 1);
    assert.strictEqual(fixture.documents.teams.get(fixture.teamId).activeProductCount, 1);
    await assert.rejects(
      () => createCloudProduct(fixture.db, fixture.user, createInput({ name: '不同产品' })),
      (error) => error.code === ERROR_CODES.REQUEST_KEY_CONFLICT
    );
  }

  const viewer = createFakeDatabase('viewer');
  await assert.rejects(
    () => createCloudProduct(viewer.db, viewer.user, createInput()),
    (error) => error.code === ERROR_CODES.FORBIDDEN
  );
  assert.strictEqual(viewer.documents.products.size, 0);
}

async function run() {
  testNormalizationAndValidation();
  testKeywordsAndStockStatus();
  testDocumentsAndIdempotency();
  testLimitRolesAndPermissions();
  testResourceScopeChecks();
  testPaginationAndResponseWhitelists();
  testListQueryShape();
  testClientPayloadWhitelistsAndStaticBoundaries();
  await testCreateTransactionAndCloudPermissions();
  console.log('stage2c2a tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
