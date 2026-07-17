const crypto = require('crypto');
const { ApiError, ERROR_CODES, isApiError } = require('../../common/errors.js');
const { COLLECTIONS, getDocument } = require('../../common/database.js');
const { createMembershipId, createProductImageAssetId } = require('../../common/idempotency.js');
const { requireCurrentTeamAccess, requireRole } = require('../../common/permissions.js');
const {
  PREPARE_TTL_MS,
  STAGED_TTL_MS,
  REJECTED_CLEANUP_MS,
  ORPHANED_CLEANUP_MS,
  sanitizePrepareInput,
  sanitizeConfirmInput,
  createPrepareHash,
  createConfirmHash,
  validateAssetKey,
  validateCloudFileId,
  inspectImageBuffer,
  isExpired
} = require('../../common/product-image-utils.js');

function createPathToken() {
  return crypto.randomBytes(24).toString('hex');
}

function addMilliseconds(value, milliseconds) {
  return new Date(value.getTime() + milliseconds);
}

async function requireImageAccess(db, user) {
  const access = await requireCurrentTeamAccess(db, user);
  requireRole(access.membership, 'admin');
  return access;
}

async function requireImageAccessInTransaction(transaction, user, access) {
  const lockedUser = await getDocument(transaction, COLLECTIONS.USERS, user._id);
  const team = await getDocument(transaction, COLLECTIONS.TEAMS, access.team._id);
  const membership = await getDocument(
    transaction,
    COLLECTIONS.TEAM_MEMBERS,
    createMembershipId(access.team._id, user._id)
  );
  if (!lockedUser || lockedUser.status !== 'active') {
    throw new ApiError(ERROR_CODES.USER_DISABLED, '当前用户不可用。');
  }
  if (!team || team.status !== 'active') {
    throw new ApiError(ERROR_CODES.TEAM_NOT_ACTIVE, '当前团队不可用。');
  }
  if (lockedUser.currentTeamId && lockedUser.currentTeamId !== team._id) {
    throw new ApiError(ERROR_CODES.NO_ACTIVE_TEAM, '当前团队上下文已经变化，请刷新后重试。');
  }
  requireRole(membership, 'admin');
  return { user: lockedUser, team, membership };
}

function assertAssetScope(asset, access, user) {
  if (!asset || asset.teamId !== access.team._id || asset.createdBy !== user._id) {
    throw new ApiError(ERROR_CODES.IMAGE_ASSET_NOT_FOUND, '图片资产不存在。');
  }
  return asset;
}

function presentPreparedAsset(asset, idempotent) {
  return {
    assetKey: asset._id,
    cloudPath: asset.status === 'awaiting_upload' ? asset.uploadCloudPath : '',
    expiresAt: asset.expiresAt,
    status: asset.status,
    idempotent: Boolean(idempotent)
  };
}

function presentConfirmedAsset(asset, idempotent) {
  return {
    assetKey: asset._id,
    status: asset.status,
    detectedExtension: asset.detectedExtension,
    sizeBytes: asset.sizeBytes,
    expiresAt: asset.expiresAt,
    idempotent: Boolean(idempotent)
  };
}

async function prepareProductImage(db, user, rawInput, options) {
  const input = sanitizePrepareInput(rawInput);
  const access = await requireImageAccess(db, user);
  const assetKey = createProductImageAssetId(access.team._id, input.requestKey);
  const requestHash = createPrepareHash(input);
  const settings = options || {};
  let result;

  await db.runTransaction(async (transaction) => {
    const locked = await requireImageAccessInTransaction(transaction, user, access);
    const existing = await getDocument(transaction, COLLECTIONS.PRODUCT_IMAGE_ASSETS, assetKey);
    if (existing) {
      assertAssetScope(existing, access, locked.user);
      if (existing.stageRequestKey !== input.requestKey || existing.stageRequestHash !== requestHash) {
        throw new ApiError(ERROR_CODES.REQUEST_KEY_CONFLICT, '图片准备标识已用于其他文件参数。');
      }
      if (existing.status === 'awaiting_upload' && isExpired(existing.expiresAt, new Date())) {
        throw new ApiError(ERROR_CODES.IMAGE_ASSET_EXPIRED, '图片上传准备已过期，请重新选择图片。');
      }
      if (!['awaiting_upload', 'staged', 'bound'].includes(existing.status)) {
        throw new ApiError(ERROR_CODES.IMAGE_ASSET_STATE_CONFLICT, '图片资产状态不可继续使用。');
      }
      result = presentPreparedAsset(existing, true);
      return;
    }

    const now = settings.now instanceof Date ? settings.now : new Date();
    const createToken = typeof settings.createPathToken === 'function'
      ? settings.createPathToken
      : createPathToken;
    const uploadToken = createToken();
    const verifiedToken = createToken();
    const assetData = {
      teamId: locked.team._id,
      createdBy: locked.user._id,
      stageRequestKey: input.requestKey,
      stageRequestHash: requestHash,
      status: 'awaiting_upload',
      declaredExtension: input.extension,
      declaredSizeBytes: input.sizeBytes,
      uploadCloudPath: `product-images/uploads/${uploadToken}.${input.extension}`,
      verifiedCloudPath: `product-images/verified/${verifiedToken}.${input.extension}`,
      productId: '',
      boundBy: '',
      boundAt: null,
      confirmedAt: null,
      orphanedAt: null,
      rejectedAt: null,
      expiresAt: addMilliseconds(now, PREPARE_TTL_MS),
      cleanupAfter: null,
      confirmRequestKey: '',
      confirmRequestHash: '',
      createdAt: now,
      updatedAt: now
    };
    await transaction.collection(COLLECTIONS.PRODUCT_IMAGE_ASSETS)
      .doc(assetKey)
      .set({ data: assetData });
    result = presentPreparedAsset(Object.assign({ _id: assetKey }, assetData), false);
  }, 5);

  return result;
}

