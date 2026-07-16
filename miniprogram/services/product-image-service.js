const cloudService = require('./cloud-service.js');
const env = require('../config/env.js');
const { ERROR_CODES } = require('../constants/errors.js');
const { normalizeError } = require('../utils/error-handler.js');
const { createRequestKey } = require('../utils/request-key.js');

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

function createLocalError(code, message) {
  return { code, message };
}

function getFileExtension(filePath) {
  const path = typeof filePath === 'string' ? filePath.trim().split(/[?#]/)[0] : '';
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  return match ? match[1].toLowerCase() : '';
}

function validateLocalImage(input) {
  const source = input && typeof input === 'object' ? input : {};
  const filePath = typeof source.filePath === 'string' ? source.filePath.trim() : '';
  if (!filePath) {
    throw createLocalError(ERROR_CODES.IMAGE_FILE_PATH_INVALID, '图片临时路径无效，请重新选择。');
  }
  const sizeBytes = Number(source.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw createLocalError(ERROR_CODES.IMAGE_FILE_TYPE_INVALID, '图片文件为空或大小无效。');
  }
  if (sizeBytes > MAX_IMAGE_BYTES) {
    throw createLocalError(ERROR_CODES.IMAGE_FILE_TOO_LARGE, '图片不能超过2 MiB。');
  }
  const extension = getFileExtension(filePath);
  if (ALLOWED_EXTENSIONS.indexOf(extension) === -1) {
    throw createLocalError(ERROR_CODES.IMAGE_FILE_TYPE_INVALID, '请选择JPG、PNG或WebP图片。');
  }
  return {
    filePath,
    sizeBytes,
    extension: extension === 'jpeg' ? 'jpg' : extension
  };
}

function prepareProductImage(input) {
  return cloudService.callApi('product.image.stage.prepare', {
    extension: input.extension,
    sizeBytes: input.sizeBytes,
    requestKey: input.requestKey
  });
}

function uploadProductImage(input) {
  if (!env.WAREHOUSE_CLOUD_ENV || !wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
    return Promise.reject(normalizeError(null, ERROR_CODES.CLOUD_NOT_AVAILABLE));
  }
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath: input.cloudPath,
      filePath: input.filePath,
      config: { env: env.WAREHOUSE_CLOUD_ENV },
      success: (result) => {
        if (!result || !result.fileID) {
          reject(normalizeError(null, ERROR_CODES.CLOUD_CALL_FAILED));
          return;
        }
        resolve({ fileId: result.fileID });
      },
      fail: (error) => reject(normalizeError(error, ERROR_CODES.CLOUD_CALL_FAILED))
    });
  });
}

function confirmProductImage(input) {
  return cloudService.callApi('product.image.stage.confirm', {
    assetKey: input.assetKey,
    fileId: input.fileId,
    requestKey: input.requestKey
  });
}

function createStageRequestKeys(current) {
  const source = current && typeof current === 'object' ? current : {};
  return {
    stageRequestKey: source.stageRequestKey || createRequestKey('product_image_stage'),
    confirmRequestKey: source.confirmRequestKey || createRequestKey('product_image_confirm')
  };
}

async function stageProductImage(input, adapters) {
  const file = validateLocalImage(input);
  const steps = adapters || {};
  const prepare = steps.prepareProductImage || prepareProductImage;
  const upload = steps.uploadProductImage || uploadProductImage;
  const confirm = steps.confirmProductImage || confirmProductImage;
  const prepared = await prepare({
    extension: file.extension,
    sizeBytes: file.sizeBytes,
    requestKey: input.stageRequestKey
  });
  if (!prepared || !prepared.assetKey) {
    throw createLocalError(ERROR_CODES.IMAGE_ASSET_NOT_READY, '图片准备结果不完整。');
  }
  if (prepared.status === 'staged' || prepared.status === 'bound') {
    return { assetKey: prepared.assetKey, status: prepared.status, reused: true };
  }
  if (!prepared.cloudPath) {
    throw createLocalError(ERROR_CODES.IMAGE_FILE_PATH_INVALID, '图片上传路径无效。');
  }
  const uploaded = await upload({ cloudPath: prepared.cloudPath, filePath: file.filePath });
  const confirmed = await confirm({
    assetKey: prepared.assetKey,
    fileId: uploaded.fileId,
    requestKey: input.confirmRequestKey
  });
  if (!confirmed || !confirmed.assetKey || confirmed.status !== 'staged') {
    throw createLocalError(ERROR_CODES.IMAGE_ASSET_NOT_READY, '图片安全确认结果不完整。');
  }
  return {
    assetKey: confirmed.assetKey,
    status: confirmed.status,
    detectedExtension: confirmed.detectedExtension,
    sizeBytes: confirmed.sizeBytes,
    reused: false
  };
}

module.exports = {
  MAX_IMAGE_BYTES,
  ALLOWED_EXTENSIONS,
  getFileExtension,
  validateLocalImage,
  prepareProductImage,
  uploadProductImage,
  confirmProductImage,
  createStageRequestKeys,
  stageProductImage
};
