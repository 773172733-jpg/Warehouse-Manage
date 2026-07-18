const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  presentWarehouseProduct
} = require('../cloudfunctions/warehouse-api/common/product-utils.js');
const {
  loadProductCoverSources
} = require('../cloudfunctions/warehouse-api/modules/product/product-service.js');
const productView = require('../miniprogram/utils/product-view.js');

function createWarehouseProduct(id, coverSummarySnapshot) {
  return {
    _id: id,
    teamId: 'team_12345678',
    productId: `product_${id}`,
    productNameSnapshot: `产品${id}`,
    productCodeSnapshot: `CODE-${id}`,
    categorySnapshot: '其他',
    unitSnapshot: '个',
    brandSnapshot: '',
    specificationSnapshot: '',
    coverSummarySnapshot,
    stock: 5,
    minStock: 2,
    stockVersion: 1,
    productVersion: 1,
    updatedAt: '2026-07-18T00:00:00.000Z'
  };
}

function mapPresented(id, coverSummarySnapshot, imageAccess) {
  const response = presentWarehouseProduct(
    createWarehouseProduct(id, coverSummarySnapshot),
    imageAccess
  );
  return {
    response,
    view: productView.mapInventoryItem(response)
  };
}

function testProductListPresentationAndViewMapping() {
  ['📦', '▦', '🛢️', '🧱', '🧿'].forEach((emoji, index) => {
    const result = mapPresented(`warehouse_emoji_${index}`, {
      type: 'emoji',
      emoji,
      background: '#F7F2E8'
    });
    assert.strictEqual(result.response.cover.type, 'emoji');
    assert.strictEqual(result.response.cover.emoji, emoji);
    assert.strictEqual(result.view.cover.type, 'emoji');
    assert.strictEqual(result.view.cover.emoji, emoji);
    assert.strictEqual(result.view.cover.content, emoji);
  });

  const text = mapPresented('warehouse_text_123', {
    type: 'text',
    text: '瓷砖',
    background: '#EAF6EF'
  }).view;
  assert.strictEqual(text.cover.type, 'text');
  assert.strictEqual(text.cover.text, '瓷砖');

  const none = mapPresented('warehouse_none_123', {
    type: 'none'
  }).view;
  assert.strictEqual(none.cover.type, 'none');
  assert.strictEqual(none.cover.fallback, '产');

  const image = mapPresented('warehouse_image_123', {
    type: 'image',
    background: '#F2F4F2'
  }, {
    imageAvailable: true,
    imageUrl: 'https://example.test/product.jpg',
    imageUrlExpiresAt: '2026-07-19T00:00:00.000Z'
  }).view;
  assert.strictEqual(image.cover.type, 'image');
  assert.strictEqual(image.cover.imageAvailable, true);
  assert.strictEqual(image.cover.imageUrl, 'https://example.test/product.jpg');
  assert.strictEqual(image.cover.imageFailed, false);

  const unavailableImage = mapPresented('warehouse_unavailable_123', {
    type: 'image'
  }).view;
  assert.strictEqual(unavailableImage.cover.type, 'image');
  assert.strictEqual(unavailableImage.cover.imageAvailable, false);
  assert.strictEqual(unavailableImage.cover.imageUrl, '');

  const invalid = mapPresented('warehouse_invalid_123', {
    type: 'legacy-invalid',
    emoji: '📦'
  }).view;
  assert.strictEqual(invalid.cover.type, 'none');
  assert.strictEqual(invalid.cover.fallback, '产');

  const staleWarehouseProduct = createWarehouseProduct('warehouse_stale_123', {
    type: 'none'
  });
  const authoritativeProduct = {
    _id: staleWarehouseProduct.productId,
    teamId: staleWarehouseProduct.teamId,
    status: 'active',
    coverType: 'emoji',
    coverText: '',
    coverEmoji: '🚕',
    coverBackground: '#F7F2E8'
  };
  const repairedResponse = presentWarehouseProduct(
    staleWarehouseProduct,
    null,
    authoritativeProduct
  );
  assert.strictEqual(repairedResponse.cover.type, 'emoji');
  assert.strictEqual(repairedResponse.cover.emoji, '🚕');
  const fallbackResponse = presentWarehouseProduct(staleWarehouseProduct);
  assert.strictEqual(fallbackResponse.cover.type, 'none');
}

