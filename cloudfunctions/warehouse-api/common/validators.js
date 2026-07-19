const { ApiError, ERROR_CODES } = require('./errors.js');

const TEAM_NAME_MIN_LENGTH = 2;
const TEAM_NAME_MAX_LENGTH = 30;
const WAREHOUSE_NAME_MIN_LENGTH = 1;
const WAREHOUSE_NAME_MAX_LENGTH = 30;
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const INVITE_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,8}$/;
const MEMBER_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const FORBIDDEN_IDENTITY_FIELDS = ['openId', 'userId', 'teamId', 'warehouseId', 'createdBy', 'invitedBy'];
const {
  normalizeTeamNickname,
  normalizeAdminNote,
  normalizeTeamDisplayName,
  validateAvatarKey
} = require('./member-profile.js');

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

function rejectUnknownFields(source, allowedFields) {
  const unknown = Object.keys(source).find((field) => !allowedFields.includes(field));
  if (unknown) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, '请求包含不允许的字段。');
  }
}

function normalizeLimitedText(value, maxLength, errorMessage) {
  const text = normalizeText(value);
  if (text.length > maxLength) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, errorMessage);
  }
  return text;
}

function validateMemberListInput(data) {
  const source = data && typeof data === 'object' ? data : {};
  rejectUnknownFields(source, ['status', 'role', 'keyword']);
  const status = normalizeText(source.status);
  const role = normalizeText(source.role);
  if (status && !['active', 'pending'].includes(status)) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, '成员状态筛选值无效。');
  }
  if (role && !['owner', 'admin', 'viewer'].includes(role)) {
    throw new ApiError(ERROR_CODES.INVALID_ROLE, '成员角色筛选值无效。');
  }
  return {
    status,
    role,
    keyword: normalizeLimitedText(source.keyword, 30, '搜索关键词不能超过30个字符。')
  };
}

function validateMemberReviewInput(data) {
  const source = data && typeof data === 'object' ? data : {};
  rejectUnknownFields(source, ['memberId', 'decision', 'remark', 'requestKey']);
  const decision = normalizeText(source.decision);
  if (!['approve', 'reject'].includes(decision)) {
    throw new ApiError(ERROR_CODES.INVALID_REVIEW_DECISION, '审核决定必须为通过或拒绝。');
  }
  return {
    memberId: validateMemberId(source.memberId),
    decision,
    remark: normalizeLimitedText(source.remark, 200, '审核备注不能超过200个字符。'),
    requestKey: validateRequestKey(source.requestKey)
  };
}

function validateMemberRoleInput(data) {
  const source = data && typeof data === 'object' ? data : {};
  rejectUnknownFields(source, ['memberId', 'role', 'requestKey']);
  const role = normalizeText(source.role);
  if (!['admin', 'viewer'].includes(role)) {
    throw new ApiError(ERROR_CODES.INVALID_ROLE, '目标角色只能是管理员或普通成员。');
  }
  return {
    memberId: validateMemberId(source.memberId),
    role,
    requestKey: validateRequestKey(source.requestKey)
  };
}

function validateMemberRemoveInput(data) {
  const source = data && typeof data === 'object' ? data : {};
  rejectUnknownFields(source, ['memberId', 'reason', 'requestKey']);
  return {
    memberId: validateMemberId(source.memberId),
    reason: normalizeLimitedText(source.reason, 200, '移除原因不能超过200个字符。'),
    requestKey: validateRequestKey(source.requestKey)
  };
}

function validateLeaveInput(data) {
  const source = data && typeof data === 'object' ? data : {};
  rejectUnknownFields(source, ['requestKey']);
  return { requestKey: validateRequestKey(source.requestKey) };
}

function validateMemberProfileUpdateInput(data) {
  const source = data && typeof data === 'object' ? data : {};
  rejectUnknownFields(source, ['teamNickname', 'avatarKey']);
  if (!Object.prototype.hasOwnProperty.call(source, 'teamNickname') &&
      !Object.prototype.hasOwnProperty.call(source, 'avatarKey')) {
    throw new ApiError(ERROR_CODES.INVALID_INPUT, '请至少提交一项成员资料。');
  }
  const result = {};
  if (Object.prototype.hasOwnProperty.call(source, 'teamNickname')) {
    result.teamNickname = normalizeTeamNickname(source.teamNickname);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'avatarKey')) {
    result.avatarKey = validateAvatarKey(source.avatarKey);
  }
  return result;
}

function validateMemberAdminNoteInput(data) {
  const source = data && typeof data === 'object' ? data : {};
  rejectUnknownFields(source, ['targetMemberId', 'adminNote']);
  return {
    targetMemberId: validateMemberId(source.targetMemberId),
    adminNote: normalizeAdminNote(source.adminNote)
  };
}

function validateTeamDisplayNameInput(data) {
  const source = data && typeof data === 'object' ? data : {};
  rejectUnknownFields(source, ['displayName']);
  return { displayName: normalizeTeamDisplayName(source.displayName) };
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
  rejectUnknownFields,
  validateMemberListInput,
  validateMemberReviewInput,
  validateMemberRoleInput,
  validateMemberRemoveInput,
  validateLeaveInput,
  validateMemberProfileUpdateInput,
  validateMemberAdminNoteInput,
  validateTeamDisplayNameInput,
  FORBIDDEN_IDENTITY_FIELDS,
  sanitizeTeamCreateInput,
  validateTeamCreateInput
};
