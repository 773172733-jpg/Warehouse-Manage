const assert = require('assert');
const fs = require('fs');
const path = require('path');
const productImageService = require('../miniprogram/services/product-image-service.js');
const createUtils = require('../miniprogram/pages/product-edit/product-create-utils.js');
const { normalizeError } = require('../miniprogram/utils/error-handler.js');
const {
  resolveProductImageAccessUrls
} = require('../cloudfunctions/warehouse-api/common/product-image-access.js');

const ASSET_KEY = 'product_image_1234567890abcdef1234567890abcdef';
const PRODUCT_ID = 'product_12345678';
const TEAM_ID = 'team_12345678';
const FILE_ID = 'cloud://cloud1-d8gm59cz2be4e7c23.bucket/product-images/verified/a.jpg';

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function applySetData(target, updates) {
  Object.keys(updates).forEach((key) => {
    const parts = key.split('.');
    let cursor = target;
    parts.slice(0, -1).forEach((part) => { cursor = cursor[part]; });
    cursor[parts[parts.length - 1]] = updates[key];
  });
}

async function testExtensionlessLocalImageInspection() {
  const inspected = await productImageService.inspectLocalImage({
    filePath: 'wxfile://tmp_f6b32c',
    sizeBytes: 128,
    fileType: 'image'
  }, {
    getImageInfo: async (filePath) => {
      assert.strictEqual(filePath, 'wxfile://tmp_f6b32c');
      return { type: 'jpeg', width: 100, height: 100 };
    }
  });
  assert.deepStrictEqual(inspected, {
    filePath: 'wxfile://tmp_f6b32c',
    sizeBytes: 128,
    extension: 'jpg'
  });

  assert.strictEqual(productImageService.validateLocalImage({
    filePath: 'wxfile://tmp_without_suffix',
    sizeBytes: 128,
    extension: 'image/png'
  }).extension, 'png');
}

async function testStageDiagnosticsAndResponseParsing() {
  const stages = [];
  const staged = await productImageService.stageProductImage({
    filePath: 'wxfile://tmp_without_suffix',
    sizeBytes: 128,
    extension: 'jpg',
    stageRequestKey: 'prepare_request_123456',
    confirmRequestKey: 'confirm_request_123456',
    onStageChange: (stage) => stages.push(stage)
  }, {
    prepareProductImage: async (input) => {
      assert.strictEqual(input.extension, 'jpg');
      return {
        assetKey: ASSET_KEY,
        cloudPath: 'product-images/uploads/a.jpg',
        status: 'awaiting_upload'
      };
    },
    uploadProductImage: async () => ({ fileId: FILE_ID }),
    confirmProductImage: async (input) => {
      assert.strictEqual(input.fileId, FILE_ID);
      return { assetKey: ASSET_KEY, status: 'staged' };
    }
  });
  assert.strictEqual(staged.assetKey, ASSET_KEY);
  assert.deepStrictEqual(stages, ['prepare', 'upload', 'confirm', 'complete']);

  await assert.rejects(() => productImageService.stageProductImage({
    filePath: 'wxfile://tmp_without_suffix',
    sizeBytes: 128,
    extension: 'jpg',
    stageRequestKey: 'prepare_request_failure',
    confirmRequestKey: 'confirm_request_failure'
  }, {
    prepareProductImage: async () => ({
      assetKey: ASSET_KEY,
      cloudPath: 'product-images/uploads/a.jpg',
      status: 'awaiting_upload'
    }),
    uploadProductImage: async () => {
      throw {
        code: 'CLOUD_CALL_FAILED',
        message: '云服务暂时不可用，请稍后重试。',
        requestId: 'req_upload_123456'
      };
    }
  }), (error) => {
    assert.strictEqual(error.code, 'CLOUD_CALL_FAILED');
    assert.strictEqual(error.stage, 'upload');
    assert.strictEqual(error.requestId, 'req_upload_123456');
    return true;
  });

  const originalWx = global.wx;
  global.wx = {
    cloud: {
      uploadFile(options) {
        options.success({ fileID: FILE_ID });
      }
    }
  };
  try {
    const uploaded = await productImageService.uploadProductImage({
      cloudPath: 'product-images/uploads/a.jpg',
      filePath: 'wxfile://tmp_without_suffix'
    });
    assert.strictEqual(uploaded.fileId, FILE_ID);
  } finally {
    global.wx = originalWx;
  }
}

