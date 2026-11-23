export class BoundaryError extends Error {
  constructor(code, message, { retryable = false, status = 400 } = {}) {
    super(message);
    this.name = 'BoundaryError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}
export const invalid = () => new BoundaryError('invalid_request', 'Request does not match the Boundary contract.');
export const denied = () => new BoundaryError('policy_denied', 'No authorized destination is available.', { status: 403 });
const MESSAGES = {
  invalid_request: 'Request does not match the Boundary contract.',
  policy_denied: 'No authorized destination is available.',
  invalid_handle: 'Value is not owned by this Boundary instance.',
  provenance_limit: 'Provenance capacity reached.',
  cancelled: 'Request cancelled or deadline exceeded.',
  transport_error: 'Provider connection failed.',
  incomplete_response: 'Provider response was interrupted or incomplete.',
  response_too_large: 'Provider response exceeded the configured limit.',
  invalid_response: 'Provider returned an invalid completion.',
  unauthorized: 'A gateway access token is required.',
  origin_denied: 'Direct browser requests are disabled.',
  session_capacity: 'Session capacity reached.',
  session_busy: 'Session has an active request.',
  session_expired: 'Session is missing or expired. Create a new session explicitly.',
  not_found: 'Endpoint not found.',
  busy: 'Concurrent request limit reached.',
  body_too_large: 'Request body exceeded the configured limit.',
};
export function safeError(error) {
  if (!(error instanceof BoundaryError)) return new BoundaryError('execution_failed', 'Execution failed.', { status: 502 });
  const upstream = /^upstream_[45]\d\d$/.test(error.code);
  const known = Object.hasOwn(MESSAGES, error.code);
  return new BoundaryError(known || upstream ? error.code : 'execution_failed',
    known ? MESSAGES[error.code] : upstream ? 'Provider rejected the request.' : 'Execution failed.',
    { retryable: error.retryable === true, status: [400,401,403,404,408,409,410,413,429,502,503].includes(error.status) ? error.status : 502 });
}
