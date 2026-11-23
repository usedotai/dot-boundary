// Real inference. Set DOT_API_KEY, or PROVIDER_BASE_URL + PROVIDER_MODEL + PROVIDER_API_KEY.
import { Boundary, openAICompatible } from '../src/index.mjs';

const generic = Boolean(process.env.PROVIDER_BASE_URL);
const apiKey = generic ? process.env.PROVIDER_API_KEY : process.env.DOT_API_KEY;
if (!generic && !apiKey) throw new Error('Set DOT_API_KEY, or configure PROVIDER_BASE_URL and PROVIDER_MODEL.');
if (generic && !process.env.PROVIDER_MODEL) throw new Error('Set PROVIDER_MODEL.');
const b = new Boundary({
  providers: {
    inference: openAICompatible({
      baseURL: process.env.PROVIDER_BASE_URL || 'https://api.usedot.xyz/agent/v1',
      model: process.env.PROVIDER_MODEL || 'dot-uncensored-obli-24B', apiKey,
    }),
  },
  tools: {
    publish: { execute: async ({ text }) => ({ published: text }), outputAllow: ['*'] },
  },
});
const source = b.data(process.argv.slice(2).join(' ') || 'Summarize this private project note: launch planning is scheduled for Friday.', { allow: ['inference'] });
const result = await b.complete({ messages: [{ role: 'user', content: source }], routes: ['inference'] });
const draft = b.derive([result.value], completion => ({ text: completion.choices[0].message.content }));
// The inference result retains its source permissions. It cannot flow to the publishing tool.
try { await b.invoke('publish', draft); } catch (e) {
  if (e.code !== 'policy_denied') throw e;
  console.log('Private result retained locally; publishing blocked by policy.');
}
console.log(b.reveal(draft).text);
console.log(JSON.stringify(b.receipt(), null, 2));
