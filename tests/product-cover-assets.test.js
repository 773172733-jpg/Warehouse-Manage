const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { SYSTEM_ASSETS } = require('../miniprogram/constants/product-cover-assets.js');
const {
  OFFICIAL_COVER_EMOJIS,
  LEGACY_COVER_EMOJIS,
  COVER_EMOJIS
} = require('../cloudfunctions/warehouse-api/common/product-cover-constants.js');
const { ERROR_CODES, ApiError } = require('../cloudfunctions/warehouse-api/common/errors.js');
const {
  sanitizeProductInput,
  sanitizeProductUpdateInput,
  presentProduct
} = require('../cloudfunctions/warehouse-api/common/product-utils.js');
const editUtils = require('../miniprogram/pages/product-edit/product-create-utils.js');

const REQUEST_KEY = 'cover_asset_test_12345678';

function createServerInput(overrides = {}) {
  return Object.assign({
    name: '测试产品',
    productCode: '',
    category: '其他',
    unit: '个',
    brand: '',
    specification: '',
    description: '',
    coverType: 'emoji',
    coverText: '',
    coverEmoji: '📦',
    coverBackground: '#EAF6EF',
    minStock: 0,
    initialStock: 0,
    requestKey: REQUEST_KEY
  }, overrides);
}

function createEditForm(overrides = {}) {
  return Object.assign({
    coverMode: 'system',
    displayText: '',
    coverColor: '#EAF6EF',
    systemAssetKey: 'box',
    systemAssetEmoji: '📦',
    legacyFallback: false,
    name: '测试产品',
    code: '',
    category: '其他',
    unit: '个',
    customUnit: '',
    brand: '',
    specification: '',
    description: ''
  }, overrides);
}

function expectServerCode(input, code) {
  assert.throws(
    () => sanitizeProductInput(input),
    (error) => error instanceof ApiError && error.code === code
  );
}

function testFrontendCatalog() {
  const expected = [
    ['瓷砖', '▦'], ['胶袋', '🛍️'], ['水泥', '🪣'], ['木材', '🪵'],
    ['油漆', '🎨'], ['五金', '🔩'], ['工具', '🔧'], ['纸箱', '📦'],
    ['零食', '🍪'], ['饮料', '🥤'], ['水果', '🍎'], ['蔬菜', '🥬'], ['冷冻食品', '❄️'],
    ['卫浴', '🚿'], ['灯具', '💡'], ['家具', '🪑'], ['家电', '🔌'], ['清洁用品', '🧹'],
    ['电脑', '💻'], ['手机', '📱'], ['卡片', '💳'], ['相机', '📷'], ['文件', '📁'], ['书籍', '📚'],
    ['汽车', '🚗'], ['轮胎', '🛞'], ['零件', '⚙️'], ['电池', '🔋'], ['机油', '🛢️'],
    ['鞋子', '👟'], ['衣服', '👕'], ['裤子', '👖'], ['帽子', '🧢'], ['包袋', '🎒'],
    ['牛', '🐄'], ['猪', '🐖'], ['羊', '🐑'], ['鸡', '🐓'], ['鸭', '🦆'], ['鱼', '🐟'],
    ['办公', '📎'], ['耗材', '🪣']
  ];
  const actual = new Map(SYSTEM_ASSETS.map((asset) => [asset.label, asset.emoji]));
  expected.forEach(([label, emoji]) => assert.strictEqual(actual.get(label), emoji, label));
  assert.strictEqual(SYSTEM_ASSETS.length, expected.length);
  assert.strictEqual(new Set(SYSTEM_ASSETS.map((asset) => asset.key)).size, SYSTEM_ASSETS.length);
  assert.ok(SYSTEM_ASSETS.every((asset) => asset.key && asset.label && asset.emoji && asset.group));
  assert.strictEqual(actual.get('瓷砖'), '▦');
  assert.strictEqual(actual.get('水泥'), '🪣');
  assert.strictEqual(actual.get('机油'), '🛢️');
  assert.strictEqual(SYSTEM_ASSETS.some((asset) => asset.emoji === '🧱'), false);
}

function testFrontendAndServerConsistency() {
  const frontendEmojis = Array.from(new Set(SYSTEM_ASSETS.map((asset) => asset.emoji)));
  assert.strictEqual(new Set(OFFICIAL_COVER_EMOJIS).size, OFFICIAL_COVER_EMOJIS.length);
  assert.strictEqual(new Set(COVER_EMOJIS).size, COVER_EMOJIS.length);
  frontendEmojis.forEach((emoji) => {
    assert.ok(OFFICIAL_COVER_EMOJIS.includes(emoji), `server whitelist missing ${emoji}`);
    const sanitized = sanitizeProductInput(createServerInput({ coverEmoji: emoji }));
    assert.strictEqual(sanitized.coverType, 'emoji');
    assert.strictEqual(sanitized.coverEmoji, emoji);
    assert.strictEqual(sanitized.coverText, '');
    assert.strictEqual(sanitized.coverFileId, '');
  });
  assert.ok(LEGACY_COVER_EMOJIS.includes('🧱'));
  assert.ok(COVER_EMOJIS.includes('🧱'));
}

