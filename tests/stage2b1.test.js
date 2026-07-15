const assert = require('assert');
const { ERROR_CODES } = require('../cloudfunctions/warehouse-api/common/errors.js');
const {
  normalizeInviteCode,
  isValidInviteCode,
  validateInviteRefreshInput,
  validateJoinApplyInput
} = require('../cloudfunctions/warehouse-api/common/validators.js');
const {
  INVITE_ALPHABET,
  generateInviteCode,
  getRemainingUses,
  isInviteExpired,
  isInviteUsable
} = require('../cloudfunctions/warehouse-api/common/invite-utils.js');
const { presentInvite } = require('../cloudfunctions/warehouse-api/common/presenters.js');
const { ACTION_HANDLERS } = require('../cloudfunctions/warehouse-api/router.js');

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

function run() {
  testInviteCode();
  testInviteAvailability();
  testInviteValidationAndIdentityBoundary();
  testInvitePresentation();
  testInviteRoutes();
  console.log('stage2b1 tests passed');
}

run();
