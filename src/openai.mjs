import { BoundaryError, invalid } from './errors.mjs';
import { snapshot } from './policy.mjs';

const PARAMETERS = new Set(['temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'seed',
  'stop', 'presence_penalty', 'frequency_penalty', 'response_format', 'tools', 'tool_choice',
  'parallel_tool_calls', 'reasoning_effort']);

export function openAICompatible({ baseURL, apiKey, model, maxResponseBytes = 2_000_000, stream = false } = {}) {
  let url;
  try { url = new URL(baseURL); } catch { throw invalid(); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
      url.username || url.password || url.search || url.hash || typeof model !== 'string' || !model.length || model.length > 200 ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 32_000_000) throw invalid();
  const endpoint = `${url.href.replace(/\/$/, '')}/chat/completions`;
  return Object.freeze({
    async complete({ messages, parameters = {}, signal }) {
      if (Object.keys(parameters).some(key => !PARAMETERS.has(key))) throw invalid();
      const key = typeof apiKey === 'function' ? apiKey() : apiKey;
      if (key !== undefined && (typeof key !== 'string' || /[\r\n]/.test(key))) throw invalid();
      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST', redirect: 'error', signal,
          headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({ ...parameters, model, messages, stream }),
        });
      } catch {
        throw new BoundaryError('transport_error', 'Provider connection failed.', { retryable: true, status: 502 });
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new BoundaryError(`upstream_${response.status}`, 'Provider rejected the request.', {
          retryable: [408, 429, 500, 502, 503, 504].includes(response.status), status: 502,
        });
      }
      let body = '';
      let bytes = 0;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > maxResponseBytes) throw new BoundaryError('response_too_large', 'Provider response exceeded the configured limit.', { status: 502 });
          body += decoder.decode(chunk, { stream: true });
        }
        body += decoder.decode();
      } catch (e) {
        if (e instanceof BoundaryError) throw e;
        throw new BoundaryError('incomplete_response', 'Provider response was interrupted.', { retryable: true, status: 502 });
      }
      let result;
      try {
        if ((response.headers.get('content-type') || '').includes('text/event-stream')) result = parseSSE(body);
        else result = JSON.parse(body);
        validateCompletion(result);
      } catch (e) {
        if (e instanceof BoundaryError) throw e;
        throw new BoundaryError('invalid_response', 'Provider returned an invalid completion.', { retryable: true, status: 502 });
      }
      // Keep the portable completion contract; do not forward arbitrary upstream metadata.
      const choice = result.choices[0];
      const message = { role: 'assistant', content: choice.message.content ?? null };
      if (choice.message.tool_calls) message.tool_calls = choice.message.tool_calls.map(t => ({
        id: t.id, type: 'function', function: { name: t.function.name, arguments: t.function.arguments },
      }));
      const usage = Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens']
        .filter(k => Number.isSafeInteger(result.usage?.[k]) && result.usage[k] >= 0).map(k => [k, result.usage[k]]));
      return snapshot({ choices: [{ index: 0, message, finish_reason: choice.finish_reason }],
        ...(Object.keys(usage).length ? { usage } : {}) }, maxResponseBytes);
    },
  });
}

function validateCompletion(result) {
  if (result?.error || !Array.isArray(result?.choices) || result.choices.length !== 1) throw invalidCompletion();
  const choice = result.choices[0];
  if (typeof choice?.finish_reason !== 'string' || !choice.finish_reason || !choice.message ||
      (typeof choice.message.content !== 'string' && !Array.isArray(choice.message.tool_calls))) throw invalidCompletion();
  if (choice.message.tool_calls !== undefined && (!Array.isArray(choice.message.tool_calls) || choice.message.tool_calls.some(t =>
    typeof t.id !== 'string' || t.type !== 'function' || typeof t.function?.name !== 'string' || typeof t.function?.arguments !== 'string'))) throw invalidCompletion();
}

function invalidCompletion() {
  return new BoundaryError('invalid_response', 'Provider returned an invalid completion.', { retryable: true, status: 502 });
}

function parseSSE(body) {
  const frames = body.replace(/\r\n/g, '\n').split('\n\n');
  let done = false, finish = null, text = '', usage, id, model;
  const calls = new Map();
  for (const frame of frames) {
    const payload = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!payload) continue;
    if (done) throw invalidCompletion();
    if (payload.trim() === '[DONE]') { done = true; continue; }
    const data = JSON.parse(payload);
    if (data.error) throw invalidCompletion();
    if (data.id) id = data.id;
    if (data.model) model = data.model;
    if (data.usage) usage = data.usage;
    for (const choice of data.choices || []) {
      if (choice.index !== 0 || finish) throw invalidCompletion();
      const delta = choice.delta || {};
      if (delta.content != null) {
        if (typeof delta.content !== 'string') throw invalidCompletion();
        text += delta.content;
      }
      for (const part of delta.tool_calls || []) {
        if (!Number.isSafeInteger(part.index) || part.index < 0 || part.index > 127) throw invalidCompletion();
        const current = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (part.id) current.id += part.id;
        if (part.function?.name) current.function.name += part.function.name;
        if (part.function?.arguments) current.function.arguments += part.function.arguments;
        calls.set(part.index, current);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }
  if (!done || !finish) throw new BoundaryError('incomplete_response', 'Provider stream did not complete.', { retryable: true, status: 502 });
  return { id, model, object: 'chat.completion', choices: [{ index: 0,
    message: { role: 'assistant', content: text, ...(calls.size ? { tool_calls: [...calls.entries()].sort((a,b) => a[0]-b[0]).map(x => x[1]) } : {}) },
    finish_reason: finish }], ...(usage ? { usage } : {}) };
}
