function shouldBlockRequestOnMongoRefreshError(method, options) {
  return String(method || '').trim().toUpperCase() !== 'GET'
    || options?.requiresFresh !== false
    || options?.hasUsableSnapshot !== true
}

module.exports = {
  shouldBlockRequestOnMongoRefreshError,
}
