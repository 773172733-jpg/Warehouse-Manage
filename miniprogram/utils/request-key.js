function normalizePrefix(prefix) {
  const value = typeof prefix === 'string' ? prefix.replace(/[^A-Za-z0-9_-]/g, '') : '';
  return value || 'request';
}

function createRandomSegment(random) {
  return Math.floor(random() * 0xFFFFFFFF).toString(36).padStart(7, '0');
}

function createRequestKey(prefix = 'request', options = {}) {
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const now = typeof options.now === 'function' ? options.now() : Date.now();
  const randomPart = [
    createRandomSegment(random),
    createRandomSegment(random),
    createRandomSegment(random)
  ].join('');

  return `${normalizePrefix(prefix)}_${Number(now).toString(36)}_${randomPart}`.slice(0, 64);
}

module.exports = {
  createRequestKey
};
