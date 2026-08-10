import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/profile-core.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const core = context.ChatWorkProfileCore;

const sample = (pathname, leaves) => ({ pathname, method: 'POST', leaves });

test('learns values that are stable per mode and different between modes', () => {
  const chat = [
    sample('/backend-api/conversation', [
      { path: ['mode'], value: 'chat' },
      { path: ['timezone'], value: 'Asia/Seoul' },
      { path: ['noise'], value: 1 }
    ]),
    sample('/backend-api/conversation', [
      { path: ['mode'], value: 'chat' },
      { path: ['timezone'], value: 'Asia/Seoul' },
      { path: ['noise'], value: 2 }
    ])
  ];
  const work = [
    sample('/backend-api/conversation', [
      { path: ['mode'], value: 'work' },
      { path: ['timezone'], value: 'Asia/Seoul' },
      { path: ['noise'], value: 3 }
    ]),
    sample('/backend-api/conversation', [
      { path: ['mode'], value: 'work' },
      { path: ['timezone'], value: 'Asia/Seoul' },
      { path: ['noise'], value: 4 }
    ])
  ];
  const profiles = core.buildProfiles(chat, work);
  assert.equal(profiles.discriminatorCount, 1);
  assert.equal(profiles.confidence, 'high');
  assert.equal(JSON.stringify(profiles.work.ops), JSON.stringify([{ op: 'set', path: ['mode'], value: 'work' }]));
});

test('learns stable field presence as remove/set operations', () => {
  const chat = [sample('/backend-api/conversation', [{ path: ['chat_only'], value: true }])];
  const work = [sample('/backend-api/conversation', [{ path: ['work_only'], value: true }])];
  const profiles = core.buildProfiles(chat, work);
  assert.equal(profiles.confidence, 'provisional');
  assert.equal(JSON.stringify(profiles.work.ops), JSON.stringify([
    { op: 'set', path: ['work_only'], value: true },
    { op: 'remove', path: ['chat_only'] }
  ]));
});

test('detects endpoint differences instead of silently rewriting them', () => {
  const profiles = core.buildProfiles(
    [sample('/backend-api/conversation', [{ path: ['mode'], value: 'chat' }])],
    [sample('/backend-api/work', [{ path: ['mode'], value: 'work' }])]
  );
  assert.equal(profiles.endpointDiffers, true);
});

test('applies nested set and remove operations without mutating the input', () => {
  const input = { metadata: { mode: 'chat', keep: true }, untouched: 1 };
  const result = core.applyOps(input, [
    { op: 'set', path: ['metadata', 'mode'], value: 'work' },
    { op: 'remove', path: ['metadata', 'keep'] }
  ]);
  assert.equal(input.metadata.mode, 'chat');
  assert.equal(result.value.metadata.mode, 'work');
  assert.equal('keep' in result.value.metadata, false);
  assert.equal(result.applied, 2);
});
