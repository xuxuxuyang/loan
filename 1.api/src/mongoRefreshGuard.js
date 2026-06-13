const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function shouldBlockRequestOnMongoRefreshError(method) {
  return MUTATION_METHODS.has(String(method || '').trim().toUpperCase())
}

module.exports = {
  shouldBlockRequestOnMongoRefreshError,
}
