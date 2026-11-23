import { createServer } from 'node:http';
import { once } from 'node:events';

export const completion = (text = 'A complete answer.', extra = {}) => ({
  id: 'fixture-completion', object: 'chat.completion', model: 'fixture-model',
  choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 }, ...extra,
});

export async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

export async function fixture(handler = (_, res) => res.end(JSON.stringify(completion()))) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const record = { url: req.url, headers: req.headers, raw, body: raw ? JSON.parse(raw) : null };
    requests.push(record);
    res.setHeader('content-type', 'application/json');
    await handler(record, res, requests.length);
  });
  const url = await listen(server);
  return { server, url, requests, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

export async function closeServer(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
