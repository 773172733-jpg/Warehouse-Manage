const { ApiError, ERROR_CODES } = require('./errors.js');

const AVATAR_KEYS = Object.freeze([
  'pixel_01',
  'pixel_02',
  'pixel_03',
  'pixel_04',
  'pixel_05',
  'pixel_06',
  'pixel_07',
  'pixel_08',
  'pixel_09',
  'pixel_10',
  'pixel_11',
  'pixel_12'
]);

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MARKUP_PATTERN = /[<>]/u;

function countCharacters(value) {
  return Array.from(value).length;
}

function normalizeProfileText(value, fieldName, maxLength, allowEmpty) {
  if (typeof value !== 'string') {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, `${fieldName}格式无效。`);
  }
  const text = value.trim();
  if (!text && value.length > 0) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, `${fieldName}不能只包含空白字符。`);
  }
  if (!text && !allowEmpty) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, `请填写${fieldName}。`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(text) || MARKUP_PATTERN.test(text)) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, `${fieldName}包含不支持的字符。`);
  }
  if (countCharacters(text) > maxLength) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, `${fieldName}不能超过${maxLength}个字符。`);
  }
  return text;
}

function normalizeTeamNickname(value) {
  return normalizeProfileText(value, '团队昵称', 20, true);
}

function normalizeAdminNote(value) {
  return normalizeProfileText(value, '管理备注', 40, true);
}

function normalizeTeamDisplayName(value) {
  const text = normalizeProfileText(value, '团队名称', 30, false);
  if (countCharacters(text) < 2) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, '团队名称不能少于2个字符。');
  }
  return text;
}

function validateAvatarKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!AVATAR_KEYS.includes(key)) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, '请选择有效的内置像素头像。');
  }
  return key;
}

function getStableAvatarKey(memberId) {
  const text = String(memberId || 'member');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;
  }
  return AVATAR_KEYS[hash % AVATAR_KEYS.length];
}

function getMemberAvatarKey(membership) {
  const key = membership && membership.avatarKey;
  return AVATAR_KEYS.includes(key) ? key : getStableAvatarKey(membership && membership._id);
}

function getMemberDisplayName(membership, user) {
  const teamNickname = membership && typeof membership.teamNickname === 'string'
    ? membership.teamNickname.trim()
    : '';
  return teamNickname || (user && user.displayName) || '微信用户';
}

module.exports = {
  AVATAR_KEYS,
  countCharacters,
  normalizeProfileText,
  normalizeTeamNickname,
  normalizeAdminNote,
  normalizeTeamDisplayName,
  validateAvatarKey,
  getStableAvatarKey,
  getMemberAvatarKey,
  getMemberDisplayName
};
