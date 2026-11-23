import { randomUUID } from 'node:crypto';
import { BoundaryError, denied, invalid, safeError } from './errors.mjs';
import { audience, frozen, identifier, intersect, permitted, snapshot } from './policy.mjs';

/** Trusted application owns this object. Models receive serialized messages, never the authority. */
export class Boundary {
  #values = new WeakMap();
  #providers = new Map();
  #tools = new Map();
  #revoked = new Set();
  #events = [];
  #sequence = 0;
  #maxEvents;

  constructor({ providers = {}, tools = {}, maxEvents = 1000 } = {}) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 100_000) throw invalid();
    this.#maxEvents = maxEvents;
    for (const [id, adapter] of Object.entries(providers)) {
      identifier(id);
      if (typeof adapter?.complete !== 'function') throw invalid();
      this.#providers.set(id, adapter.complete.bind(adapter));
    }
    for (const [id, tool] of Object.entries(tools)) {
      identifier(id);
      const execute = typeof tool === 'function' ? tool : tool?.execute;
      if (this.#providers.has(id) || typeof execute !== 'function') throw invalid();
      const outputAllow = audience(typeof tool === 'function' ? [] : tool.outputAllow ?? []);
      this.#tools.set(id, { execute, outputAllow });
    }
  }

  data(content, { allow = [] } = {}) {
    return this.#make(content, audience(allow), [randomUUID()]);
  }

  #make(content, allow, sources) {
    if (sources.length > 4096) throw new BoundaryError('provenance_limit', 'Provenance capacity reached.');
    const handle = Object.freeze({ id: randomUUID(), toJSON: () => '[Boundary protected value]' });
    this.#values.set(handle, { content: frozen(snapshot(content)), allow: [...allow], sources: [...new Set(sources)] });
    return handle;
  }

  #get(handle) {
    const value = this.#values.get(handle);
    if (!value) throw new BoundaryError('invalid_handle', 'Value is not owned by this Boundary instance.');
    return value;
  }

  #join(handles) {
    if (!Array.isArray(handles) || !handles.length || handles.length > 512) throw invalid();
    let allow = ['*'];
    const sources = new Set();
    for (const h of handles) {
      const v = this.#get(h);
      allow = intersect(allow, v.allow);
      for (const s of v.sources) sources.add(s);
    }
    if (sources.size > 4096) throw new BoundaryError('provenance_limit', 'Provenance capacity reached.');
    return { allow, sources: [...sources] };
  }

  policy(handle) {
    const v = this.#get(handle);
    return frozen({ allow: [...v.allow], sources: [...v.sources] });
  }

  /** Local transformation; provenance is inherited even if the resulting text contains no source bytes. */
  derive(handles, transform) {
    const joined = this.#join(handles);
    if (typeof transform !== 'function') throw invalid();
    const value = transform(...handles.map(h => this.#get(h).content));
    if (value?.then) throw invalid();
    return this.#make(value, joined.allow, joined.sources);
  }

  restrict(handle, allow) {
    const v = this.#get(handle);
    return this.#make(v.content, intersect(v.allow, audience(allow)), v.sources);
  }

  /** Explicit trusted-application authority. Never expose this method as an agent tool. */
  release(handle, { allow, approvalId }) {
    identifier(approvalId);
    const v = this.#get(handle);
    const out = this.#make(v.content, audience(allow), v.sources);
    this.#event('release', { approvalId, sourceCount: v.sources.length });
    return out;
  }

  /** Owner access for a local UI. This is not a controlled network dispatch. */
  reveal(handle) { return snapshot(this.#get(handle).content); }

  revoke(destination) {
    identifier(destination);
    this.#revoked.add(destination);
    this.#event('revoke', { destination });
  }

  #check(allow, destination) {
    if (this.#revoked.has(destination) || !permitted(allow, destination)) {
      this.#event('blocked', { destination });
      throw denied();
    }
  }

  #event(type, fields = {}) {
    const event = frozen({ seq: ++this.#sequence, type, ...fields });
    this.#events.push(event);
    if (this.#events.length > this.#maxEvents) this.#events.shift();
  }

  receipt() { return frozen({ version: 1, eventCount: this.#sequence, events: [...this.#events] }); }

  async complete({ messages, routes, parameters = {}, retries = 0, timeoutMs = 60_000, signal } = {}) {
    if (!Array.isArray(messages) || !messages.length || messages.length > 256 ||
        !Array.isArray(routes) || !routes.length || routes.length > 16 ||
        !Number.isSafeInteger(retries) || retries < 0 || retries > 3 ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw invalid();
    const routeIds = routes.map(identifier);
    if (routeIds.some(id => !this.#providers.has(id))) throw invalid();
    const refs = messages.map(message => {
      if (!message || !['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role)) throw invalid();
      this.#get(message.content);
      return message.content;
    });
    const joined = this.#join(refs);
    // Serialize once; adapter retries cannot mutate the original history or policy.
    const wireMessages = frozen(messages.map(m => {
      const content = this.#get(m.content).content;
      if (typeof content !== 'string' && content !== null) throw invalid();
      const out = { role: m.role, content };
      if (m.tool_call_id !== undefined) out.tool_call_id = identifier(m.tool_call_id);
      // Tool-call messages must be derived from a protected completion, not accepted as raw hidden context.
      if (m.toolCalls !== undefined) out.tool_calls = this.#get(m.toolCalls).content;
      return out;
    }));
    const allRefs = [...refs, ...messages.filter(m => m.toolCalls !== undefined).map(m => m.toolCalls)];
    const effective = allRefs.length === refs.length ? joined : this.#join(allRefs);
    const safeParameters = frozen(snapshot(parameters));
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let lastError;
    let attempts = 0;
    for (const destination of routeIds) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (combined.aborted) throw new BoundaryError('cancelled', 'Request cancelled or deadline exceeded.', { status: 408 });
        try { this.#check(effective.allow, destination); } catch (e) { lastError = e; break; }
        attempts++;
        this.#event('dispatch', { destination, attempt: attempts, sourceCount: effective.sources.length });
        try {
          const response = await abortable(this.#providers.get(destination)({
            messages: snapshot(wireMessages), parameters: snapshot(safeParameters), signal: combined,
          }), combined);
          combined.throwIfAborted();
          this.#check(effective.allow, destination);
          const value = this.#make(response, effective.allow, effective.sources);
          this.#event('complete', { destination, attempt: attempts });
          return Object.freeze({ value, destination, attempts });
        } catch (error) {
          if (combined.aborted) throw new BoundaryError('cancelled', 'Request cancelled or deadline exceeded.', { status: 408 });
          lastError = safeError(error);
          this.#event('failed', { destination, code: lastError.code });
          if (!lastError.retryable) throw lastError;
        }
      }
    }
    throw lastError || denied();
  }

  async invoke(destination, args, { signal } = {}) {
    identifier(destination);
    const tool = this.#tools.get(destination);
    if (!tool) throw invalid();
    const v = this.#get(args);
    this.#check(v.allow, destination);
    signal?.throwIfAborted();
    this.#event('tool_dispatch', { destination, sourceCount: v.sources.length });
    try {
      const result = await abortable(tool.execute(snapshot(v.content), { signal }), signal);
      signal?.throwIfAborted();
      this.#check(v.allow, destination);
      // A tool can introduce new private data (file/database reads), even with public arguments.
      return this.#make(result, intersect(v.allow, tool.outputAllow), [...v.sources, randomUUID()]);
    } catch (error) { throw safeError(error); }
  }
}

async function abortable(promise, signal) {
  if (!signal) return promise;
  let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(new BoundaryError('cancelled', 'Request cancelled.', { status: 408 }));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}