async function testPageSelectionUsesLocalPreview() {
  const originalPage = global.Page;
  const originalWx = global.wx;
  let pageConfig;
  global.Page = (config) => { pageConfig = config; };
  global.wx = {
    chooseMedia(options) {
      options.success({
        tempFiles: [{
          tempFilePath: 'wxfile://tmp_without_suffix',
          size: 128,
          fileType: 'image'
        }]
      });
    },
    getImageInfo(options) {
      options.success({ type: 'jpeg', width: 100, height: 100 });
    },
    showToast() {}
  };

  const pagePath = require.resolve('../miniprogram/pages/product-edit/product-edit.js');
  delete require.cache[pagePath];
  require('../miniprogram/pages/product-edit/product-edit.js');
  const page = Object.assign({}, pageConfig);
  page.data = structuredClone(pageConfig.data);
  page.pageActive = true;
  page.setData = function (updates, callback) {
    applySetData(this.data, updates);
    if (callback) callback();
  };

  try {
    page.onChooseImage();
    await flushPromises();
    await flushPromises();
    assert.strictEqual(page.data.form.coverMode, 'custom');
    assert.strictEqual(page.data.form.localImagePath, 'wxfile://tmp_without_suffix');
    assert.strictEqual(page.data.imageExtension, 'jpg');

    const template = fs.readFileSync(path.resolve(
      __dirname,
      '../miniprogram/pages/product-edit/product-edit.wxml'
    ), 'utf8');
    assert(template.includes('wx:elif="{{form.coverMode===\'custom\'}}"'));
    assert(template.includes('src="{{form.localImagePath}}"'));
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
    delete require.cache[pagePath];
  }
}

async function testCloudErrorMetadataPreserved() {
  const originalWx = global.wx;
  global.wx = {
    cloud: {
      callFunction() {
        return Promise.resolve({
          result: {
            success: false,
            requestId: 'req_server_123456',
            error: {
              code: 'IMAGE_ASSET_EXPIRED',
              message: '图片上传已过期，请重新选择图片。'
            }
          }
        });
      }
    }
  };
  const cloudServicePath = require.resolve('../miniprogram/services/cloud-service.js');
  delete require.cache[cloudServicePath];
  const cloudService = require('../miniprogram/services/cloud-service.js');
  try {
    await assert.rejects(
      () => cloudService.callApi('product.image.stage.confirm', {}),
      (error) => {
        assert.strictEqual(error.code, 'IMAGE_ASSET_EXPIRED');
        assert.strictEqual(error.message, '图片上传已过期，请重新选择图片。');
        assert.strictEqual(error.requestId, 'req_server_123456');
        assert.strictEqual(error.action, 'product.image.stage.confirm');
        return true;
      }
    );
  } finally {
    global.wx = originalWx;
    delete require.cache[cloudServicePath];
  }

  const normalized = normalizeError({
    code: 'IMAGE_FILE_CONFIRM_FAILED',
    message: '安全图片生成失败。',
    requestId: 'req_confirm_123456',
    stage: 'confirm'
  }, 'CLOUD_CALL_FAILED');
  assert.strictEqual(normalized.requestId, 'req_confirm_123456');
  assert.strictEqual(normalized.stage, 'confirm');
}

async function testImageHydrationFailureDegrades() {
  const product = {
    _id: PRODUCT_ID,
    teamId: TEAM_ID,
    coverType: 'image',
    coverAssetKey: ASSET_KEY,
    coverFileId: FILE_ID
  };
  const db = {
    collection() {
      return {
        doc() {
          return {
            async get() {
              throw new Error('optional image asset read failed');
            }
          };
        }
      };
    }
  };
  const cloud = {
    async getTempFileURL() {
      throw new Error('must not be reached');
    }
  };
  const result = await resolveProductImageAccessUrls({
    cloud,
    db,
    teamId: TEAM_ID,
    products: [product]
  });
  assert.deepStrictEqual(result.get(PRODUCT_ID), {
    imageUrl: '',
    imageUrlExpiresAt: null,
    imageAvailable: false
  });
}

function testPayloadAndSafeMessages() {
  const payload = createUtils.buildCreateProductPayload({
    coverMode: 'custom',
    coverAssetKey: ASSET_KEY,
    localImagePath: 'wxfile://tmp_without_suffix',
    name: '图片产品',
    code: '',
    category: '其他',
    unit: '个',
    customUnit: '',
    brand: '',
    specification: '',
    description: '',
    stock: 0,
    minStock: 0,
    lowStockEnabled: true
  });
  assert.strictEqual(payload.coverType, 'image');
  assert.strictEqual(payload.coverAssetKey, ASSET_KEY);
  assert.strictEqual(payload.localImagePath, undefined);

  assert.strictEqual(
    createUtils.getCreateErrorMessage({ code: 'CLOUD_CALL_FAILED', stage: 'upload' }),
    '图片上传失败，请检查网络后重试'
  );
  assert.strictEqual(
    createUtils.getCreateErrorMessage({
      code: 'UNEXPECTED_SAFE_CODE',
      message: '图片处理服务繁忙，请稍后重试。',
      stage: 'confirm'
    }),
    '图片安全校验失败：图片处理服务繁忙，请稍后重试。'
  );
  assert.strictEqual(
    createUtils.getCreateErrorMessage({
      code: 'UNEXPECTED_SAFE_CODE',
      message: `sensitive ${FILE_ID}`
    }),
    '创建失败，请稍后重试'
  );
}

async function run() {
  await testExtensionlessLocalImageInspection();
  await testStageDiagnosticsAndResponseParsing();
  await testPageSelectionUsesLocalPreview();
  await testCloudErrorMetadataPreserved();
  await testImageHydrationFailureDegrades();
  testPayloadAndSafeMessages();
  console.log('stage2c3c1b tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
