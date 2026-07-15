const assert = require('assert');
const fs = require('fs');
const {
  getPagePermissionFlags,
  mapInviteResponse,
  mapMemberResponse,
  getMemberStatistics,
  ensureActionIntent,
  getInviteErrorMessage,
  getReviewErrorMessage,
  shouldReuseInviteRequestKey,
  shouldReuseReviewRequestKey
} = require('../miniprogram/pages/team/team-utils.js');
const {
  buildInviteRefreshPayload,
  buildMemberReviewPayload
} = require('../miniprogram/services/team-service.js');

function testRoleVisibility() {
  const owner = getPagePermissionFlags('owner');
  const admin = getPagePermissionFlags('admin');
  const viewer = getPagePermissionFlags('viewer');
  assert.strictEqual(owner.canManageInvites, true);
  assert.strictEqual(owner.canViewPending, true);
  assert.strictEqual(owner.canReviewMembers, true);
  assert.strictEqual(admin.canManageInvites, false);
  assert.strictEqual(admin.canViewPending, false);
  assert.strictEqual(viewer.canManageInvites, false);
  assert.strictEqual(viewer.canViewPending, false);
}

function testInviteMapping() {
  assert.deepStrictEqual(mapInviteResponse({ invite: null }), {
    hasInvite: false,
    code: '',
    expiresAtText: '—',
    usedCount: 0,
    maxUses: 0,
    remainingUses: 0,
    requiresApproval: true,
    approvalLabel: '需要审核'
  });

  const mapped = mapInviteResponse({
    invite: {
      code: 'ABCD23',
      expiresAt: '2030-01-02T03:04:00.000Z',
      usedCount: 2,
      maxUses: 20,
      remainingUses: 18,
      requiresApproval: true,
      requestKey: 'secret',
      createdBy: 'secret-user'
    }
  });
  assert.strictEqual(mapped.hasInvite, true);
  assert.strictEqual(mapped.code, 'ABCD23');
  assert.strictEqual(mapped.usedCount, 2);
  assert.strictEqual(mapped.maxUses, 20);
  assert.strictEqual(mapped.remainingUses, 18);
  assert.strictEqual(mapped.approvalLabel, '需要审核');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(mapped, 'requestKey'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(mapped, 'createdBy'), false);
}

function testRequestIntentReuse() {
  let keyCount = 0;
  const keyFactory = (prefix) => `${prefix}_key_${++keyCount}000000`;
  const first = ensureActionIntent('invite-refresh', null, 'invite', keyFactory);
  const retry = ensureActionIntent('invite-refresh', first, 'invite', keyFactory);
  const changed = ensureActionIntent('member:approve', retry, 'review', keyFactory);
  assert.strictEqual(first, retry);
  assert.notStrictEqual(changed.requestKey, first.requestKey);
  assert.strictEqual(keyCount, 2);
  assert.strictEqual(shouldReuseInviteRequestKey({ code: 'CLOUD_CALL_FAILED' }), true);
  assert.strictEqual(shouldReuseInviteRequestKey({ code: 'INVALID_REQUEST_KEY' }), false);
  assert.strictEqual(shouldReuseReviewRequestKey({ code: 'DATABASE_ERROR' }), true);
  assert.strictEqual(shouldReuseReviewRequestKey({ code: 'MEMBER_NOT_FOUND' }), false);
}

function testMemberMappingAndStatistics() {
  const response = {
    members: [
      {
        id: 'member_owner',
        displayName: '创建者',
        role: 'owner',
        status: 'active',
        joinedAt: '2030-01-01T00:00:00.000Z',
        memberRemark: '',
        isCurrentUser: true,
        userId: 'secret-user',
        openId: 'secret-openid'
      },
      {
        id: 'member_viewer',
        displayName: '成员甲',
        role: 'viewer',
        status: 'active',
        joinedAt: null,
        memberRemark: '仓库同事',
        isCurrentUser: false
      }
    ]
  };
  const active = mapMemberResponse(response, 'active');
  const pending = mapMemberResponse({
    members: [{
      id: 'member_pending',
      displayName: '申请人',
      role: 'viewer',
      status: 'pending',
      appliedAt: '2030-01-02T00:00:00.000Z'
    }]
  }, 'pending');
  assert.strictEqual(active.length, 2);
  assert.strictEqual(active[0].name, '创建者');
  assert.strictEqual(active[0].isCurrentUser, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(active[0], 'userId'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(active[0], 'openId'), false);
  assert.strictEqual(pending[0].statusLabel, '待审核');

  assert.deepStrictEqual(getMemberStatistics(active, pending, true), {
    all: 2,
    owner: 1,
    admin: 0,
    viewer: 1,
    pending: 1
  });
  assert.strictEqual(getMemberStatistics(active, pending, false).pending, 0);
}

function testPayloadWhitelists() {
  assert.deepStrictEqual(buildInviteRefreshPayload({
    requestKey: 'invite_abc12345',
    expiresInHours: 24,
    maxUses: 20,
    teamId: 'forged-team',
    userId: 'forged-user',
    role: 'owner',
    openId: 'forged-openid'
  }), {
    requestKey: 'invite_abc12345',
    expiresInHours: 24,
    maxUses: 20
  });

  ['approve', 'reject'].forEach((decision) => {
    assert.deepStrictEqual(buildMemberReviewPayload({
      memberId: 'member_12345678',
      decision,
      remark: '',
      requestKey: 'review_abc12345',
      teamId: 'forged-team',
      userId: 'forged-user',
      role: 'admin',
      openId: 'forged-openid'
    }), {
      memberId: 'member_12345678',
      decision,
      remark: '',
      requestKey: 'review_abc12345'
    });
  });
}

function testErrorMessages() {
  assert.strictEqual(getInviteErrorMessage({ code: 'FORBIDDEN' }), '只有团队创建者可以管理邀请码');
  assert.strictEqual(getInviteErrorMessage({ code: 'INVALID_MAX_USES' }), '邀请码使用次数设置不正确');
  assert.strictEqual(getReviewErrorMessage({ code: 'MEMBER_NOT_FOUND' }), '该申请不存在或已被处理');
  assert.strictEqual(getReviewErrorMessage({ code: 'MEMBERSHIP_NOT_PENDING' }), '该申请已处理，请刷新列表');
  assert.strictEqual(getReviewErrorMessage({ code: 'CLOUD_CALL_FAILED' }), '网络连接失败，请检查网络后重试');
}

function testNoMockOrDirectCloudUsage() {
  const source = fs.readFileSync(require.resolve('../miniprogram/pages/team/team.js'), 'utf8');
  assert.strictEqual(source.includes('mock-members'), false);
  assert.strictEqual(source.includes('MOCK_'), false);
  assert.strictEqual(source.includes('wx.cloud'), false);
  assert.strictEqual(source.includes('.database('), false);
  assert.strictEqual(/setStorage(?:Sync)?\s*\(/.test(source), false);
  assert.strictEqual(source.includes('this.inviteRefreshIntent = null;'), true);
  assert.strictEqual(source.includes('return this.refreshPage();'), true);
}

function run() {
  testRoleVisibility();
  testInviteMapping();
  testRequestIntentReuse();
  testMemberMappingAndStatistics();
  testPayloadWhitelists();
  testErrorMessages();
  testNoMockOrDirectCloudUsage();
  console.log('stage2b2b1 tests passed');
}

run();
