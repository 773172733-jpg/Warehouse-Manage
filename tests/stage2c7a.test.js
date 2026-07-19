const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ApiError, ERROR_CODES } = require('../cloudfunctions/warehouse-api/common/errors.js');
const { createMembershipId } = require('../cloudfunctions/warehouse-api/common/idempotency.js');
const {
  AVATAR_KEYS,
  getStableAvatarKey,
  getMemberDisplayName
} = require('../cloudfunctions/warehouse-api/common/member-profile.js');
const {
  updateSelfProfile,
  updateAdminNote,
  listMembers
} = require('../cloudfunctions/warehouse-api/modules/team/member-service.js');
const {
  updateDisplayName
} = require('../cloudfunctions/warehouse-api/modules/team/team-service.js');
const { presentMember } = require('../cloudfunctions/warehouse-api/common/presenters.js');
const clientService = require('../miniprogram/services/team-service.js');
const clientAvatars = require('../miniprogram/constants/member-avatars.js');

const TEAM_ID = 'team_profile_12345678';
const OTHER_TEAM_ID = 'team_other_12345678';
const WAREHOUSE_ID = 'warehouse_profile_12345678';
const USERS = {
  owner: 'user_owner_12345678',
  admin: 'user_admin_12345678',
  viewer: 'user_viewer_12345678',
  pending: 'user_pending_12345678',
  removed: 'user_removed_12345678',
  other: 'user_other_12345678'
};

function expectCode(callback, code) {
  assert.throws(callback, (error) => error instanceof ApiError && error.code === code);
}

async function expectAsyncCode(callback, code) {
  await assert.rejects(callback, (error) => error && error.code === code);
}

function createFixture() {
  const documents = {
    users: new Map(),
    teams: new Map(),
    team_members: new Map(),
    warehouses: new Map()
  };
  Object.entries(USERS).forEach(([name, id]) => {
    documents.users.set(id, {
      _id: id,
      openId: `openid_${name}`,
      displayName: `${name}默认名`,
      avatarUrl: `https://not-returned.example/${name}.png`,
      status: 'active',
      currentTeamId: name === 'other' ? OTHER_TEAM_ID : TEAM_ID,
      currentWarehouseId: WAREHOUSE_ID
    });
  });
  documents.teams.set(TEAM_ID, {
    _id: TEAM_ID,
    ownerId: USERS.owner,
    name: '原团队名称',
    defaultWarehouseId: WAREHOUSE_ID,
    status: 'active'
  });
  documents.teams.set(OTHER_TEAM_ID, {
    _id: OTHER_TEAM_ID,
    ownerId: USERS.other,
    name: '其他团队',
    defaultWarehouseId: 'warehouse_other_12345678',
    status: 'active'
  });
  documents.warehouses.set(WAREHOUSE_ID, {
    _id: WAREHOUSE_ID,
    teamId: TEAM_ID,
    name: '主仓库',
    status: 'active',
    isDefault: true
  });
  function addMembership(userId, role, status, teamId = TEAM_ID) {
    const id = createMembershipId(teamId, userId);
    documents.team_members.set(id, {
      _id: id,
      teamId,
      userId,
      role,
      status,
      joinedAt: new Date('2026-07-19T00:00:00Z'),
      adminNote: status === 'active' ? `${role}内部备注` : '',
      updatedAt: new Date('2026-07-19T00:00:00Z')
    });
    return id;
  }
  const membershipIds = {
    owner: addMembership(USERS.owner, 'owner', 'active'),
    admin: addMembership(USERS.admin, 'admin', 'active'),
    viewer: addMembership(USERS.viewer, 'viewer', 'active'),
    pending: addMembership(USERS.pending, 'viewer', 'pending'),
    removed: addMembership(USERS.removed, 'viewer', 'removed'),
    other: addMembership(USERS.other, 'owner', 'active', OTHER_TEAM_ID)
  };

  function source() {
    return {
      collection(name) {
        const collection = documents[name];
        assert.ok(collection, `unknown collection ${name}`);
        let where = {};
        let limit = Infinity;
        const api = {
          doc(id) {
            return {
              async get() {
                return { data: collection.get(id) || null };
              },
              async update({ data }) {
                const current = collection.get(id);
                assert.ok(current, `missing ${name}/${id}`);
                collection.set(id, Object.assign({}, current, data));
              }
            };
          },
          where(value) {
            where = value || {};
            return api;
          },
          limit(value) {
            limit = value;
            return api;
          },
          async get() {
            return {
              data: Array.from(collection.values())
                .filter((item) => Object.keys(where).every((key) => item[key] === where[key]))
                .slice(0, limit)
            };
          }
        };
        return api;
      }
    };
  }

  const db = source();
  let clock = 0;
  db.serverDate = () => new Date(Date.UTC(2026, 6, 19, 0, 0, clock++));
  db.runTransaction = async (callback) => callback(source());
  return {
    db,
    documents,
    membershipIds,
    user(role) {
      return documents.users.get(USERS[role]);
    }
  };
}

