function baseResponse(requestId) {
  return {
    requestId: requestId || '',
    timestamp: Date.now()
  };
}

function ok(data, requestId) {
  return Object.assign(baseResponse(requestId), {
    success: true,
    data: data === undefined ? {} : data
  });
}

function fail(code, message, requestId) {
  return Object.assign(baseResponse(requestId), {
    success: false,
    error: {
      code,
      message
    }
  });
}

module.exports = {
  ok,
  fail
};
