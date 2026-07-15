const assert = require('assert');
const { ERROR_CODES } = require('../cloudfunctions/warehouse-api/common/errors.js');
const {
  normalizeInviteCode,
  isValidInviteCode,
  validateInviteRefreshInput,
  validateJoinApplyInput,
  validateMemberListInput,
  validateMemberReviewInput,
  validateMemberRoleInput,
  validateMemberRemoveInput,
  validateLeaveInput
} = require('../cloudfunctions/warehouse-api/common/validators.js');
const {
  INVITE_ALPHABET,
  generateInviteCode,
  getRemainingUses,
  isInviteExpired,
  isInviteUsable
} = require('../cloudfunctions/warehouse-api/common/invite-utils.js');
const {
  presentInvite,
  presentMember
} = require('../cloudfunctions/warehouse-api/common/presenters.js');
const {
  canViewMemberStatus,
  isRoleTransitionAllowed,
  canLeaveTeam,
  canChangeMemberRole,
  canRemoveMember
} = require('../cloudfunctions/warehouse-api/common/member-utils.js');
const { ACTION_HANDLERS } = require('../cloudfunctions/warehouse-api/router.js');
const { createInviteId } = require('../cloudfunctions/warehouse-api/common/idempotency.js');

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

function testInviteCode() {
  const code = generateInviteCode(() => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  assert.strictEqual(code.length, 8);
  assert.strictEqual([...code].every((character) => INVITE_ALPHABET.includes(character)), true);
  assert.strictEqual(isValidInviteCode(code), true);
  assert.strictEqual(normalizeInviteCode(' abcd 2345 '), 'ABCD2345');
  assert.strictEqual(isValidInviteCode('O0I1'), false);
  assert.strictEqual(
    createInviteId('team_1', 'usr_1', 'invite_abc12345'),
    createInviteId('team_1', 'usr_1', 'invite_abc12345')
  );
  assert.notStrictEqual(
    createInviteId('team_1', 'usr_1', 'invite_abc12345'),
    createInviteId('team_1', 'usr_2', 'invite_abc12345')
  );
}

function testInviteAvailability() {
  const invite = {
    status: 'active',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    maxUses: 20,
    usedCount: 3
  };
  assert.strictEqual(getRemainingUses(invite), 17);
  assert.strictEqual(isInviteExpired(invite, Date.parse('2029-01-01T00:00:00.000Z')), false);
  assert.strictEqual(isInviteExpired(invite, Date.parse('2030-01-01T00:00:00.000Z')), true);
  assert.strictEqual(isInviteUsable(invite, Date.parse('2029-01-01T00:00:00.000Z')), true);
  assert.strictEqual(isInviteUsable(Object.assign({}, invite, { usedCount: 20 })), false);
}

function testInviteValidationAndIdentityBoundary() {
  assert.deepStrictEqual(validateInviteRefreshInput({ requestKey: 'invite_abc12345' }), {
    requestKey: 'invite_abc12345',
    expiresInHours: 24,
    maxUses: 20
  });
  expectCode(
    () => validateInviteRefreshInput({ requestKey: 'invite_abc12345', expiresInHours: 0 }),
    ERROR_CODES.INVALID_INVITE_EXPIRY
  );
  expectCode(
    () => validateInviteRefreshInput({ requestKey: 'invite_abc12345', maxUses: 101 }),
    ERROR_CODES.INVALID_MAX_USES
  );
  assert.deepStrictEqual(validateJoinApplyInput({
    code: ' abcd2345 ',
    requestKey: 'join_abc12345'
  }), {
    code: 'ABCD2345',
    requestKey: 'join_abc12345'
  });
  expectCode(
    () => validateJoinApplyInput({
      code: 'ABCD2345',
      requestKey: 'join_abc12345',
      userId: 'forged-user'
    }),
    ERROR_CODES.FORBIDDEN
  );
}

function testInvitePresentation() {
  const invite = presentInvite({
    code: 'ABCD2345',
    status: 'active',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    maxUses: 20,
    usedCount: 2,
    requiresApproval: true,
    createdBy: 'usr_secret',
    requestKey: 'invite_secret'
  });
  assert.strictEqual(invite.remainingUses, 18);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(invite, 'createdBy'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(invite, 'requestKey'), false);
}

function testInviteRoutes() {
  [
    'team.invite.current',
    'team.invite.refresh',
    'team.join.apply',
    'team.join.status'
  ].forEach((action) => assert.strictEqual(typeof ACTION_HANDLERS[action], 'function'));
}

function testMemberPermissionMatrix() {
  assert.strictEqual(canViewMemberStatus('owner', 'active'), true);
  assert.strictEqual(canViewMemberStatus('owner', 'pending'), true);
  assert.strictEqual(canViewMemberStatus('admin', 'active'), true);
  assert.strictEqual(canViewMemberStatus('admin', 'pending'), false);
  assert.strictEqual(canViewMemberStatus('viewer', 'pending'), false);
  assert.strictEqual(canViewMemberStatus('pending', 'active'), false);
  assert.strictEqual(isRoleTransitionAllowed('viewer', 'admin'), true);
  assert.strictEqual(isRoleTransitionAllowed('admin', 'viewer'), true);
  assert.strictEqual(isRoleTransitionAllowed('owner', 'viewer'), false);
  assert.strictEqual(canLeaveTeam('owner'), false);
  assert.strictEqual(canLeaveTeam('admin'), true);
  assert.strictEqual(canLeaveTeam('viewer'), true);

  const owner = { userId: 'usr_owner', role: 'owner', status: 'active' };
  const viewer = { userId: 'usr_viewer', role: 'viewer', status: 'active' };
  assert.strictEqual(canChangeMemberRole('usr_owner', viewer, 'admin'), true);
  assert.strictEqual(canChangeMemberRole('usr_owner', owner, 'viewer'), false);
  assert.strictEqual(canRemoveMember('usr_owner', viewer), true);
  assert.strictEqual(canRemoveMember('usr_owner', owner), false);
  assert.strictEqual(canRemoveMember('usr_viewer', viewer), false);
}

function testMemberValidationAndIdentityBoundary() {
  assert.deepStrictEqual(validateMemberListInput({ status: 'pending', role: 'viewer', keyword: ' 张 ' }), {
    status: 'pending',
    role: 'viewer',
    keyword: '张'
  });
  assert.deepStrictEqual(validateMemberReviewInput({
    memberId: 'member_12345678',
    decision: 'approve',
    requestKey: 'review_abc12345'
  }), {
    memberId: 'member_12345678',
    decision: 'approve',
    remark: '',
    requestKey: 'review_abc12345'
  });
  expectCode(
    () => validateMemberReviewInput({
      memberId: 'member_12345678',
      decision: 'approve',
      requestKey: 'review_abc12345',
      teamId: 'forged-team',
      role: 'admin'
    }),
    ERROR_CODES.FORBIDDEN
  );
  expectCode(
    () => validateMemberReviewInput({
      memberId: 'member_12345678',
      decision: 'promote',
      requestKey: 'review_abc12345'
    }),
    ERROR_CODES.INVALID_REVIEW_DECISION
  );
  expectCode(
    () => validateMemberRoleInput({
      memberId: 'member_12345678',
      role: 'owner',
      requestKey: 'role_abc12345'
    }),
    ERROR_CODES.INVALID_ROLE
  );
  assert.strictEqual(validateMemberRemoveInput({
    memberId: 'member_12345678',
    requestKey: 'remove_abc12345'
  }).reason, '');
  assert.deepStrictEqual(validateLeaveInput({ requestKey: 'leave_abc12345' }), {
    requestKey: 'leave_abc12345'
  });
}

function testMemberPresentation() {
  const member = presentMember({
    _id: 'member_12345678',
    userId: 'usr_1',
    role: 'viewer',
    status: 'pending',
    appliedAt: 'time',
    applyRequestKey: 'secret-request'
  }, {
    _id: 'usr_1',
    displayName: '成员甲',
    avatarUrl: '',
    openId: 'secret-openid'
  }, 'usr_owner');
  assert.strictEqual(member.id, 'member_12345678');
  assert.strictEqual(member.appliedAt, 'time');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(member, 'userId'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(member, 'openId'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(member, 'applyRequestKey'), false);
}

function testMemberRoutes() {
  [
    'team.member.list',
    'team.member.review',
    'team.member.role.update',
    'team.member.remove',
    'team.leave'
  ].forEach((action) => assert.strictEqual(typeof ACTION_HANDLERS[action], 'function'));
}

function run() {
  testInviteCode();
  testInviteAvailability();
  testInviteValidationAndIdentityBoundary();
  testInvitePresentation();
  testInviteRoutes();
  testMemberPermissionMatrix();
  testMemberValidationAndIdentityBoundary();
  testMemberPresentation();
  testMemberRoutes();
  console.log('stage2b1 tests passed');
}

run();