function testServerRejectionsAndOtherCoverModes() {
  ['普通文字', '😀😎', '🦄'].forEach((coverEmoji) => {
    expectServerCode(createServerInput({ coverEmoji }), ERROR_CODES.INVALID_COVER);
  });
  expectServerCode(createServerInput({ coverAssetKey: 'forged-tile' }), ERROR_CODES.FORBIDDEN);
  expectServerCode(createServerInput({ localImagePath: 'wxfile://temporary.jpg' }), ERROR_CODES.INVALID_COVER);
  expectServerCode(createServerInput({ coverFileId: 'cloud://forged.jpg' }), ERROR_CODES.INVALID_COVER);
  expectServerCode(createServerInput({
    coverType: 'image',
    coverEmoji: '',
    coverFileId: 'cloud://forged.jpg'
  }), ERROR_CODES.INVALID_COVER);
  expectServerCode(createServerInput({ coverBackground: '#000000' }), ERROR_CODES.INVALID_COVER);
  expectServerCode(createServerInput({ coverType: 'text', coverText: '超过六个字符了', coverEmoji: '' }), ERROR_CODES.INVALID_COVER);

  const none = sanitizeProductInput(createServerInput({
    coverType: 'none', coverText: 'forged', coverEmoji: '📦', coverBackground: '#000000'
  }));
  assert.deepStrictEqual({
    type: none.coverType,
    text: none.coverText,
    emoji: none.coverEmoji,
    fileId: none.coverFileId,
    background: none.coverBackground
  }, { type: 'none', text: '', emoji: '', fileId: '', background: '' });

  const text = sanitizeProductInput(createServerInput({
    coverType: 'text', coverText: '仓', coverEmoji: '', coverBackground: '#F7F2E8'
  }));
  assert.strictEqual(text.coverText, '仓');
  assert.strictEqual(text.coverEmoji, '');
  assert.strictEqual(text.coverFileId, '');
  assert.strictEqual(text.coverBackground, '#F7F2E8');

  const defaultText = sanitizeProductInput(createServerInput({
    name: '默认产品', coverType: 'text', coverText: '', coverEmoji: '', coverBackground: ''
  }));
  assert.strictEqual(defaultText.coverText, '默');
  assert.strictEqual(defaultText.coverBackground, '#EAF6EF');
}

function testLegacyCoverCompatibility() {
  const legacy = sanitizeProductInput(createServerInput({ coverEmoji: '🧱' }));
  assert.strictEqual(legacy.coverEmoji, '🧱');

  const unknownProduct = presentProduct({
    _id: 'product_12345678',
    name: '旧产品',
    coverType: 'emoji',
    coverText: '',
    coverEmoji: '🧿',
    coverBackground: '#EAF6EF',
    version: 1,
    status: 'active'
  });
  assert.strictEqual(unknownProduct.cover.emoji, '🧿');

  const oldForm = createEditForm({
    systemAssetKey: '',
    systemAssetEmoji: '🧿',
    legacyFallback: true,
    name: '只改产品名称'
  });
  const originalCover = { type: 'emoji', emoji: '🧿', background: '#EAF6EF' };
  assert.strictEqual(editUtils.isCoverUnchanged(oldForm, originalCover), true);
  const preserved = editUtils.buildUpdateProductPayload(oldForm, {
    productId: 'product_12345678',
    expectedVersion: 1,
    originalCover
  });
  assert.strictEqual(preserved.coverType, undefined);
  assert.strictEqual(preserved.coverEmoji, undefined);
  const serverUpdate = sanitizeProductUpdateInput(Object.assign({}, preserved, {
    requestKey: 'preserve_cover_12345678'
  }));
  assert.strictEqual(serverUpdate.preserveCover, true);

  const changed = editUtils.buildUpdateProductPayload(createEditForm({
    systemAssetKey: 'oil',
    systemAssetEmoji: '🛢️'
  }), {
    productId: 'product_12345678',
    expectedVersion: 1,
    originalCover
  });
  assert.strictEqual(changed.coverType, 'emoji');
  assert.strictEqual(changed.coverEmoji, '🛢️');
  assert.strictEqual(sanitizeProductUpdateInput(Object.assign({}, changed, {
    requestKey: 'replace_cover_12345678'
  })).coverEmoji, '🛢️');

  assert.throws(
    () => editUtils.buildUpdateProductPayload(Object.assign({}, oldForm, {
      coverColor: '#F7F2E8'
    }), {
      productId: 'product_12345678',
      expectedVersion: 1,
      originalCover
    }),
    (error) => error && error.code === 'INVALID_COVER'
  );

  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/product-edit/product-edit.wxml'),
    'utf8'
  );
  assert.ok(wxml.includes('form.systemAssetEmoji'));
  assert.ok(wxml.includes('未更换时将原样保留'));
}

function run() {
  testFrontendCatalog();
  testFrontendAndServerConsistency();
  testServerRejectionsAndOtherCoverModes();
  testLegacyCoverCompatibility();
  console.log('product cover asset tests passed');
}

run();