async function rejectImageAsset(db, assetKey, now) {
  try {
    await db.runTransaction(async (transaction) => {
      const current = await getDocument(transaction, COLLECTIONS.PRODUCT_IMAGE_ASSETS, assetKey);
      if (!current || current.status !== 'awaiting_upload') return;
      await transaction.collection(COLLECTIONS.PRODUCT_IMAGE_ASSETS).doc(assetKey).update({
        data: {
          status: 'rejected',
          rejectedAt: now,
          cleanupAfter: addMilliseconds(now, REJECTED_CLEANUP_MS),
          updatedAt: now
        }
      });
    }, 5);
  } catch (error) {
    // Preserve the original validation error; cleanup metadata can be repaired later.
  }
}

function assertConfirmableAsset(asset, access, user, input, requestHash, now) {
  assertAssetScope(asset, access, user);
  if (['staged', 'bound'].includes(asset.status) &&
      asset.confirmRequestKey === input.requestKey && asset.confirmRequestHash === requestHash) {
    return 'idempotent';
  }
  if (asset.status !== 'awaiting_upload') {
    throw new ApiError(ERROR_CODES.IMAGE_ASSET_STATE_CONFLICT, '图片资产当前不能确认。');
  }
  if (isExpired(asset.expiresAt, now)) {
    throw new ApiError(ERROR_CODES.IMAGE_ASSET_EXPIRED, '图片上传准备已过期，请重新选择图片。');
  }
  return 'confirm';
}

async function confirmProductImage(db, user, rawInput, options) {
  const input = sanitizeConfirmInput(rawInput);
  const settings = options || {};
  const cloud = settings.cloud;
  const envId = settings.envId;
  if (!cloud || typeof cloud.downloadFile !== 'function' || typeof cloud.uploadFile !== 'function') {
    throw new ApiError(ERROR_CODES.IMAGE_FILE_CONFIRM_FAILED, '云存储服务暂不可用。');
  }
  const access = await requireImageAccess(db, user);
  const requestHash = createConfirmHash(input);
  const now = settings.now instanceof Date ? settings.now : new Date();
  let asset = await getDocument(db, COLLECTIONS.PRODUCT_IMAGE_ASSETS, input.assetKey);
  assertAssetScope(asset, access, user);
  const state = assertConfirmableAsset(asset, access, user, input, requestHash, now);
  if (state === 'idempotent') return presentConfirmedAsset(asset, true);

  try {
    validateCloudFileId(input.fileId, envId, asset.uploadCloudPath);
  } catch (error) {
    await rejectImageAsset(db, input.assetKey, now);
    throw error;
  }

  let downloaded;
  try {
    downloaded = await cloud.downloadFile({ fileID: input.fileId });
  } catch (error) {
    await rejectImageAsset(db, input.assetKey, now);
    throw new ApiError(ERROR_CODES.IMAGE_FILE_DOWNLOAD_FAILED, '图片下载校验失败，请重新选择图片。');
  }

  let inspected;
  try {
    inspected = inspectImageBuffer(downloaded && downloaded.fileContent, asset.declaredExtension);
  } catch (error) {
    await rejectImageAsset(db, input.assetKey, now);
    if (isApiError(error)) throw error;
    throw new ApiError(ERROR_CODES.IMAGE_FILE_TYPE_INVALID, '图片真实格式校验失败。');
  }

  let verifiedUpload;
  try {
    verifiedUpload = await cloud.uploadFile({
      cloudPath: asset.verifiedCloudPath,
      fileContent: inspected.buffer
    });
    validateCloudFileId(verifiedUpload && verifiedUpload.fileID, envId, asset.verifiedCloudPath);
  } catch (error) {
    throw new ApiError(ERROR_CODES.IMAGE_FILE_CONFIRM_FAILED, '安全图片生成失败，请稍后重试。');
  }

  let idempotent = false;
  await db.runTransaction(async (transaction) => {
    const locked = await requireImageAccessInTransaction(transaction, user, access);
    const current = await getDocument(transaction, COLLECTIONS.PRODUCT_IMAGE_ASSETS, input.assetKey);
    const currentState = assertConfirmableAsset(current, access, locked.user, input, requestHash, now);
    if (currentState === 'idempotent') {
      asset = current;
      idempotent = true;
      return;
    }
    const update = {
      status: 'staged',
      sourceUploadFileId: input.fileId,
      fileId: verifiedUpload.fileID,
      detectedMimeType: inspected.detectedMimeType,
      detectedExtension: inspected.detectedExtension,
      sizeBytes: inspected.sizeBytes,
      sha256: inspected.sha256,
      confirmedAt: now,
      expiresAt: addMilliseconds(now, STAGED_TTL_MS),
      cleanupAfter: null,
      confirmRequestKey: input.requestKey,
      confirmRequestHash: requestHash,
      updatedAt: now
    };
    await transaction.collection(COLLECTIONS.PRODUCT_IMAGE_ASSETS).doc(input.assetKey).update({ data: update });
    asset = Object.assign({}, current, update);
  }, 5);
  return presentConfirmedAsset(asset, idempotent);
}

