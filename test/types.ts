import { Boundary, openAICompatible, type Completion, type Protected } from '@usedot/boundary';
import { createGateway } from '@usedot/boundary/gateway';
const provider = openAICompatible({ baseURL: 'https://api.example.com/v1', model: 'configured' });
const b = new Boundary({ providers: { primary: provider }, tools: {
  read: { execute: async () => 'private file', outputAllow: ['primary'] },
} });
const source = b.data('private', { allow: ['primary'] });
const derived: Protected<string> = b.derive([source, b.data(3)], (text, count) => text.repeat(count));
const result = await b.complete({ messages: [{ role: 'user', content: derived }], routes: ['primary'] });
const output: Completion = b.reveal(result.value);
console.log(output.choices[0].message.content);
createGateway({ providers: { primary: provider }, routes: { private: { destinations: ['primary'], allow: ['primary'] } }, token: 'random-test-token-of-24-characters' });
// @ts-expect-error raw strings are not protected handles
b.complete({ messages: [{ role: 'user', content: 'raw' }], routes: ['primary'] });
