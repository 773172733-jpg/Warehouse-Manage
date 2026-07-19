function formatArgs(args) {
  return ['[LightWarehouse]'].concat(args);
}

module.exports = {
  info(...args) {
    void args;
  },

  warn(...args) {
    console.warn.apply(console, formatArgs(args));
  },

  error(...args) {
    console.error.apply(console, formatArgs(args));
  }
};
