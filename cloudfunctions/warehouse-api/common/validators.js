const { ApiError, ERROR_CODES } = require('./errors.js');

const TEAM_NAME_MIN_LENGTH = 2;
const TEAM_NAME_MAX_LENGTH = 30;
const WAREHOUSE_NAME_MIN_LENGTH = 1;
const WAREHOUSE_NAME_MAX_LENGTH = 30;
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

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
  sanitizeTeamCreateInput,
  validateTeamCreateInput
};