async function testSelfProfiles() {
  for (const role of ['owner', 'admin', 'viewer']) {
    const fixture = createFixture();
    const user = fixture.user(role);
    const membership = fixture.documents.team_members.get(fixture.membershipIds[role]);
    const originalRole = membership.role;
    const response = await updateSelfProfile(fixture.db, user, {
      teamNickname: ` ${role}新昵称 `,
      avatarKey: 'pixel_12'
    });
    assert.strictEqual(response.member.displayName, `${role}新昵称`);
    assert.strictEqual(response.member.avatarKey, 'pixel_12');
    assert.strictEqual(membership.role, originalRole);
  }

  const fixture = createFixture();
  await expectAsyncCode(
    () => updateSelfProfile(fixture.db, fixture.user('viewer'), {
      targetMemberId: fixture.membershipIds.admin,
      teamNickname: '越权'
    }),
    ERROR_CODES.FORBIDDEN
  );
  for (const teamNickname of ['   ', '<script>', `超${'长'.repeat(20)}`, '控制\u0001字符']) {
    await expectAsyncCode(
      () => updateSelfProfile(fixture.db, fixture.user('viewer'), { teamNickname }),
      ERROR_CODES.INVALID_INPUT
    );
  }
  await expectAsyncCode(
    () => updateSelfProfile(fixture.db, fixture.user('viewer'), { avatarKey: 'pixel_99' }),
    ERROR_CODES.INVALID_INPUT
  );
  await updateSelfProfile(fixture.db, fixture.user('viewer'), { avatarKey: 'pixel_01' });
  assert.strictEqual(
    fixture.documents.team_members.get(fixture.membershipIds.viewer).avatarKey,
    'pixel_01'
  );
}

async function testAdminNotes() {
  for (const role of ['owner', 'admin']) {
    const fixture = createFixture();
    const target = fixture.documents.team_members.get(fixture.membershipIds.viewer);
    const originalRole = target.role;
    const result = await updateAdminNote(fixture.db, fixture.user(role), {
      targetMemberId: fixture.membershipIds.viewer,
      adminNote: ` ${role}填写 `
    });
    assert.strictEqual(result.member.adminNote, `${role}填写`);
    assert.strictEqual(target.role, originalRole);
    await updateAdminNote(fixture.db, fixture.user(role), {
      targetMemberId: fixture.membershipIds.viewer,
      adminNote: ''
    });
    assert.strictEqual(
      fixture.documents.team_members.get(fixture.membershipIds.viewer).adminNote,
      ''
    );
  }

  const fixture = createFixture();
  await expectAsyncCode(
    () => updateAdminNote(fixture.db, fixture.user('viewer'), {
      targetMemberId: fixture.membershipIds.admin,
      adminNote: '越权'
    }),
    ERROR_CODES.FORBIDDEN
  );
  await expectAsyncCode(
    () => updateAdminNote(fixture.db, fixture.user('admin'), {
      targetMemberId: fixture.membershipIds.admin,
      adminNote: '给自己'
    }),
    ERROR_CODES.FORBIDDEN
  );
  await expectAsyncCode(
    () => updateAdminNote(fixture.db, fixture.user('admin'), {
      targetMemberId: fixture.membershipIds.other,
      adminNote: '跨团队'
    }),
    ERROR_CODES.MEMBER_NOT_FOUND
  );
  await expectAsyncCode(
    () => updateAdminNote(fixture.db, fixture.user('owner'), {
      targetMemberId: fixture.membershipIds.removed,
      adminNote: '已移除'
    }),
    ERROR_CODES.MEMBERSHIP_NOT_ACTIVE
  );
  await expectAsyncCode(
    () => updateAdminNote(fixture.db, fixture.user('owner'), {
      targetMemberId: fixture.membershipIds.viewer,
      adminNote: '长'.repeat(41)
    }),
    ERROR_CODES.INVALID_INPUT
  );
}

