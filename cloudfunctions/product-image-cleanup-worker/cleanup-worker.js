const crypto = require('crypto');

const FORMAL_ENV_ID = 'cloud1-d8gm59cz2be4e7c23';
const ASSET_COLLECTION = 'product_image_assets';
const PRODUCT_COLLECTION = 'products';
const BATCH_SIZE = 20;
const LEASE_MS = 5 * 60 * 1000;
const MAX_CLEANUP_ATTEMPTS = 8;
const MAX_RETRY_MS = 24 * 60 * 60 * 1000;
const RETRY_BASE_MS = 15 * 60 * 1000;
const CLEANUP_STATUSES = ['awaiting_upload', 'staged', 'rejected', 'orphaned', 'bound'];
const SOURCE_PATH_PATTERN = /^product-images\/uploads\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i;
const VERIFIED_PATH_PATTERN = /^product-images\/verified\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i;

const ERROR_CODES = {
  LEASE_CONFLICT: 'IMAGE_CLEANUP_LEASE_CONFLICT',
  NOT_DUE: 'IMAGE_CLEANUP_NOT_DUE',
  STATE_CONFLICT: 'IMAGE_CLEANUP_STATE_CONFLICT',
  PATH_INVALID: 'IMAGE_CLEANUP_PATH_INVALID',
  FILE_IN_USE: 'IMAGE_CLEANUP_FILE_IN_USE',
  DELETE_FAILED: 'IMAGE_CLEANUP_DELETE_FAILED',
  PARTIAL_FAILED: 'IMAGE_CLEANUP_PARTIAL_FAILED',
  RETRY_EXHAUSTED: 'IMAGE_CLEANUP_RETRY_EXHAUSTED'
};

function createWorkerRunId() {
  return `cleanup_${crypto.randomBytes(8).toString('hex')}`;
}

