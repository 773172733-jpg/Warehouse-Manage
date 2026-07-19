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

const AVATARS = Object.freeze(AVATAR_KEYS.map((key, index) => ({
  key,
  label: `像素头像${index + 1}`,
  src: `/assets/avatars/${key}.png`
})));

function getStableAvatarKey(memberId) {
  const text = String(memberId || 'member');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;
  }
  return AVATAR_KEYS[hash % AVATAR_KEYS.length];
}

function normalizeAvatarKey(avatarKey, memberId) {
  return AVATAR_KEYS.includes(avatarKey) ? avatarKey : getStableAvatarKey(memberId);
}

function getAvatarPath(avatarKey, memberId) {
  return `/assets/avatars/${normalizeAvatarKey(avatarKey, memberId)}.png`;
}

module.exports = {
  AVATAR_KEYS,
  AVATARS,
  getStableAvatarKey,
  normalizeAvatarKey,
  getAvatarPath
};
