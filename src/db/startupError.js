// Never log raw driver messages: they may contain URIs, credentials or records.
function startupError(error, stage) {
  if (error?.code === 13297 || /different case|differ only in case/i.test(error?.message || '')) {
    return 'DATABASE_NAME_CASE_MISMATCH: match the MONGODB_URI database name casing to the existing database (for example examquest versus ExamQuest).';
  }
  if (error?.code === 11000) return 'DATABASE_DUPLICATE_INDEX_VALUES: required unique index cannot be built; inspect duplicate counts with release:preflight. No records were removed.';
  if (error?.code === 'EXAM_STORAGE_NOT_READY') return 'EXAM_STORAGE_NOT_READY: required submission/attempt uniqueness indexes are missing or incompatible; run release:preflight.';
  if (error?.name === 'MongoServerSelectionError' || error?.name === 'MongooseServerSelectionError') return 'DATABASE_CONNECTION_FAILED: check the configured local MongoDB service/host/port or network access.';
  return stage === 'database' ? 'DATABASE_CONNECTION_FAILED: check MongoDB configuration and access.' : 'EXAM_STORAGE_INITIALIZATION_FAILED: inspect database/index readiness with release:preflight.';
}
module.exports = { startupError };
