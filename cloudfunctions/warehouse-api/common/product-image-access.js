const { COLLECTIONS, getDocument } = require('./database.js');
const { IMAGE_ASSET_KEY_PATTERN } = require('./product-image-utils.js');

const TEMP_URL_MAX_AGE_SECONDS = 3600;
const MAX_TEMP_URL_BATCH_SIZE = 50;

function createUnavailableAccess() {
  return {
    imageUrl: '',
    imageUrlExpiresAt: null,
    imageAvailable: false
  };
}

function getInternalImageDescriptor(document, teamId) {
  if (!document || document.teamId !== teamId) return null;
  const snapshot = document.coverSummarySnapshot;
  const isWarehouseProduct = snapshot && typeof snapshot === 'object';
  const coverType = isWarehouseProduct ? snapshot.type : document.coverType;
  if (coverType !== 'image') return null;

  const productId = isWarehouseProduct ? document.productId : document._id;
  const assetKey = isWarehouseProduct ? snapshot.assetKey : document.coverAssetKey;
  const fileId = isWarehouseProduct ? snapshot.fileId : document.coverFileId;
  if (!productId || !IMAGE_ASSET_KEY_PATTERN.test(assetKey || '') || !fileId) return null;

  return { productId, assetKey, fileId };
}

function isViewableBoundAsset(asset, descriptor, teamId) {
  return Boolean(
    asset &&
    asset.teamId === teamId &&
    asset.productId === descriptor.productId &&
    asset.status === 'bound' &&
    asset.fileId &&
    asset.fileId === descriptor.fileId &&
    asset.boundAt &&
    !asset.orphanedAt &&
    !asset.rejectedAt
  );
}

function getResultMaxAge(result) {
  const maxAge = Number(result && result.maxAge);
  return Number.isFinite(maxAge) && maxAge > 0
    ? Math.min(maxAge, TEMP_URL_MAX_AGE_SECONDS)
    : TEMP_URL_MAX_AGE_SECONDS;
}

async function resolveProductImageAccessUrls({ cloud, db, teamId, products, now }) {
  const documents = Array.isArray(products) ? products.slice(0, MAX_TEMP_URL_BATCH_SIZE) : [];
  const descriptors = documents
    .map((document) => getInternalImageDescriptor(document, teamId))
    .filter(Boolean);
  const accessByProductId = new Map();
  descriptors.forEach((descriptor) => {
    accessByProductId.set(descriptor.productId, createUnavailableAccess());
  });
  if (!descriptors.length) return accessByProductId;

  const uniqueAssetKeys = Array.from(new Set(descriptors.map((descriptor) => descriptor.assetKey)));
  const assets = await Promise.all(uniqueAssetKeys.map((assetKey) => {
    return getDocument(db, COLLECTIONS.PRODUCT_IMAGE_ASSETS, assetKey);
  }));
  const assetByKey = new Map();
  uniqueAssetKeys.forEach((assetKey, index) => assetByKey.set(assetKey, assets[index]));

  const validDescriptors = descriptors.filter((descriptor) => {
    return isViewableBoundAsset(assetByKey.get(descriptor.assetKey), descriptor, teamId);
  });
  const fileIds = Array.from(new Set(validDescriptors.map((descriptor) => descriptor.fileId)));
  if (!fileIds.length || !cloud || typeof cloud.getTempFileURL !== 'function') {
    return accessByProductId;
  }

  let result;
  try {
    result = await cloud.getTempFileURL({
      fileList: fileIds.map((fileID) => ({
        fileID,
        maxAge: TEMP_URL_MAX_AGE_SECONDS
      }))
    });
  } catch (error) {
    return accessByProductId;
  }

  const resolvedAt = now instanceof Date ? now : new Date();
  const urlByFileId = new Map();
  (result && Array.isArray(result.fileList) ? result.fileList : []).forEach((item) => {
    const imageUrl = item && typeof item.tempFileURL === 'string' ? item.tempFileURL.trim() : '';
    if (!item || item.status !== 0 || !item.fileID || !/^https:\/\//i.test(imageUrl)) return;
    const maxAge = getResultMaxAge(item);
    urlByFileId.set(item.fileID, {
      imageUrl,
      imageUrlExpiresAt: new Date(resolvedAt.getTime() + maxAge * 1000).toISOString(),
      imageAvailable: true
    });
  });

  validDescriptors.forEach((descriptor) => {
    const access = urlByFileId.get(descriptor.fileId);
    if (access) accessByProductId.set(descriptor.productId, access);
  });
  return accessByProductId;
}

module.exports = {
  TEMP_URL_MAX_AGE_SECONDS,
  MAX_TEMP_URL_BATCH_SIZE,
  createUnavailableAccess,
  getInternalImageDescriptor,
  isViewableBoundAsset,
  resolveProductImageAccessUrls
};