async function testBatchProductCoverSources() {
  const calls = [];
  const products = [{
    _id: 'product_warehouse_batch_one',
    teamId: 'team_12345678',
    status: 'active',
    coverType: 'emoji',
    coverEmoji: '🚕'
  }, {
    _id: 'product_warehouse_batch_two',
    teamId: 'team_other_12345678',
    status: 'active',
    coverType: 'emoji',
    coverEmoji: '📦'
  }];
  const db = {
    command: {
      in(values) {
        calls.push({ type: 'in', values });
        return { values };
      }
    },
    collection(name) {
      assert.strictEqual(name, 'products');
      calls.push({ type: 'collection' });
      return {
        where() {
          calls.push({ type: 'where' });
          return {
            limit(value) {
              calls.push({ type: 'limit', value });
              return {
                field() {
                  calls.push({ type: 'field' });
                  return {
                    async get() {
                      calls.push({ type: 'get' });
                      return { data: products };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  const warehouseProducts = [{
    productId: 'product_warehouse_batch_one'
  }, {
    productId: 'product_warehouse_batch_one'
  }, {
    productId: 'product_warehouse_batch_two'
  }];
  const result = await loadProductCoverSources(
    db,
    'team_12345678',
    warehouseProducts
  );
  assert.strictEqual(calls.filter((call) => call.type === 'get').length, 1);
  assert.deepStrictEqual(calls.find((call) => call.type === 'in').values, [
    'product_warehouse_batch_one',
    'product_warehouse_batch_two'
  ]);
  assert.strictEqual(result.size, 1);
  assert.strictEqual(result.get('product_warehouse_batch_one').coverEmoji, '🚕');
}

function testImageFailureIsolation() {
  const image = productView.getCoverView({
    type: 'image',
    imageAvailable: true,
    imageUrl: 'https://example.test/product.jpg'
  }, '图片产品');
  const failed = productView.markCoverImageFailed(image, '图片产品');
  assert.strictEqual(failed.type, 'image');
  assert.strictEqual(failed.imageAvailable, false);
  assert.strictEqual(failed.imageFailed, true);
  assert.strictEqual(failed.imageUrl, '');
  assert.strictEqual(failed.fallback, '图');

  const emoji = productView.getCoverView({ type: 'emoji', emoji: '📦' }, '贴图产品');
  const text = productView.getCoverView({ type: 'text', text: '瓷砖' }, '文字产品');
  assert.deepStrictEqual(productView.markCoverImageFailed(emoji, '贴图产品'), emoji);
  assert.deepStrictEqual(productView.markCoverImageFailed(text, '文字产品'), text);
}

function testListInteractionsPreserveCovers() {
  const firstPage = ['📦', '▦'].map((emoji, index) => mapPresented(
    `warehouse_page_one_${index}`,
    { type: 'emoji', emoji }
  ).view);
  const secondPage = ['🛢️', '🧱'].map((emoji, index) => mapPresented(
    `warehouse_page_two_${index}`,
    { type: 'emoji', emoji }
  ).view);
  const merged = productView.mergeInventoryItems(firstPage, secondPage);
  assert.deepStrictEqual(merged.map((item) => item.cover.emoji), ['📦', '▦', '🛢️', '🧱']);

  assert.deepStrictEqual(productView.buildListParams({
    keyword: '  瓷砖  ',
    selectedCategory: '建材',
    selectedStockStatus: 'low'
  }), {
    pageSize: 20,
    sort: 'updated_desc',
    keyword: '瓷砖',
    category: '建材',
    stockStatus: 'low',
    includeSummary: true
  });
  assert.deepStrictEqual(productView.buildListParams({
    keyword: 'CODE-001',
    selectedCategory: '全部',
    selectedStockStatus: ''
  }), {
    pageSize: 20,
    sort: 'updated_desc',
    keyword: 'CODE-001',
    includeSummary: true
  });
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(productView.buildListParams({}, null), 'cursor'),
    false
  );
}

function testInventoryTemplateBranches() {
  const root = path.resolve(__dirname, '..');
  const template = fs.readFileSync(
    path.join(root, 'miniprogram/pages/inventory/inventory.wxml'),
    'utf8'
  );
  const page = fs.readFileSync(
    path.join(root, 'miniprogram/pages/inventory/inventory.js'),
    'utf8'
  );
  assert.ok(template.includes("item.cover.type==='image' && item.cover.imageAvailable"));
  assert.ok(template.includes('mode="aspectFill"'));
  assert.ok(template.includes("item.cover.type==='emoji' && item.cover.emoji"));
  assert.ok(template.includes('{{item.cover.emoji}}'));
  assert.ok(template.includes("item.cover.type==='text' && item.cover.text"));
  assert.ok(template.includes('{{item.cover.text}}'));
  assert.ok(template.includes('{{item.cover.fallback}}'));
  assert.ok(page.includes("match.cover.type !== 'image'"));
  assert.ok(page.includes('productView.markCoverImageFailed'));
  assert.strictEqual(template.includes('cloud://'), false);
  assert.strictEqual(template.includes('getTempFileURL'), false);
}

function testInventoryImageErrorHandler() {
  const originalPage = global.Page;
  let config;
  global.Page = (pageConfig) => { config = pageConfig; };
  const pagePath = require.resolve('../miniprogram/pages/inventory/inventory.js');
  delete require.cache[pagePath];
  require(pagePath);
  try {
    const image = mapPresented('warehouse_handler_image', {
      type: 'image'
    }, {
      imageAvailable: true,
      imageUrl: 'https://example.test/product.jpg'
    }).view;
    const emoji = mapPresented('warehouse_handler_emoji', {
      type: 'emoji',
      emoji: '📦'
    }).view;
    const page = Object.assign({}, config, {
      pageActive: true,
      data: { items: [image, emoji] }
    });
    page.setData = (updates) => {
      Object.keys(updates).forEach((key) => {
        const match = /^items\[(\d+)\]\.cover$/.exec(key);
        if (match) page.data.items[Number(match[1])].cover = updates[key];
      });
    };

    page.onCoverImageError({
      currentTarget: { dataset: { warehouseProductId: image.warehouseProductId } }
    });
    assert.strictEqual(page.data.items[0].cover.type, 'image');
    assert.strictEqual(page.data.items[0].cover.imageFailed, true);
    assert.strictEqual(page.data.items[0].cover.imageUrl, '');

    page.onCoverImageError({
      currentTarget: { dataset: { warehouseProductId: emoji.warehouseProductId } }
    });
    assert.strictEqual(page.data.items[1].cover.type, 'emoji');
    assert.strictEqual(page.data.items[1].cover.emoji, '📦');
  } finally {
    global.Page = originalPage;
    delete require.cache[pagePath];
  }
}

async function run() {
  testProductListPresentationAndViewMapping();
  await testBatchProductCoverSources();
  testImageFailureIsolation();
  testListInteractionsPreserveCovers();
  testInventoryTemplateBranches();
  testInventoryImageErrorHandler();
  console.log('stage2c3c1c1 tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
