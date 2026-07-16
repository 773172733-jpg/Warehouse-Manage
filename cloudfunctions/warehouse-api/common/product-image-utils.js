const crypto = require('crypto');
const { ApiError, ERROR_CODES } = require('./errors.js');
const { validateRequestKey } = require('./validators.js');

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const PREPARE_TTL_MS = 30 * 60 * 1000;
const STAGED_TTL_MS = 24 * 60 * 60 * 1000;
const REJECTED_CLEANUP_MS = 24 * 60 * 60 * 1000;
const ORPHANED_CLEANUP_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
const IMAGE_ASSET_STATUSES = ['awaiting_upload', 'staged', 'bound', 'orphaned', 'rejected'];
const IMAGE_ASSET_KEY_PATTERN = /^product_image_[a-f0-9]{32}$/;

function normalizeExtension(value) {
  const extension = typeof value === 'string' ? value.trim().toLowerCase().replace(/^\./, '') : '';
  if (!IMAGE_EXTENSIONS.includes(extension)) {
    throw new ApiError(ERROR_CODES.IMAGE_FILE_TYPE_INVALID, '请选择JPG、PNG或WebP图片。');
  }
  return extension === 'jpeg' ? 'jpg' : extension;
}

function validateDeclaredSize(value) {
  const sizeBytes = Number(value);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new ApiError(ERROR_CODES.IMAGE_FILE_TYPE_INVALID, '图片文件为空或大小无效。');
  }
  if (sizeBytes > MAX_IMAGE_BYTES) {
    throw new ApiError(ERROR_CODES.IMAGE_FILE_TOO_LARGE, '图片不能超过2 MiB。');
  }
  return sizeBytes;
}

function validateAssetKey(value) {
  const assetKey = typeof value === 'string' ? value.trim() : '';
  if (!IMAGE_ASSET_KEY_PATTERN.test(assetKey)) {
    throw new ApiError(ERROR_CODES.IMAGE_ASSET_NOT_FOUND, '图片资产不存在。');
  }
  return assetKey;
}

function sanitizePrepareInput(rawInput) {
  const source = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const allowed = ['extension', 'sizeBytes', 'requestKey'];
  const unknown = Object.keys(source).find((field) => !allowed.includes(field));
  if (unknown) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '图片准备请求包含不允许的字段。');
  }
  return {
    extension: normalizeExtension(source.extension),
    sizeBytes: validateDeclaredSize(source.sizeBytes),
    requestKey: validateRequestKey(source.requestKey)
  };
}

function sanitizeConfirmInput(rawInput) {
  const source = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const allowed = ['assetKey', 'fileId', 'requestKey'];
  const unknown = Object.keys(source).find((field) => !allowed.includes(field));
  if (unknown) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '图片确认请求包含不允许的字段。');
  }
  const fileId = typeof source.fileId === 'string' ? source.fileId.trim() : '';
  if (!fileId || fileId.length > 1024) {
    throw new ApiError(ERROR_CODES.IMAGE_FILE_PATH_INVALID, '上传文件标识无效。');
  }
  return {
    assetKey: validateAssetKey(source.assetKey),
    fileId,
    requestKey: validateRequestKey(source.requestKey)
  };
}

function createInputHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function createPrepareHash(input) {
  return createInputHash({ extension: input.extension, sizeBytes: input.sizeBytes });
}

function createConfirmHash(input) {
  return createInputHash({ assetKey: input.assetKey, fileId: input.fileId });
}

function parseCloudFileId(fileId) {
  const match = /^cloud:\/\/([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\/([A-Za-z0-9_./-]+)$/.exec(fileId || '');
  return match ? { envId: match[1], bucket: match[2], cloudPath: match[3] } : null;
}

function validateCloudFileId(fileId, envId, expectedCloudPath) {
  const parsed = parseCloudFileId(fileId);
  if (!parsed || !envId || parsed.envId !== envId || parsed.cloudPath !== expectedCloudPath) {
    throw new ApiError(ERROR_CODES.IMAGE_FILE_PATH_INVALID, '上传文件路径与准备记录不匹配。');
  }
  return parsed;
}

function hasPrefix(buffer, bytes) {
  return bytes.every((value, index) => buffer[index] === value);
}

function validatePngStructure(buffer) {
  let offset = 8;
  let sawHeader = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const next = offset + 12 + length;
    if (next > buffer.length) return false;
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) return false;
      sawHeader = true;
    }
    if (type === 'IEND') {
      return length === 0 && next === buffer.length;
    }
    offset = next;
  }
  return false;
}

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ApiError(ERROR_CODES.IMAGE_FILE_TYPE_INVALID, '图片文件为空。');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ApiError(ERROR_CODES.IMAGE_FILE_TOO_LARGE, '图片不能超过2 MiB。');
  }
  if (buffer.length >= 4 && hasPrefix(buffer, [0xFF, 0xD8, 0xFF]) &&
      buffer[buffer.length - 2] === 0xFF && buffer[buffer.length - 1] === 0xD9) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }
  const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (buffer.length >= 20 && hasPrefix(buffer, pngSignature) && validatePngStructure(buffer)) {
    return { extension: 'png', mimeType: 'image/png' };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP' && buffer.readUInt32LE(4) + 8 === buffer.length) {
    return { extension: 'webp', mimeType: 'image/webp' };
  }
  throw new ApiError(ERROR_CODES.IMAGE_FILE_TYPE_INVALID, '图片真实格式不是受支持的JPG、PNG或WebP。');
}

function inspectImageBuffer(fileContent, declaredExtension) {
  const buffer = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent || '');
  const detected = detectImageType(buffer);
  if (detected.extension !== normalizeExtension(declaredExtension)) {
    throw new ApiError(ERROR_CODES.IMAGE_FILE_TYPE_INVALID, '图片扩展名与真实格式不一致。');
  }
  return {
    buffer,
    detectedExtension: detected.extension,
    detectedMimeType: detected.mimeType,
    sizeBytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
}

function isExpired(value, now) {
  const expiresAt = value instanceof Date ? value : new Date(value);
  return !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime();
}

module.exports = {
  MAX_IMAGE_BYTES,
  PREPARE_TTL_MS,
  STAGED_TTL_MS,
  REJECTED_CLEANUP_MS,
  ORPHANED_CLEANUP_MS,
  IMAGE_EXTENSIONS,
  IMAGE_ASSET_STATUSES,
  IMAGE_ASSET_KEY_PATTERN,
  normalizeExtension,
  validateDeclaredSize,
  validateAssetKey,
  sanitizePrepareInput,
  sanitizeConfirmInput,
  createPrepareHash,
  createConfirmHash,
  parseCloudFileId,
  validateCloudFileId,
  detectImageType,
  inspectImageBuffer,
  isExpired
};
