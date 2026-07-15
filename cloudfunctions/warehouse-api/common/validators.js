const { ApiError, ERROR_CODES } = require('./errors.js');

const TEAM_NAME_MIN_LENGTH = 2;
const TEAM_NAME_MAX_LENGTH = 30;
const WAREHOUSE_NAME_MIN_LENGTH = 1;
const WAREHOUSE_NAME_MAX_LENGTH = 30;
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const INVITE_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,8}$/;
const MEMBER_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const FORBIDDEN_IDENTITY_FIELDS = ['openId', 'userId', 'teamId', 'warehouseId', 'createdBy', 'invitedBy'];

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidTeamName(value) {
  const name = normalizeText(value);
  return name.length >= TEAM_NAME_MIN_LENGTH && name.length <= TEAM_NAME_MAX_LENGTH;
}

function isValidWarehouseName(value) {
  const name = normalizeText(value);
  return name.length >= WAREHOUSE_NAME_MIN_LENGTH && name.length <= WAREHOUSE_NAME_MAX_LENGTH;
}

function isValidRequestKey(value) {
  const requestKey = normalizeText(value);
  return REQUEST_KEY_PATTERN.test(requestKey);
}

function normalizeInviteCode(value) {
  return normalizeText(value).replace(/\s+/g, '').toUpperCase();
}

function isValidInviteCode(value) {
  return INVITE_CODE_PATTERN.test(normalizeInviteCode(value));
}

function rejectFields(source, fields) {
  const forbidden = fields.find((field) => Object.prototype.hasOwnProperty.call(source, field));
  if (forbidden) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '请求包含不允许由客户端指定的身份字段。');
  }
}

function validateRequestKey(requestKey) {
  const normalized = normalizeText(requestKey);
  if (!isValidRequestKey(normalized)) {
    throw new ApiError(ERROR_CODES.INVALID_REQUEST_KEY, '请求标识无效，请重新提交。');
  }
  return normalized;
}

function validateInviteRefreshInput(data) {
  const source = data && typeof data === 'object' ? data : {};
  rejectFields(source, FORBIDDEN_IDENTITY_FIELDS.concat(['code', 'status']));
  const expiresInHours = source.expiresInHours === undefined ? 24 : Number(source.expiresInHours);
  const maxUses = source.maxUses === undefined ? 20 : Number(source.maxUses);
  if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) {
    throw new ApiError(ERROR_CODES.INVALID_INVITE_EXPIRY, '邀请码有效期需为1至168小时。');
  }
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) {
    throw new ApiError(ERROR_CODES.INVALID_MAX_USES, '邀请码使用次数需为1至100次。');
  }
  return {
    requestKey: validateRequestKey(source.requestKey),
    expiresInHours,
    maxUses
  };
}

function validateJoinApplyInput(data) {
  const source = data && typeof data === 'object' ? data : {};
  rejectFields(source, FORBIDDEN_IDENTITY_FIELDS.concat(['role', 'status']));
  const code = normalizeInviteCode(source.code);
  if (!isValidInviteCode(code)) {
    throw new ApiError(ERROR_CODES.INVALID_INVITE_CODE, '邀请码格式无效。');
  }
  return {
    code,
    requestKey: validateRequestKey(source.requestKey)
  };
}

function validateMemberId(value) {
  const memberId = normalizeText(value);
  if (!MEMBER_ID_PATTERN.test(memberId)) {
    throw new ApiError(ERROR_CODES.MEMBER_NOT_FOUND, '成员不存在。');
  }
  return memberId;
}

function sanitizeTeamCreateInput(data) {
  const source = data && typeof data === 'object' ? data : {};
  return {
    name: normalizeText(source.name),
    warehouseName: normalizeText(source.warehouseName),
    requestKey: normalizeText(source.requestKey)
  };
}

function validateTeamCreateInput(data) {
  const input = sanitizeTeamCreateInput(data);

  if (!isValidTeamName(input.name)) {
    throw new ApiError(ERROR_CODES.INVALID_TEAM_NAME, '团队名称需为2至30个字符。');
  }
  if (!isValidWarehouseName(input.warehouseName)) {
    throw new ApiError(ERROR_CODES.INVALID_WAREHOUSE_NAME, '默认仓库名称需为1至30个字符。');
  }
  if (!isValidRequestKey(input.requestKey)) {
    throw new ApiError(ERROR_CODES.INVALID_REQUEST_KEY, '请求标识无效，请重新提交。');
  }

  return input;
}

module.exports = {
  normalizeText,
  isValidTeamName,
  isValidWarehouseName,
  isValidRequestKey,
  normalizeInviteCode,
  isValidInviteCode,
  rejectFields,
  validateRequestKey,
  validateInviteRefreshInput,
  validateJoinApplyInput,
  validateMemberId,
  FORBIDDEN_IDENTITY_FIELDS,
  sanitizeTeamCreateInput,
  validateTeamCreateInput
};
