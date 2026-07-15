const { ERROR_CODES } = require('../constants/errors.js');
const { createRequestKey } = require('./request-key.js');

const INVITE_CODE_MIN_LENGTH = 6;
const INVITE_CODE_MAX_LENGTH = 8;
const INVITE_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,8}$/;

const JOIN_VIEW_STATES = {
  INPUT: 'input',
  PENDING: 'pending',
  REJECTED: 'rejected',
  REMOVED: 'removed',
  APPROVED: 'approved',
  ERROR: 'error'
};

const STARTUP_DESTINATIONS = {
  INVENTORY: 'inventory',
  REFRESH_BOOTSTRAP: 'refresh_bootstrap',
  TEAM_JOIN: 'team_join',
  TEAM_SETUP: 'team_setup',
  ERROR: 'error'
};

const JOIN_ERROR_MESSAGES = {
  [ERROR_CODES.INVALID_INVITE_CODE]: '邀请码格式不正确',
  [ERROR_CODES.INVITE_NOT_FOUND]: '没有找到该邀请码',
  [ERROR_CODES.INVITE_EXPIRED]: '邀请码已过期，请联系团队创建者刷新',
  [ERROR_CODES.INVITE_REVOKED]: '邀请码已失效，请联系团队创建者获取新邀请码',
  [ERROR_CODES.INVITE_USAGE_EXCEEDED]: '邀请码使用次数已达到上限',
  [ERROR_CODES.ALREADY_IN_TEAM]: '你已经加入团队，正在刷新团队信息',
  [ERROR_CODES.JOIN_REQUEST_ALREADY_PENDING]: '你的申请正在等待审核',
  [ERROR_CODES.INVALID_REQUEST_KEY]: '提交状态异常，请重新操作',
  [ERROR_CODES.DATABASE_ERROR]: '服务暂时不可用，请稍后重试',
  [ERROR_CODES.INTERNAL_ERROR]: '操作失败，请稍后重试',
  [ERROR_CODES.CLOUD_CALL_FAILED]: '网络连接失败，请检查网络后重试',
  [ERROR_CODES.CLOUD_NOT_AVAILABLE]: '网络连接失败，请检查网络后重试'
};

function normalizeInviteCode(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, '').toUpperCase()
    : '';
}

function validateInviteCode(value) {
  const code = normalizeInviteCode(value);
  if (!code) {
    return { valid: false, code, message: '请输入团队邀请码' };
  }
  if (code.length < INVITE_CODE_MIN_LENGTH || !INVITE_CODE_PATTERN.test(code)) {
    return { valid: false, code, message: JOIN_ERROR_MESSAGES[ERROR_CODES.INVALID_INVITE_CODE] };
  }
  return { valid: true, code, message: '' };
}

function getJoinErrorMessage(error) {
  const code = error && error.code;
  return JOIN_ERROR_MESSAGES[code] || '操作失败，请稍后重试';
}

function cleanTeam(team) {
  if (!team || typeof team !== 'object') {
    return null;
  }
  return {
    id: team.id ? String(team.id) : '',
    name: team.name || '未命名团队',
    status: team.status || ''
  };
}

function mapJoinStatus(response) {
  if (!response || typeof response !== 'object' || !Object.prototype.hasOwnProperty.call(response, 'application')) {
    return { viewState: JOIN_VIEW_STATES.ERROR, application: null };
  }

  const source = response.application;
  if (!source) {
    return { viewState: JOIN_VIEW_STATES.INPUT, application: null };
  }

  const application = {
    status: source.status || '',
    team: cleanTeam(source.team),
    appliedAt: source.appliedAt || null,
    reviewedAt: source.reviewedAt || null,
    reviewResult: source.reviewResult || null,
    reviewRemark: source.reviewRemark || ''
  };

  if (application.status === 'active') {
    return { viewState: JOIN_VIEW_STATES.APPROVED, application };
  }
  if (application.status === 'pending') {
    return { viewState: JOIN_VIEW_STATES.PENDING, application };
  }
  if (application.status === 'rejected' || application.reviewResult === 'rejected') {
    return { viewState: JOIN_VIEW_STATES.REJECTED, application };
  }
  if (application.status === 'removed') {
    return { viewState: JOIN_VIEW_STATES.REMOVED, application };
  }
  return { viewState: JOIN_VIEW_STATES.ERROR, application };
}

function hasActiveTeam(bootstrapResult) {
  return Boolean(
    bootstrapResult &&
    bootstrapResult.onboardingRequired === false &&
    bootstrapResult.team &&
    bootstrapResult.membership &&
    bootstrapResult.membership.status === 'active'
  );
}

function decideStartupDestination(bootstrapResult, joinStatusResponse) {
  if (hasActiveTeam(bootstrapResult)) {
    return STARTUP_DESTINATIONS.INVENTORY;
  }

  const mapped = mapJoinStatus(joinStatusResponse);
  if (mapped.viewState === JOIN_VIEW_STATES.APPROVED) {
    return STARTUP_DESTINATIONS.REFRESH_BOOTSTRAP;
  }
  if ([JOIN_VIEW_STATES.PENDING, JOIN_VIEW_STATES.REJECTED, JOIN_VIEW_STATES.REMOVED].includes(mapped.viewState)) {
    return STARTUP_DESTINATIONS.TEAM_JOIN;
  }
  if (mapped.viewState === JOIN_VIEW_STATES.INPUT) {
    return STARTUP_DESTINATIONS.TEAM_SETUP;
  }
  return STARTUP_DESTINATIONS.ERROR;
}

function ensureJoinRequestIntent(code, currentIntent, keyFactory = createRequestKey) {
  const normalizedCode = normalizeInviteCode(code);
  if (currentIntent && currentIntent.code === normalizedCode && currentIntent.requestKey) {
    return currentIntent;
  }
  return {
    code: normalizedCode,
    requestKey: keyFactory('join')
  };
}

function formatApplicationTime(value) {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

module.exports = {
  INVITE_CODE_MIN_LENGTH,
  INVITE_CODE_MAX_LENGTH,
  INVITE_CODE_PATTERN,
  JOIN_VIEW_STATES,
  STARTUP_DESTINATIONS,
  JOIN_ERROR_MESSAGES,
  normalizeInviteCode,
  validateInviteCode,
  getJoinErrorMessage,
  mapJoinStatus,
  hasActiveTeam,
  decideStartupDestination,
  ensureJoinRequestIntent,
  formatApplicationTime
};
