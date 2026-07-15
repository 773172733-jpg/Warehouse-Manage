const assert = require('assert');
const fs = require('fs');
const teamService = require('../miniprogram/services/team-service.js');
const {
  ensureActionIntent,
  getMemberDetailActions,
  getMembershipActionErrorMessage,
  getPagePermissionFlags,
  isMembershipContextInvalid,
  shouldReuseMembershipRequestKey
} = require('../miniprogram/pages/team/team-utils.js');
const {
  buildMemberRolePayload,
  buildMemberRemovePayload,
  buildLeavePayload
} = teamService;

function loadPageConfig() {
  let config = null;
  global.Page = (value) => {
    config = value;
  };
  const path = require.resolve('../miniprogram/pages/team/team.js');
  delete require.cache[path];
  require('../miniprogram/pages/team/team.js');
  delete global.Page;
  return config;
}

function loadAppConfig() {
  let config = null;
  global.App = (value) => {
    config = value;
  };
  const path = require.resolve('../miniprogram/app.js');
  delete require.cache[path];
  require('../miniprogram/app.js');
  delete global.App;
  return config;
}

function createPageContext() {
  return {
    isActive: true,
    memberRoleIntent: null,
    memberRemoveIntent: null,
    leaveIntent: null,
    data: {
      memberOperation: { memberId: '', action: '' },
      permission: getPagePermissionFlags('owner'),
      leaving: false
    },
    setData(update) {
      this.data = Object.assign({}, this.data, update);
    },
    dismissMemberSheet() {
      this.sheetDismissed = true;
    },
    refreshPage(options) {
      this.refreshOptions = options || {};
      this.refreshCount = (this.refreshCount || 0) + 1;
      return Promise.resolve();
    },
    finishMembershipExit() {
      this.exitFinished = true;
      return Promise.resolve();
    },
    reconcileLeaveState() {
      this.leaveReconciled = true;
      return Promise.resolve();
    }
  };
}

function testPermissionAndMemberActions() {
  const owner = { id: 'owner', role: 'owner', status: 'active', isCurrentUser: true };
  const viewer = { id: 'viewer', role: 'viewer', status: 'active', isCurrentUser: false };
  const admin = { id: 'admin', role: 'admin', status: 'active', isCurrentUser: false };

  assert.deepStrictEqual(getMemberDetailActions('owner', owner), {
    canChangeRole: false,
    canRemove: false,
    targetRole: '',
    roleActionLabel: '',
    isOwnerSelf: true
  });
  assert.strictEqual(getMemberDetailActions('owner', viewer).targetRole, 'admin');
  assert.strictEqual(getMemberDetailActions('owner', viewer).canRemove, true);
  assert.strictEqual(getMemberDetailActions('owner', admin).targetRole, 'viewer');
  assert.strictEqual(getMemberDetailActions('admin', viewer).canChangeRole, false);
  assert.strictEqual(getMemberDetailActions('viewer', admin).canRemove, false);
  assert.strictEqual(getPagePermissionFlags('owner').canLeaveTeam, false);
  assert.strictEqual(getPagePermissionFlags('admin').canLeaveTeam, true);
  assert.strictEqual(getPagePermissionFlags('viewer').canLeaveTeam, true);
}

function testPayloadWhitelists() {
  const forged = {
    memberId: 'member_12345678',
    role: 'admin',
    reason: '由团队创建者移出团队',
    requestKey: 'member_abc12345',
    teamId: 'forged-team',
    userId: 'forged-user',
    openId: 'forged-openid',
    ownerId: 'forged-owner'
  };
  assert.deepStrictEqual(buildMemberRolePayload(forged), {
    memberId: 'member_12345678',
    role: 'admin',
    requestKey: 'member_abc12345'
  });
  assert.strictEqual(buildMemberRolePayload(Object.assign({}, forged, { role: 'viewer' })).role, 'viewer');
  assert.deepStrictEqual(buildMemberRemovePayload(forged), {
    memberId: 'member_12345678',
    reason: '由团队创建者移出团队',
    requestKey: 'member_abc12345'
  });
  assert.deepStrictEqual(buildLeavePayload(forged), {
    requestKey: 'member_abc12345'
  });
  assert.throws(() => buildMemberRolePayload(Object.assign({}, forged, { role: 'owner' })), (error) => {
    return error.code === 'INVALID_ROLE';
  });
}

function testErrorMessagesAndIntentReuse() {
  assert.strictEqual(
    getMembershipActionErrorMessage('role', { code: 'CANNOT_CHANGE_OWNER' }),
    '团队创建者角色不能修改'
  );
  assert.strictEqual(
    getMembershipActionErrorMessage('remove', { code: 'CANNOT_REMOVE_SELF' }),
    '不能将自己移出团队'
  );
  assert.strictEqual(
    getMembershipActionErrorMessage('leave', { code: 'OWNER_CANNOT_LEAVE' }),
    '团队创建者暂不支持退出团队'
  );
  assert.strictEqual(shouldReuseMembershipRequestKey({ code: 'CLOUD_CALL_FAILED' }), true);
  assert.strictEqual(shouldReuseMembershipRequestKey({ code: 'MEMBER_NOT_FOUND' }), false);
  assert.strictEqual(isMembershipContextInvalid({ code: 'NO_ACTIVE_TEAM' }), true);

  let count = 0;
  const keyFactory = () => `member_key_${++count}000000`;
  const first = ensureActionIntent('member:admin', null, 'member-role', keyFactory);
  const retry = ensureActionIntent('member:admin', first, 'member-role', keyFactory);
  const changed = ensureActionIntent('member:viewer', retry, 'member-role', keyFactory);
  assert.strictEqual(first, retry);
  assert.notStrictEqual(first.requestKey, changed.requestKey);
}

