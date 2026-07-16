const OFFICIAL_COVER_EMOJIS = Array.from(new Set([
  '▦', '🛍️', '🪣', '🪵', '🎨', '🔩', '🔧', '📦',
  '🍪', '🥤', '🍎', '🥬', '❄️',
  '🚿', '💡', '🪑', '🔌', '🧹',
  '💻', '📱', '💳', '📷', '📁', '📚', '📎',
  '🚗', '🛞', '⚙️', '🔋', '🛢️',
  '👟', '👕', '👖', '🧢', '🎒',
  '🐄', '🐖', '🐑', '🐓', '🦆', '🐟'
]));

const LEGACY_COVER_EMOJIS = ['🧱'];
const COVER_EMOJIS = Array.from(new Set(OFFICIAL_COVER_EMOJIS.concat(LEGACY_COVER_EMOJIS)));

module.exports = {
  OFFICIAL_COVER_EMOJIS,
  LEGACY_COVER_EMOJIS,
  COVER_EMOJIS
};
