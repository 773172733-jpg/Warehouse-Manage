const ERROR_CODES = {
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

module.exports = {
  ApiError,
  ERROR_CODES
};
