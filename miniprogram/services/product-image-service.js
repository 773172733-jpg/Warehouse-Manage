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

function normalizeImageExtension(value) {
  const text = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/^image\//, '').replace(/^\./, '')
    : '';
  return text === 'jpeg' ? 'jpg' : text;
}

function getFileExtension(filePath) {
  const path = typeof filePath === 'string' ? filePath.trim().split(/[?#]/)[0] : '';
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  return match ? normalizeImageExtension(match[1]) : '';
}

function validateLocalFileBasics(input) {
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
  return { source, filePath, sizeBytes };
}

function validateLocalImage(input) {
  const file = validateLocalFileBasics(input);
  const extension = normalizeImageExtension(file.source.extension || file.source.imageType) ||
    getFileExtension(file.filePath);
  if (ALLOWED_EXTENSIONS.indexOf(extension) === -1) {
    throw createLocalError(ERROR_CODES.IMAGE_FILE_TYPE_INVALID, '请选择JPG、PNG或WebP图片。');
  }
  return {
    filePath: file.filePath,
    sizeBytes: file.sizeBytes,
    extension
  };
}

function getImageInfo(filePath) {
  if (!wx.getImageInfo || typeof wx.getImageInfo !== 'function') {
    return Promise.reject(createLocalError(
      ERROR_CODES.IMAGE_FILE_TYPE_INVALID,
      '无法识别图片格式，请重新选择JPG、PNG或WebP图片。'
    ));
  }
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: filePath,
      success: resolve,
      fail: reject
    });
  });
}

async function inspectLocalImage(input, adapters) {
  const file = validateLocalFileBasics(input);
  const declaredExtension = normalizeImageExtension(file.source.extension || file.source.imageType) ||
    getFileExtension(file.filePath);
  if (ALLOWED_EXTENSIONS.indexOf(declaredExtension) > -1) {
    return validateLocalImage(Object.assign({}, file.source, { extension: declaredExtension }));
  }
  if (file.source.fileType && file.source.fileType !== 'image') {
    throw createLocalError(ERROR_CODES.IMAGE_FILE_TYPE_INVALID, '请选择JPG、PNG或WebP图片。');
  }
  const steps = adapters || {};
  const inspect = steps.getImageInfo || getImageInfo;
  let imageInfo;
  try {
    imageInfo = await inspect(file.filePath);
  } catch (error) {
    throw normalizeError(error, ERROR_CODES.IMAGE_FILE_TYPE_INVALID);
  }
  return validateLocalImage(Object.assign({}, file.source, {
    extension: imageInfo && imageInfo.type
  }));
}

function withStage(stage, operation) {
  return Promise.resolve()
    .then(operation)
    .catch((error) => {
      const normalized = normalizeError(error, ERROR_CODES.CLOUD_CALL_FAILED);
      normalized.stage = stage;
      throw normalized;
    });
}

function notifyStage(input, stage) {
  if (input && typeof input.onStageChange === 'function') {
    input.onStageChange(stage);
  }
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
  let file;
  try {
    file = validateLocalImage(input);
  } catch (error) {
    const normalized = normalizeError(error, ERROR_CODES.IMAGE_FILE_TYPE_INVALID);
    normalized.stage = 'prepare';
    throw normalized;
  }
  const steps = adapters || {};
  const prepare = steps.prepareProductImage || prepareProductImage;
  const upload = steps.uploadProductImage || uploadProductImage;
  const confirm = steps.confirmProductImage || confirmProductImage;
  notifyStage(input, 'prepare');
  const prepared = await withStage('prepare', () => prepare({
    extension: file.extension,
    sizeBytes: file.sizeBytes,
    requestKey: input.stageRequestKey
  }));
  if (!prepared || !prepared.assetKey) {
    const error = createLocalError(ERROR_CODES.IMAGE_ASSET_NOT_READY, '图片准备结果不完整。');
    error.stage = 'prepare';
    throw error;
  }
  if (prepared.status === 'staged' || prepared.status === 'bound') {
    notifyStage(input, 'complete');
    return { assetKey: prepared.assetKey, status: prepared.status, reused: true };
  }
  if (!prepared.cloudPath) {
    const error = createLocalError(ERROR_CODES.IMAGE_FILE_PATH_INVALID, '图片上传路径无效。');
    error.stage = 'prepare';
    throw error;
  }
  notifyStage(input, 'upload');
  const uploaded = await withStage('upload', () => upload({
    cloudPath: prepared.cloudPath,
    filePath: file.filePath
  }));
  notifyStage(input, 'confirm');
  const confirmed = await withStage('confirm', () => confirm({
    assetKey: prepared.assetKey,
    fileId: uploaded.fileId,
    requestKey: input.confirmRequestKey
  }));
  if (!confirmed || !confirmed.assetKey || confirmed.status !== 'staged') {
    const error = createLocalError(ERROR_CODES.IMAGE_ASSET_NOT_READY, '图片安全确认结果不完整。');
    error.stage = 'confirm';
    throw error;
  }
  notifyStage(input, 'complete');
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
  normalizeImageExtension,
  getFileExtension,
  validateLocalImage,
  inspectLocalImage,
  prepareProductImage,
  uploadProductImage,
  confirmProductImage,
  createStageRequestKeys,
  stageProductImage
};
