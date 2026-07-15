const crypto = require('crypto');

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 8;

function generateInviteCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let code = '';
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    code += INVITE_ALPHABET[bytes[index] % INVITE_ALPHABET.length];
  }
  return code;
}

function toTimestamp(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number') {
    return value;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getRemainingUses(invite) {
  const maxUses = Math.max(0, Number(invite && invite.maxUses) || 0);
  const usedCount = Math.max(0, Number(invite && invite.usedCount) || 0);
  return Math.max(0, maxUses - usedCount);
}

function isInviteExpired(invite, now = Date.now()) {
  return !invite || toTimestamp(invite.expiresAt) <= now;
}

function isInviteUsable(invite, now = Date.now()) {
  return Boolean(
    invite && invite.status === 'active' &&
    !isInviteExpired(invite, now) &&
    getRemainingUses(invite) > 0
  );
}

module.exports = {
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  generateInviteCode,
  toTimestamp,
  getRemainingUses,
  isInviteExpired,
  isInviteUsable
};