function createLeaseToken() {
  return crypto.randomBytes(24).toString('hex');
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function addMilliseconds(value, milliseconds) {
  return new Date(value.getTime() + milliseconds);
}

function isDue(asset, now) {
  const cleanupAfter = toDate(asset && asset.cleanupAfter);
  if (cleanupAfter) return cleanupAfter.getTime() <= now.getTime();
  if (asset && asset.status === 'awaiting_upload') {
    const expiresAt = toDate(asset.expiresAt);
    return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
  }
  return false;
}

function isLeaseActive(asset, now) {
  const leaseUntil = toDate(asset && asset.cleanupLeaseUntil);
  return asset && asset.cleanupState === 'processing' &&
    Boolean(leaseUntil && leaseUntil.getTime() > now.getTime());
}

function getRetryDelayMs(attemptCount) {
  const safeAttempt = Math.max(1, Math.min(Number(attemptCount) || 1, MAX_CLEANUP_ATTEMPTS));
  return Math.min(RETRY_BASE_MS * (2 ** (safeAttempt - 1)), MAX_RETRY_MS);
}

function maskAssetKey(assetKey) {
  const value = typeof assetKey === 'string' ? assetKey : '';
  return value ? `${value.slice(0, 12)}...` : 'unknown';
}

function parseCloudFileId(fileId) {
  const value = typeof fileId === 'string' ? fileId.trim() : '';
  const match = /^cloud:\/\/([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\/([A-Za-z0-9_./-]+)$/.exec(value);
  return match
    ? { fileId: value, envId: match[1], bucket: match[2], cloudPath: match[3] }
    : null;
}

function validateCleanupFile(fileId, envId, kind, expectedCloudPath) {
  const parsed = parseCloudFileId(fileId);
  const pattern = kind === 'source' ? SOURCE_PATH_PATTERN : VERIFIED_PATH_PATTERN;
  if (!parsed || parsed.envId !== envId || !pattern.test(parsed.cloudPath) ||
      parsed.cloudPath !== expectedCloudPath) {
    return { valid: false, errorCode: ERROR_CODES.PATH_INVALID };
  }
  return { valid: true, fileId: parsed.fileId, kind };
}

async function getDocument(source, collectionName, documentId) {
  try {
    const result = await source.collection(collectionName).doc(documentId).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    const message = error && (error.errMsg || error.message || '');
    if (/not exist|not found|does not exist/i.test(message)) return null;
    throw error;
  }
}

async function queryCleanupCandidates(db, now, batchSize = BATCH_SIZE) {
  const command = db.command;
  const result = await db.collection(ASSET_COLLECTION)
    .where({
      status: command.in(CLEANUP_STATUSES),
      cleanupAfter: command.lte(now)
    })
    .orderBy('status', 'asc')
    .orderBy('cleanupAfter', 'asc')
    .orderBy('_id', 'asc')
    .limit(Math.min(batchSize, BATCH_SIZE))
    .get();
  return result && Array.isArray(result.data) ? result.data : [];
}

async function claimCleanupLease(db, assetId, now, options = {}) {
  const leaseToken = typeof options.createLeaseToken === 'function'
    ? options.createLeaseToken()
    : createLeaseToken();
  let outcome = { claimed: false, errorCode: ERROR_CODES.STATE_CONFLICT };
  await db.runTransaction(async (transaction) => {
    const asset = await getDocument(transaction, ASSET_COLLECTION, assetId);
    if (!asset || !CLEANUP_STATUSES.includes(asset.status) ||
        asset.cleanupState === 'completed') {
      outcome = { claimed: false, errorCode: ERROR_CODES.STATE_CONFLICT };
      return;
    }
    if (!isDue(asset, now)) {
      outcome = { claimed: false, errorCode: ERROR_CODES.NOT_DUE };
      return;
    }
    if (isLeaseActive(asset, now)) {
      outcome = { claimed: false, errorCode: ERROR_CODES.LEASE_CONFLICT };
      return;
    }
    if (asset.status === 'staged' && asset.productId) {
      outcome = { claimed: false, errorCode: ERROR_CODES.STATE_CONFLICT };
      return;
    }

    const attemptCount = Math.min(
      Math.max(0, Number(asset.cleanupAttemptCount) || 0) + 1,
      MAX_CLEANUP_ATTEMPTS
    );
    const update = {
      cleanupState: 'processing',
      cleanupAttemptCount: attemptCount,
      cleanupLeaseToken: leaseToken,
      cleanupLeaseUntil: addMilliseconds(now, LEASE_MS),
      cleanupUpdatedAt: now,
      updatedAt: now
    };
    if (asset.status === 'awaiting_upload') {
      Object.assign(update, {
        status: 'rejected',
        rejectionReasonCode: 'IMAGE_UPLOAD_EXPIRED',
        rejectedAt: now
      });
    } else if (asset.status === 'staged') {
      Object.assign(update, {
        status: 'rejected',
        rejectionReasonCode: 'IMAGE_STAGE_EXPIRED',
        rejectedAt: now
      });
    }
    await transaction.collection(ASSET_COLLECTION).doc(assetId).update({ data: update });
    outcome = {
      claimed: true,
      asset: Object.assign({}, asset, update),
      leaseToken
    };
  }, 5);
  return outcome;
}

function requiresVerifiedDeletion(asset) {
  return asset && (asset.status === 'rejected' || asset.status === 'orphaned') &&
    !asset.verifiedDeletedAt && Boolean(asset.fileId);
}

async function ensureVerifiedFileUnused(db, asset) {
  if (!asset.productId) return '';
  const product = await getDocument(db, PRODUCT_COLLECTION, asset.productId);
  if (!product) return '';
  if (product.teamId !== asset.teamId) return ERROR_CODES.STATE_CONFLICT;
  if (product.coverAssetKey === asset._id || product.coverFileId === asset.fileId) {
    return ERROR_CODES.FILE_IN_USE;
  }
  return '';
}

async function buildDeletionPlan(db, asset, envId) {
  const targets = [];
  if (!asset.sourceDeletedAt && asset.sourceUploadFileId) {
    const source = validateCleanupFile(
      asset.sourceUploadFileId,
      envId,
      'source',
      asset.uploadCloudPath
    );
    if (!source.valid) return { asset, targets: [], errorCode: source.errorCode };
    targets.push(source);
  }

  if (requiresVerifiedDeletion(asset)) {
    const referenceError = await ensureVerifiedFileUnused(db, asset);
    if (referenceError) return { asset, targets: [], errorCode: referenceError };
    const verified = validateCleanupFile(
      asset.fileId,
      envId,
      'verified',
      asset.verifiedCloudPath
    );
    if (!verified.valid) return { asset, targets: [], errorCode: verified.errorCode };
    targets.push(verified);
  }
  return { asset, targets, errorCode: '' };
}

function isMissingFileResult(item) {
  const message = item && typeof item.errMsg === 'string' ? item.errMsg : '';
  return /not exist|not found|does not exist|file.*不存在/i.test(message);
}

async function deletePlannedFiles(cloud, plans) {
  const fileIds = Array.from(new Set(plans.flatMap((plan) => {
    return plan.errorCode ? [] : plan.targets.map((target) => target.fileId);
  })));
  const results = new Map();
  if (!fileIds.length) return { results, wholeFailure: false };
  if (!cloud || typeof cloud.deleteFile !== 'function') {
    fileIds.forEach((fileId) => results.set(fileId, {
      success: false,
      errorCode: ERROR_CODES.DELETE_FAILED
    }));
    return { results, wholeFailure: true };
  }
  let response;
  try {
    response = await cloud.deleteFile({ fileList: fileIds });
  } catch (error) {
    fileIds.forEach((fileId) => results.set(fileId, {
      success: false,
      errorCode: ERROR_CODES.DELETE_FAILED
    }));
    return { results, wholeFailure: true };
  }
  const responseByFile = new Map(
    (response && Array.isArray(response.fileList) ? response.fileList : [])
      .filter((item) => item && typeof item.fileID === 'string')
      .map((item) => [item.fileID, item])
  );
  fileIds.forEach((fileId) => {
    const item = responseByFile.get(fileId);
    const success = Boolean(item && (item.status === 0 || isMissingFileResult(item)));
    results.set(fileId, {
      success,
      errorCode: success ? '' : ERROR_CODES.DELETE_FAILED
    });
  });
  return { results, wholeFailure: false };
}

function evaluatePlanResult(plan, deletion) {
  if (plan.errorCode) {
    return { successfulKinds: [], errorCode: plan.errorCode };
  }
  const successfulKinds = [];
  let failedCount = 0;
  plan.targets.forEach((target) => {
    const result = deletion.results.get(target.fileId);
    if (result && result.success) successfulKinds.push(target.kind);
    else failedCount += 1;
  });
  if (!failedCount) return { successfulKinds, errorCode: '' };
  return {
    successfulKinds,
    errorCode: successfulKinds.length
      ? ERROR_CODES.PARTIAL_FAILED
      : ERROR_CODES.DELETE_FAILED
  };
}

async function finalizeCleanupLease(db, plan, deletion, now) {
  const evaluation = evaluatePlanResult(plan, deletion);
  let outcome = { completed: false, retry: false, skipped: true };
  await db.runTransaction(async (transaction) => {
    const current = await getDocument(transaction, ASSET_COLLECTION, plan.asset._id);
    if (!current || current.cleanupState !== 'processing' ||
        current.cleanupLeaseToken !== plan.asset.cleanupLeaseToken) {
      outcome = {
        completed: false,
        retry: false,
        skipped: true,
        errorCode: ERROR_CODES.LEASE_CONFLICT
      };
      return;
    }
    const update = {
      cleanupLeaseToken: '',
      cleanupLeaseUntil: null,
      cleanupUpdatedAt: now,
      updatedAt: now
    };
    if (evaluation.successfulKinds.includes('source')) update.sourceDeletedAt = now;
    if (evaluation.successfulKinds.includes('verified')) update.verifiedDeletedAt = now;

    if (!evaluation.errorCode) {
      Object.assign(update, {
        cleanupState: 'completed',
        cleanupAfter: null,
        cleanedAt: now,
        lastCleanupErrorCode: '',
        lastCleanupErrorAt: null
      });
      outcome = { completed: true, retry: false, skipped: false };
    } else {
      const exhausted = current.cleanupAttemptCount >= MAX_CLEANUP_ATTEMPTS;
      Object.assign(update, {
        cleanupState: 'retry',
        cleanupAfter: exhausted
          ? null
          : addMilliseconds(now, getRetryDelayMs(current.cleanupAttemptCount)),
        cleanedAt: null,
        lastCleanupErrorCode: exhausted
          ? ERROR_CODES.RETRY_EXHAUSTED
          : evaluation.errorCode,
        lastCleanupErrorAt: now
      });
      outcome = {
        completed: false,
        retry: true,
        skipped: false,
        errorCode: update.lastCleanupErrorCode
      };
    }
    await transaction.collection(ASSET_COLLECTION).doc(current._id).update({ data: update });
  }, 5);
  return outcome;
}

function logSummary(logger, summary) {
  if (!logger || typeof logger.info !== 'function') return;
  logger.info('[ProductImageCleanup] run completed.', summary);
}

async function runCleanupWorker(options = {}) {
  const startedAt = Date.now();
  const now = options.now instanceof Date ? options.now : new Date();
  const runId = typeof options.runId === 'string' && options.runId
    ? options.runId
    : createWorkerRunId();
  const db = options.db;
  const cloud = options.cloud;
  const envId = options.envId;
  if (!db || envId !== FORMAL_ENV_ID) {
    throw new Error(ERROR_CODES.PATH_INVALID);
  }

  const summary = {
    workerRunId: runId,
    candidateCount: 0,
    claimedCount: 0,
    successCount: 0,
    retryCount: 0,
    skippedCount: 0,
    errorCodes: [],
    durationMs: 0
  };
  const candidates = await queryCleanupCandidates(db, now, options.batchSize);
  summary.candidateCount = candidates.length;
  const claims = [];
  for (const candidate of candidates) {
    try {
      const claim = await claimCleanupLease(db, candidate._id, now, {
        createLeaseToken: options.createLeaseToken
      });
      if (claim.claimed) {
        claims.push(claim.asset);
        summary.claimedCount += 1;
      } else {
        summary.skippedCount += 1;
        summary.errorCodes.push(claim.errorCode);
      }
    } catch (error) {
      summary.skippedCount += 1;
      summary.errorCodes.push(ERROR_CODES.STATE_CONFLICT);
    }
  }

  const plans = [];
  for (const asset of claims) {
    try {
      plans.push(await buildDeletionPlan(db, asset, envId));
    } catch (error) {
      plans.push({ asset, targets: [], errorCode: ERROR_CODES.STATE_CONFLICT });
    }
  }
  const deletion = await deletePlannedFiles(cloud, plans);
  for (const plan of plans) {
    try {
      const outcome = await finalizeCleanupLease(db, plan, deletion, now);
      if (outcome.completed) summary.successCount += 1;
      else if (outcome.retry) summary.retryCount += 1;
      else summary.skippedCount += 1;
      if (outcome.errorCode) summary.errorCodes.push(outcome.errorCode);
    } catch (error) {
      summary.retryCount += 1;
      summary.errorCodes.push(ERROR_CODES.STATE_CONFLICT);
    }
  }
  summary.errorCodes = Array.from(new Set(summary.errorCodes));
  summary.durationMs = Date.now() - startedAt;
  logSummary(options.logger, summary);
  return summary;
}

module.exports = {
  FORMAL_ENV_ID,
  ASSET_COLLECTION,
  PRODUCT_COLLECTION,
  BATCH_SIZE,
  LEASE_MS,
  MAX_CLEANUP_ATTEMPTS,
  CLEANUP_STATUSES,
  ERROR_CODES,
  toDate,
  isDue,
  isLeaseActive,
  getRetryDelayMs,
  maskAssetKey,
  parseCloudFileId,
  validateCleanupFile,
  queryCleanupCandidates,
  claimCleanupLease,
  requiresVerifiedDeletion,
  ensureVerifiedFileUnused,
  buildDeletionPlan,
  isMissingFileResult,
  deletePlannedFiles,
  evaluatePlanResult,
  finalizeCleanupLease,
  runCleanupWorker
};
