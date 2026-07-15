const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  USER_DISABLED: 'USER_DISABLED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  NO_ACTIVE_TEAM: 'NO_ACTIVE_TEAM',
  ALREADY_IN_TEAM: 'ALREADY_IN_TEAM',
  INVALID_TEAM_NAME: 'INVALID_TEAM_NAME',
  INVALID_WAREHOUSE_NAME: 'INVALID_WAREHOUSE_NAME',
  INVALID_REQUEST_KEY: 'INVALID_REQUEST_KEY',
  MEMBERSHIP_NOT_ACTIVE: 'MEMBERSHIP_NOT_ACTIVE',
  TEAM_NOT_ACTIVE: 'TEAM_NOT_ACTIVE',
  WAREHOUSE_NOT_FOUND: 'WAREHOUSE_NOT_FOUND',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  DATABASE_ERROR: 'DATABASE_ERROR',
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

function isApiError(error) {
  return Boolean(
    error && (
      error instanceof ApiError ||
      Object.keys(ERROR_CODES).some((key) => ERROR_CODES[key] === error.code)
    )
  );
}

module.exports = {
  ApiError,
  ERROR_CODES,
  isApiError
};