async function testSafeMemberProjection() {
  for (const role of ['owner', 'admin']) {
    const fixture = createFixture();
    const response = await listMembers(fixture.db, fixture.user(role), { status: 'active' });
    assert.ok(response.members.length >= 3);
    response.members.forEach((member) => {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(member, 'adminNote'), true);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(member, 'openId'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(member, 'userId'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(member, 'avatarUrl'), false);
    });
  }

  const fixture = createFixture();
  const response = await listMembers(fixture.db, fixture.user('viewer'), { status: 'active' });
  response.members.forEach((member) => {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(member, 'adminNote'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(member, 'openId'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(member, 'userId'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(member, 'memberRemark'), false);
  });
}

async function testTeamNamePermissions() {
  const fixture = createFixture();
  const originalOwner = fixture.documents.teams.get(TEAM_ID).ownerId;
  const response = await updateDisplayName(fixture.db, fixture.user('owner'), {
    displayName: ' 新团队名称 '
  });
  assert.strictEqual(response.team.name, '新团队名称');
  assert.strictEqual(fixture.documents.teams.get(TEAM_ID).ownerId, originalOwner);
  assert.strictEqual(fixture.documents.warehouses.get(WAREHOUSE_ID).name, '主仓库');

  for (const role of ['admin', 'viewer']) {
    const denied = createFixture();
    await expectAsyncCode(
      () => updateDisplayName(denied.db, denied.user(role), { displayName: '越权团队' }),
      ERROR_CODES.FORBIDDEN
    );
  }
  await expectAsyncCode(
    () => updateDisplayName(createFixture().db, fixture.user('owner'), {
      displayName: '伪造团队',
      teamId: OTHER_TEAM_ID
    }),
    ERROR_CODES.FORBIDDEN
  );
  await expectAsyncCode(
    () => updateDisplayName(fixture.db, fixture.user('owner'), { displayName: '单' }),
    ERROR_CODES.INVALID_INPUT
  );
}

async function testLegacyCompatibilityAndInactiveMembers() {
  const fixture = createFixture();
  const legacy = {
    _id: 'member_legacy_12345678',
    userId: 'user_legacy_12345678',
    teamId: TEAM_ID,
    role: 'viewer',
    status: 'active'
  };
  const user = { _id: legacy.userId, displayName: '旧成员默认名' };
  const first = presentMember(legacy, user, user._id);
  const second = presentMember(legacy, user, user._id);
  assert.strictEqual(first.avatarKey, second.avatarKey);
  assert.strictEqual(first.avatarKey, getStableAvatarKey(legacy._id));
  assert.strictEqual(first.displayName, '旧成员默认名');
  assert.strictEqual(getMemberDisplayName({ teamNickname: '' }, user), '旧成员默认名');

  for (const role of ['pending', 'removed']) {
    const inactive = fixture.user(role);
    await expectAsyncCode(
      () => updateSelfProfile(fixture.db, inactive, {
        teamNickname: '不可修改',
        avatarKey: 'pixel_01'
      }),
      role === 'pending' ? ERROR_CODES.NO_ACTIVE_TEAM : ERROR_CODES.NO_ACTIVE_TEAM
    );
    await expectAsyncCode(
      () => listMembers(fixture.db, inactive, { status: 'active' }),
      ERROR_CODES.NO_ACTIVE_TEAM
    );
  }
}

function testClientAndAssets() {
  assert.deepStrictEqual(clientService.buildSelfProfilePayload({
    teamNickname: '仓管员',
    avatarKey: 'pixel_02',
    role: 'owner',
    teamId: OTHER_TEAM_ID,
    adminNote: '伪造'
  }), {
    teamNickname: '仓管员',
    avatarKey: 'pixel_02'
  });
  assert.deepStrictEqual(clientService.buildAdminNotePayload({
    targetMemberId: 'member_target_12345678',
    adminNote: '北区',
    role: 'owner'
  }), {
    targetMemberId: 'member_target_12345678',
    adminNote: '北区'
  });
  assert.deepStrictEqual(clientService.buildDisplayNamePayload({
    displayName: '新团队',
    teamId: OTHER_TEAM_ID,
    warehouseId: 'forged'
  }), { displayName: '新团队' });
  assert.deepStrictEqual(clientAvatars.AVATAR_KEYS, AVATAR_KEYS);

  const root = path.resolve(__dirname, '..');
  AVATAR_KEYS.forEach((key) => {
    const file = fs.readFileSync(path.join(root, 'miniprogram/assets/avatars', `${key}.png`));
    assert.strictEqual(file.readUInt32BE(16), 48);
    assert.strictEqual(file.readUInt32BE(20), 48);
  });
  const profileSource = fs.readFileSync(
    path.join(root, 'miniprogram/pages/profile/profile.js'),
    'utf8'
  );
  ['chooseMedia', 'chooseImage', 'uploadFile', 'avatarUrl'].forEach((token) => {
    assert.strictEqual(profileSource.includes(token), false);
  });
  const router = fs.readFileSync(
    path.join(root, 'cloudfunctions/warehouse-api/router.js'),
    'utf8'
  );
  [
    'team.member.profile.update',
    'team.member.adminNote.update',
    'team.displayName.update'
  ].forEach((action) => assert.ok(router.includes(`'${action}'`)));
  const handlers = [
    'member-profile-update.js',
    'member-admin-note-update.js',
    'display-name-update.js'
  ];
  handlers.forEach((file) => {
    const source = fs.readFileSync(
      path.join(root, 'cloudfunctions/warehouse-api/modules/team', file),
      'utf8'
    );
    assert.ok(source.includes('requireUser(db, context)'));
    assert.strictEqual(source.includes('context.user'), false);
  });
}

async function run() {
  await testSelfProfiles();
  await testAdminNotes();
  await testSafeMemberProjection();
  await testTeamNamePermissions();
  await testLegacyCompatibilityAndInactiveMembers();
  testClientAndAssets();
  console.log('stage2c7a tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
