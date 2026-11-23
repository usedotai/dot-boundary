import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Boundary } from './runtime.mjs';
import { BoundaryError, invalid, safeError } from './errors.mjs';
import { audience, frozen, intersect } from './policy.mjs';

/** Local, single-owner OpenAI Chat Completions gateway. Policy is server configuration, never request text. */
export function createGateway({ providers, routes, token, maxSessions = 100, sessionTTL = 1_800_000,
  maxConcurrent = 8, maxBodyBytes = 1_000_000, timeoutMs = 60_000 } = {}) {
  if (typeof token !== 'string' || token.length < 24 || !routes || !Object.keys(routes).length) throw invalid();
  for (const n of [maxSessions, sessionTTL, maxConcurrent, maxBodyBytes, timeoutMs]) {
    if (!Number.isSafeInteger(n) || n < 1) throw invalid();
  }
  const policies = new Map(Object.entries(routes).map(([name, route]) => {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_.:/-]{1,100}$/.test(name) ||
      !Array.isArray(route.destinations) || !route.destinations.length || route.destinations.length > 16 ||
      route.destinations.some(id => !Object.hasOwn(providers, id)) ||
      !Number.isSafeInteger(route.retries ?? 0) || (route.retries ?? 0) < 0 || (route.retries ?? 0) > 3) throw invalid();
    return [name, frozen({ destinations: [...route.destinations], allow: audience(route.allow), retries: route.retries ?? 0 })];
  }));
  // Validate adapters before accepting traffic; each session gets isolated handles and receipt state.
  new Boundary({ providers });
  const sessions = new Map();
  let active = 0;
  const sweep = () => { for (const [id, s] of sessions) if (!s.busy && s.expires <= Date.now()) sessions.delete(id); };
  const authenticated = req => {
    const actual = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };

  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    let admitted = false, session, ownsSession = false;
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      if (!authenticated(req)) throw new BoundaryError('unauthorized', 'A gateway access token is required.', { status: 401 });
      if (req.headers.origin) throw new BoundaryError('origin_denied', 'Direct browser requests are disabled.', { status: 403 });
      sweep();
      if (req.method === 'GET' && req.url === '/v1/models') {
        return json(res, 200, { object: 'list', data: [...policies.keys()].map(id => ({ id, object: 'model', owned_by: 'boundary' })) });
      }
      if (req.method === 'POST' && req.url === '/v1/boundary/sessions') {
        if (sessions.size >= maxSessions) throw new BoundaryError('session_capacity', 'Session capacity reached.', { status: 429 });
        const id = randomUUID();
        const expires = Date.now() + sessionTTL;
        sessions.set(id, { allow: ['*'], boundary: new Boundary({ providers }), expires, busy: false });
        return json(res, 201, { id, expires_at: new Date(expires).toISOString() });
      }
      if (req.method === 'DELETE' && /^\/v1\/boundary\/sessions\/[a-f0-9-]{36}$/.test(req.url || '')) {
        const id = req.url.split('/').at(-1);
        const s = sessions.get(id);
        if (s?.busy) throw new BoundaryError('session_busy', 'Session has an active request.', { status: 409 });
        sessions.delete(id);
        return json(res, 200, { deleted: true });
      }
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        throw new BoundaryError('not_found', 'Endpoint not found.', { status: 404 });
      }
      if (active >= maxConcurrent) throw new BoundaryError('busy', 'Concurrent request limit reached.', { status: 429 });
      active++; admitted = true;
      const body = await readJSON(req, maxBodyBytes);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
      const { model, messages, stream = false, ...parameters } = body;
      const policy = policies.get(model);
      if (!policy || typeof stream !== 'boolean' || !Array.isArray(messages) || messages.length < 1 || messages.length > 256) throw invalid();
      const sessionId = req.headers['x-boundary-session'];
      if (sessionId !== undefined) {
        if (typeof sessionId !== 'string') throw invalid();
        session = sessions.get(sessionId);
        if (!session || session.expires <= Date.now()) throw new BoundaryError('session_expired', 'Session is missing or expired. Create a new session explicitly.', { status: 410 });
        if (session.busy) throw new BoundaryError('session_busy', 'Session has an active request.', { status: 409 });
        session.busy = true;
        ownsSession = true;
        session.allow = intersect(session.allow, policy.allow);
      }
      const boundary = session?.boundary || new Boundary({ providers });
      const allow = session?.allow || policy.allow;
      const protectedMessages = messages.map(m => {
        if (!m || typeof m !== 'object' || Array.isArray(m) ||
            Object.keys(m).some(k => !['role','content','tool_calls','tool_call_id'].includes(k))) throw invalid();
        return { role: m.role, content: boundary.data(m.content, { allow }),
          ...(m.tool_call_id !== undefined ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.tool_calls !== undefined ? { toolCalls: boundary.data(m.tool_calls, { allow }) } : {}) };
      });
      const result = await boundary.complete({ messages: protectedMessages, routes: policy.destinations,
        parameters, retries: policy.retries, timeoutMs, signal: controller.signal });
      const completion = boundary.reveal(result.value);
      // Upstream private metadata is not copied into gateway headers or receipts.
      const wire = { id: `chatcmpl-${randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now()/1000),
        model, choices: completion.choices, ...(completion.usage ? { usage: completion.usage } : {}) };
      res.setHeader('x-boundary-attempts', String(result.attempts));
      if (sessionId) res.setHeader('x-boundary-session', sessionId);
      if (!stream) return json(res, 200, wire);
      // Atomic buffered SSE: no partial output is released before upstream completion validates.
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      const choice = wire.choices[0];
      const delta = { ...choice.message };
      if (delta.tool_calls) delta.tool_calls = delta.tool_calls.map((call, index) => ({ index, ...call }));
      const chunk = { ...wire, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    } catch (error) {
      const safe = safeError(error);
      if (!res.headersSent && !res.destroyed) json(res, safe.status, { error: { message: safe.message, type: 'boundary_error', code: safe.code } });
      else if (!res.destroyed) res.end();
    } finally {
      if (admitted) active--;
      if (ownsSession) session.busy = false;
      res.off('close', disconnect);
    }
  });
  server.requestTimeout = Math.max(timeoutMs + 5000, 10_000);
  server.headersTimeout = 10_000;
  server.on('close', () => sessions.clear());
  return server;
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function readJSON(req, limit) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw invalid();
  let size = 0;
  const chunks = [];
  // Keep the connection writable long enough to return a structured 413.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new BoundaryError('body_too_large', 'Request body exceeded the configured limit.', { status: 413 });
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw invalid(); }
}
