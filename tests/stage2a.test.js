const assert = require('assert');
const {
  isValidTeamName,
  isValidWarehouseName,
  isValidRequestKey,
  sanitizeTeamCreateInput
} = require('../cloudfunctions/warehouse-api/common/validators.js');
const {
  hasRole,
  ROLE_LEVELS
} = require('../cloudfunctions/warehouse-api/common/permissions.js');
const {
  buildBootstrapResponse
} = require('../cloudfunctions/warehouse-api/common/presenters.js');
const { ok, fail } = require('../cloudfunctions/warehouse-api/common/response.js');
const { ACTION_HANDLERS, dispatch } = require('../cloudfunctions/warehouse-api/router.js');
const {
  createUserId,
  createTeamId,
  createWarehouseId,
  createMembershipId
} = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const {
  normalizeBootstrapResult,
  normalizeRequiredBootstrapResult
} = require('../miniprogram/services/bootstrap-state.js');
const {
  isCompleteExistingTeam
} = require('../cloudfunctions/warehouse-api/modules/team/team-service.js');

function testNames() {
  assert.strictEqual(isValidTeamName('轻仓'), true);
  assert.strictEqual(isValidTeamName(' A '), false);
  assert.strictEqual(isValidTeamName('x'.repeat(31)), false);
  assert.strictEqual(isValidWarehouseName('默认仓库'), true);
  assert.strictEqual(isValidWarehouseName('  '), false);
  assert.strictEqual(isValidWarehouseName('x'.repeat(31)), false);
}

function testRequestKeyAndIdentitySanitizing() {
  assert.strictEqual(isValidRequestKey('team_abc12345'), true);
  assert.strictEqual(isValidRequestKey('short'), false);
  assert.deepStrictEqual(sanitizeTeamCreateInput({
    name: ' 轻仓团队 ',
    warehouseName: ' 默认仓库 ',
    requestKey: 'team_abc12345',
    ownerId: 'forged-owner',
    userId: 'forged-user',
    role: 'owner',
    openId: 'forged-openid',
    teamId: 'forged-team'
  }), {
    name: '轻仓团队',
    warehouseName: '默认仓库',
    requestKey: 'team_abc12345'
  });

  const userId = createUserId('trusted-openid-for-test');
  const teamId = createTeamId(userId, 'team_abc12345');
  assert.strictEqual(createUserId('trusted-openid-for-test'), userId);
  assert.strictEqual(createTeamId(userId, 'team_abc12345'), teamId);
  assert.notStrictEqual(createTeamId(userId, 'team_other123'), teamId);
  assert.strictEqual(createWarehouseId(teamId), createWarehouseId(teamId));
  assert.strictEqual(createMembershipId(teamId, userId), createMembershipId(teamId, userId));
}

function testPermissions() {
  assert.deepStrictEqual(ROLE_LEVELS, {
    viewer: 10,
    admin: 20,
    owner: 30
  });
  assert.strictEqual(hasRole('owner', 'admin'), true);
  assert.strictEqual(hasRole('admin', 'admin'), true);
  assert.strictEqual(hasRole('viewer', 'admin'), false);
  assert.strictEqual(hasRole('unknown', 'viewer'), false);
}

function testIdempotentTeamCompleteness() {
  const user = { _id: 'usr_1', currentTeamId: 'team_1', currentWarehouseId: 'wh_1' };
  const team = {
    _id: 'team_1',
    status: 'active',
    defaultWarehouseId: 'wh_1'
  };
  const warehouse = {
    _id: 'wh_1',
    teamId: 'team_1',
    status: 'active',
    isDefault: true
  };
  const membership = {
    teamId: 'team_1',
    userId: 'usr_1',
    status: 'active',
    role: 'owner'
  };

  assert.strictEqual(isCompleteExistingTeam(team, warehouse, membership, user), true);
  assert.strictEqual(isCompleteExistingTeam(team, null, membership, user), false);
  assert.strictEqual(isCompleteExistingTeam(team, warehouse, Object.assign({}, membership, { role: 'admin' }), user), false);
}

function testBootstrapPresentationAndCleaning() {
  const empty = buildBootstrapResponse({
    user: { _id: 'usr_1', displayName: '微信用户', status: 'active', openId: 'secret' }
  });
  assert.strictEqual(empty.onboardingRequired, true);
  assert.strictEqual(empty.membership, null);
  assert.strictEqual(empty.team, null);
  assert.strictEqual(empty.warehouse, null);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(empty.user, 'openId'), false);

  const cleaned = normalizeBootstrapResult({
    user: { id: 'usr_1', displayName: '用户', status: 'active', openId: 'secret' },
    membership: { teamId: 'team_1', role: 'owner', status: 'active', userId: 'usr_1' },
    team: { id: 'team_1', name: '轻仓', status: 'active', ownerId: 'usr_1' },
    warehouse: { id: 'wh_1', name: '默认仓库', isDefault: true, status: 'active', createdBy: 'usr_1' }
  });
  assert.strictEqual(cleaned.onboardingRequired, false);
  assert.strictEqual(cleaned.membership.role, 'owner');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(cleaned.user, 'openId'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(cleaned.team, 'ownerId'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(cleaned.warehouse, 'createdBy'), false);

  const mismatched = normalizeBootstrapResult({
    user: { id: 'usr_1' },
    membership: { teamId: 'team_other', role: 'owner', status: 'active' },
    team: { id: 'team_1', name: '轻仓', status: 'active' }
  });
  assert.strictEqual(mismatched.onboardingRequired, true);
  assert.strictEqual(mismatched.team, null);
  assert.throws(
    () => normalizeRequiredBootstrapResult({}),
    (error) => error.code === 'BOOTSTRAP_FAILED'
  );
}

function testResponses() {
  const success = ok({ status: 'ok' }, 'req_test_001');
  assert.strictEqual(success.success, true);
  assert.strictEqual(success.requestId, 'req_test_001');
  assert.strictEqual(typeof success.timestamp, 'number');

  const error = fail('INVALID_TEAM_NAME', '团队名称无效。', 'req_test_002');
  assert.deepStrictEqual(error.error, {
    code: 'INVALID_TEAM_NAME',
    message: '团队名称无效。'
  });
  assert.strictEqual(error.success, false);
}

async function testRouterWhitelist() {
  const actions = Object.keys(ACTION_HANDLERS);
  [
    'system.ping',
    'team.create',
    'team.current',
    'user.bootstrap'
  ].forEach((action) => assert.strictEqual(actions.includes(action), true));
  const result = await dispatch({
    action: 'not.allowed',
    requestId: 'req_unknown_001'
  }, {});
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error.code, 'UNKNOWN_ACTION');
  assert.strictEqual(result.requestId, 'req_unknown_001');
}

async function run() {
  testNames();
  testRequestKeyAndIdentitySanitizing();
  testPermissions();
  testIdempotentTeamCompleteness();
  testBootstrapPresentationAndCleaning();
  testResponses();
  await testRouterWhitelist();

  console.log('stage2a tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
