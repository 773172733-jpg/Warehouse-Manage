const assert = require('assert');
const { createRequestKey } = require('../miniprogram/utils/request-key.js');
const {
  JOIN_VIEW_STATES,
  STARTUP_DESTINATIONS,
  normalizeInviteCode,
  validateInviteCode,
  getJoinErrorMessage,
  mapJoinStatus,
  decideStartupDestination,
  ensureJoinRequestIntent
} = require('../miniprogram/utils/team-join.js');
const { buildJoinApplyPayload } = require('../miniprogram/services/team-service.js');

function testInviteCodeNormalizationAndValidation() {
  assert.strictEqual(normalizeInviteCode(' abcd23 '), 'ABCD23');
  assert.strictEqual(normalizeInviteCode('ab cd 23'), 'ABCD23');
  assert.strictEqual(normalizeInviteCode('abcdefghijk'), 'ABCDEFGHIJK');
  assert.deepStrictEqual(validateInviteCode('  '), {
    valid: false,
    code: '',
    message: '请输入团队邀请码'
  });
  assert.strictEqual(validateInviteCode('ABCD23').valid, true);
  assert.strictEqual(validateInviteCode('ABCI23').valid, false);
  assert.strictEqual(validateInviteCode('ABC12').valid, false);
  assert.strictEqual(validateInviteCode('ABCDEFGHJ').valid, false);
}

function testErrorMessages() {
  assert.strictEqual(getJoinErrorMessage({ code: 'INVALID_INVITE_CODE' }), '邀请码格式不正确');
  assert.strictEqual(getJoinErrorMessage({ code: 'INVITE_NOT_FOUND' }), '没有找到该邀请码');
  assert.strictEqual(getJoinErrorMessage({ code: 'INVITE_EXPIRED' }), '邀请码已过期，请联系团队创建者刷新');
  assert.strictEqual(getJoinErrorMessage({ code: 'INVITE_REVOKED' }), '邀请码已失效，请联系团队创建者获取新邀请码');
  assert.strictEqual(getJoinErrorMessage({ code: 'INVITE_USAGE_EXCEEDED' }), '邀请码使用次数已达到上限');
  assert.strictEqual(getJoinErrorMessage({ code: 'CLOUD_CALL_FAILED' }), '网络连接失败，请检查网络后重试');
  assert.strictEqual(getJoinErrorMessage({ message: 'raw database stack' }), '操作失败，请稍后重试');
}

function testJoinStateMapping() {
  assert.strictEqual(mapJoinStatus({ application: null }).viewState, JOIN_VIEW_STATES.INPUT);
  assert.strictEqual(mapJoinStatus({ application: { status: 'pending' } }).viewState, JOIN_VIEW_STATES.PENDING);
  assert.strictEqual(mapJoinStatus({
    application: { status: 'removed', reviewResult: 'rejected' }
  }).viewState, JOIN_VIEW_STATES.REJECTED);
  assert.strictEqual(mapJoinStatus({
    application: { status: 'removed', reviewResult: null }
  }).viewState, JOIN_VIEW_STATES.REMOVED);
  assert.strictEqual(mapJoinStatus({ application: { status: 'active' } }).viewState, JOIN_VIEW_STATES.APPROVED);
  assert.strictEqual(mapJoinStatus(undefined).viewState, JOIN_VIEW_STATES.ERROR);
}

function testRequestKeyIntentReuse() {
  let count = 0;
  const keyFactory = () => `join_key_${++count}000000`;
  const first = ensureJoinRequestIntent('ABCD23', null, keyFactory);
  const retry = ensureJoinRequestIntent('ABCD23', first, keyFactory);
  const changed = ensureJoinRequestIntent('WXYZ45', retry, keyFactory);

  assert.strictEqual(first, retry);
  assert.strictEqual(changed.code, 'WXYZ45');
  assert.notStrictEqual(changed.requestKey, first.requestKey);
  assert.strictEqual(count, 2);

  const generated = createRequestKey('join', {
    now: () => 1000,
    random: () => 0.5
  });
  assert.strictEqual(/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(generated), true);
}

function testJoinPayloadWhitelist() {
  const payload = buildJoinApplyPayload({
    code: 'ABCD23',
    requestKey: 'join_abc12345',
    teamId: 'forged_team',
    userId: 'forged_user',
    role: 'owner',
    openId: 'forged_openid'
  });
  assert.deepStrictEqual(payload, {
    code: 'ABCD23',
    requestKey: 'join_abc12345'
  });
}

function testStartupRouting() {
  const noTeam = {
    onboardingRequired: true,
    membership: null,
    team: null
  };
  const activeTeam = {
    onboardingRequired: false,
    membership: { status: 'active', teamId: 'team_1' },
    team: { id: 'team_1', status: 'active' }
  };
  const pending = { application: { status: 'pending' } };

  assert.strictEqual(
    decideStartupDestination(activeTeam, pending),
    STARTUP_DESTINATIONS.INVENTORY
  );
  assert.strictEqual(
    decideStartupDestination(noTeam, pending),
    STARTUP_DESTINATIONS.TEAM_JOIN
  );
  assert.strictEqual(
    decideStartupDestination(noTeam, { application: { status: 'removed', reviewResult: 'rejected' } }),
    STARTUP_DESTINATIONS.TEAM_JOIN
  );
  assert.strictEqual(
    decideStartupDestination(noTeam, { application: { status: 'active' } }),
    STARTUP_DESTINATIONS.REFRESH_BOOTSTRAP
  );
  assert.strictEqual(
    decideStartupDestination(noTeam, { application: null }),
    STARTUP_DESTINATIONS.TEAM_SETUP
  );
  assert.strictEqual(
    decideStartupDestination(noTeam, undefined),
    STARTUP_DESTINATIONS.ERROR
  );
}

function run() {
  testInviteCodeNormalizationAndValidation();
  testErrorMessages();
  testJoinStateMapping();
  testRequestKeyIntentReuse();
  testJoinPayloadWhitelist();
  testStartupRouting();
  console.log('stage2b2a tests passed');
}

run();
