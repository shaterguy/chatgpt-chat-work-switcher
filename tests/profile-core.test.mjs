import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/profile-core.js', import.meta.url), 'utf8');
const context = vm.createContext({ JSON });
vm.runInContext(source, context);
const core = context.ChatWorkProfileCore;

const sample = (pathname, leaves) => ({ pathname, method: 'POST', leaves });

const chatLeaves = (time = 20) => [
  { path: ['model'], value: 'gpt-5-6-thinking' },
  { path: ['thinking_effort'], value: 'max' },
  { path: ['conversation_mode', 'kind'], value: 'primary_assistant' },
  { path: ['client_contextual_info', 'time_since_loaded'], value: time }
];

const workLeaves = (time = 40) => [
  { path: ['model'], value: 'gpt-5.6-luna-wm' },
  { path: ['thinking_effort'], value: 'standard' },
  { path: ['conversation_origin'], value: 'tpp' },
  { path: ['service_tier'], value: 'standard' },
  { path: ['conversation_mode', 'kind'], value: 'primary_assistant' },
  { path: ['client_contextual_info', 'time_since_loaded'], value: time }
];

test('builds the four observed control-plane differences and ignores volatile client context', () => {
  const comparison = core.buildComparison(
    [sample('/backend-api/f/conversation', chatLeaves(21))],
    [sample('/backend-api/f/conversation', workLeaves(43))]
  );

  assert.equal(comparison.endpointDiffers, false);
  assert.equal(comparison.confidence, 'provisional');
  assert.equal(comparison.discriminatorCount, 4);
  assert.equal(JSON.stringify(comparison.work.differencesFromChat), JSON.stringify([
    { op: 'set', path: ['model'], value: 'gpt-5.6-luna-wm' },
    { op: 'set', path: ['thinking_effort'], value: 'standard' },
    { op: 'set', path: ['conversation_origin'], value: 'tpp' },
    { op: 'set', path: ['service_tier'], value: 'standard' }
  ]));
  assert.equal(JSON.stringify(comparison.chat.differencesFromWork), JSON.stringify([
    { op: 'set', path: ['model'], value: 'gpt-5-6-thinking' },
    { op: 'set', path: ['thinking_effort'], value: 'max' },
    { op: 'remove', path: ['conversation_origin'] },
    { op: 'remove', path: ['service_tier'] }
  ]));
});

test('raises confidence only after each mode has two stable samples', () => {
  const comparison = core.buildComparison(
    [sample('/backend-api/f/conversation', chatLeaves(10)), sample('/backend-api/f/conversation', chatLeaves(99))],
    [sample('/backend-api/f/conversation', workLeaves(11)), sample('/backend-api/f/conversation', workLeaves(77))]
  );
  assert.equal(comparison.confidence, 'high');
  assert.equal(comparison.discriminatorCount, 4);
});

test('reports endpoint differences instead of allowing endpoint rewriting', () => {
  const comparison = core.buildComparison(
    [sample('/backend-api/f/conversation', chatLeaves())],
    [sample('/backend-api/work', workLeaves())]
  );
  assert.equal(comparison.endpointDiffers, true);
});

test('applies mode ops without touching conversation id or messages when ops do not target them', () => {
  const body = {
    conversation_id: 'same-conversation',
    messages: [{ id: 'm1', content: 'hello' }],
    model: 'gpt-5-6-thinking',
    thinking_effort: 'max'
  };
  const ops = [
    { op: 'set', path: ['model'], value: 'gpt-5.6-luna-wm' },
    { op: 'set', path: ['thinking_effort'], value: 'standard' },
    { op: 'set', path: ['conversation_origin'], value: 'tpp' },
    { op: 'set', path: ['service_tier'], value: 'standard' }
  ];
  const result = core.applyOps(body, ops);

  assert.equal(result.applied, 4);
  assert.equal(result.value.conversation_id, 'same-conversation');
  assert.deepEqual(result.value.messages, body.messages);
  assert.equal(result.value.model, 'gpt-5.6-luna-wm');
  assert.equal(result.value.conversation_origin, 'tpp');
  assert.equal(core.matchesOps(result.value, ops), true);
  assert.equal(core.matchesOps(body, ops), false);
});