function assertBindableImageAsset(asset, context, productId, now) {
  if (!asset || asset.teamId !== context.teamId || asset.createdBy !== context.userId) {
    throw new ApiError(ERROR_CODES.IMAGE_ASSET_NOT_FOUND, '图片资产不存在。');
  }
  if (asset.status === 'bound') {
    if (asset.productId === productId) return asset;
    throw new ApiError(ERROR_CODES.IMAGE_ASSET_ALREADY_BOUND, '图片资产已经绑定到其他产品。');
  }
  if (asset.status !== 'staged') {
    throw new ApiError(ERROR_CODES.IMAGE_ASSET_NOT_READY, '图片尚未完成安全确认。');
  }
  if (isExpired(asset.expiresAt, now)) {
    throw new ApiError(ERROR_CODES.IMAGE_ASSET_EXPIRED, '已确认图片已过期，请重新选择图片。');
  }
  if (!asset.fileId || !asset.detectedMimeType || !asset.detectedExtension ||
      !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0 || !asset.sha256) {
    throw new ApiError(ERROR_CODES.IMAGE_ASSET_NOT_READY, '图片安全确认信息不完整。');
  }
  return asset;
}

async function resolveImageCoverInTransaction(transaction, input, context, productId, now) {
  if (input.preserveCover || input.coverType !== 'image') return { input, asset: null };
  const assetKey = validateAssetKey(input.coverAssetKey);
  const asset = await getDocument(transaction, COLLECTIONS.PRODUCT_IMAGE_ASSETS, assetKey);
  assertBindableImageAsset(asset, context, productId, now);
  return {
    asset,
    input: Object.assign({}, input, {
      coverType: 'image',
      coverText: '',
      coverEmoji: '',
      coverAssetKey: asset._id,
      coverFileId: asset.fileId,
      coverBackground: ''
    })
  };
}

async function bindImageAssetInTransaction(transaction, asset, context, productId, now) {
  if (!asset || (asset.status === 'bound' && asset.productId === productId)) return;
  await transaction.collection(COLLECTIONS.PRODUCT_IMAGE_ASSETS).doc(asset._id).update({
    data: {
      status: 'bound',
      productId,
      boundBy: context.userId,
      boundAt: now,
      expiresAt: null,
      cleanupAfter: null,
      updatedAt: now
    }
  });
}

async function orphanImageAssetInTransaction(transaction, assetKey, context, productId, now) {
  if (!assetKey) return;
  const asset = await getDocument(transaction, COLLECTIONS.PRODUCT_IMAGE_ASSETS, assetKey);
  if (!asset) return;
  if (asset.teamId !== context.teamId || asset.productId !== productId) {
    throw new ApiError(ERROR_CODES.IMAGE_ASSET_STATE_CONFLICT, '原图片资产归属异常。');
  }
  if (asset.status === 'orphaned') return;
  if (asset.status !== 'bound') {
    throw new ApiError(ERROR_CODES.IMAGE_ASSET_STATE_CONFLICT, '原图片资产状态异常。');
  }
  await transaction.collection(COLLECTIONS.PRODUCT_IMAGE_ASSETS).doc(asset._id).update({
    data: {
      status: 'orphaned',
      orphanedAt: now,
      cleanupAfter: addMilliseconds(now, ORPHANED_CLEANUP_MS),
      updatedAt: now
    }
  });
}

module.exports = {
  createPathToken,
  addMilliseconds,
  requireImageAccess,
  requireImageAccessInTransaction,
  assertAssetScope,
  prepareProductImage,
  rejectImageAsset,
  assertConfirmableAsset,
  confirmProductImage,
  assertBindableImageAsset,
  resolveImageCoverInTransaction,
  bindImageAssetInTransaction,
  orphanImageAssetInTransaction
};