async function testRealActionCallsAndRefresh() {
  const page = loadPageConfig();
  const originalRole = teamService.updateMemberRole;
  const originalRemove = teamService.removeMember;
  const originalLeave = teamService.leaveTeam;
  global.wx = { showToast() {} };

  try {
    const roleCalls = [];
    teamService.updateMemberRole = (payload) => {
      roleCalls.push(payload);
      if (roleCalls.length === 1) {
        return Promise.reject({ code: 'CLOUD_CALL_FAILED' });
      }
      return Promise.resolve({ member: { role: 'admin' } });
    };
    const roleContext = createPageContext();
    const viewer = { id: 'member_viewer', targetRole: 'admin' };
    await page.executeMemberRoleChange.call(roleContext, viewer);
    const retryKey = roleContext.memberRoleIntent.requestKey;
    await page.executeMemberRoleChange.call(roleContext, viewer);
    assert.strictEqual(roleCalls[0].requestKey, retryKey);
    assert.strictEqual(roleCalls[1].requestKey, retryKey);
    assert.strictEqual(roleContext.memberRoleIntent, null);
    assert.strictEqual(roleContext.refreshCount, 2);

    let removePayload = null;
    teamService.removeMember = (payload) => {
      removePayload = payload;
      return Promise.resolve({ member: { status: 'removed' } });
    };
    const removeContext = createPageContext();
    await page.executeRemoveMember.call(removeContext, { id: 'member_admin', name: '管理员' });
    assert.deepStrictEqual(Object.keys(removePayload).sort(), ['memberId', 'reason', 'requestKey']);
    assert.strictEqual(removeContext.refreshCount, 1);
    assert.strictEqual(removeContext.sheetDismissed, true);

    let leavePayload = null;
    let leaveCalls = 0;
    teamService.leaveTeam = (payload) => {
      leaveCalls += 1;
      leavePayload = payload;
      return Promise.resolve({ left: true });
    };
    const leaveContext = createPageContext();
    leaveContext.data.permission = getPagePermissionFlags('viewer');
    await page.executeLeaveTeam.call(leaveContext);
    assert.deepStrictEqual(Object.keys(leavePayload), ['requestKey']);
    assert.strictEqual(leaveContext.leaveIntent, null);
    assert.strictEqual(leaveContext.exitFinished, true);

    const ownerContext = createPageContext();
    await page.executeLeaveTeam.call(ownerContext);
    assert.strictEqual(leaveCalls, 1);
  } finally {
    teamService.updateMemberRole = originalRole;
    teamService.removeMember = originalRemove;
    teamService.leaveTeam = originalLeave;
    delete global.wx;
  }
}

function testGlobalContextCleanupAndSourceBoundaries() {
  const app = loadAppConfig();
  const appContext = {
    globalData: {
      user: { id: 'user_1' },
      currentMembership: { role: 'viewer' },
      currentTeam: { id: 'team_1' },
      currentRole: 'viewer',
      currentWarehouse: { id: 'warehouse_1' },
      bootstrapStatus: 'success'
    }
  };
  app.clearTeamContext.call(appContext);
  assert.deepStrictEqual(appContext.globalData.user, { id: 'user_1' });
  assert.strictEqual(appContext.globalData.currentMembership, null);
  assert.strictEqual(appContext.globalData.currentTeam, null);
  assert.strictEqual(appContext.globalData.currentRole, null);
  assert.strictEqual(appContext.globalData.currentWarehouse, null);
  assert.strictEqual(appContext.globalData.bootstrapStatus, 'idle');

  const teamSource = fs.readFileSync(require.resolve('../miniprogram/pages/team/team.js'), 'utf8');
  assert.strictEqual(teamSource.includes('mock-members'), false);
  assert.strictEqual(teamSource.includes('wx.cloud'), false);
  assert.strictEqual(teamSource.includes('.database('), false);
  assert.strictEqual(/setStorage(?:Sync)?\s*\(/.test(teamSource), false);
  assert.strictEqual(teamSource.includes('refreshPage({ forceBootstrap: true })'), true);
  assert.strictEqual(teamSource.includes('app.clearTeamContext();'), true);
}

async function run() {
  testPermissionAndMemberActions();
  testPayloadWhitelists();
  testErrorMessagesAndIntentReuse();
  await testRealActionCallsAndRefresh();
  testGlobalContextCleanupAndSourceBoundaries();
  console.log('stage2b2b2 tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
