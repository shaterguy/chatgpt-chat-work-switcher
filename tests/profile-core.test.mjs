import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/profile-core.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const core = context.ChatWorkProfileCore;

const sample = (pathname, leaves) => ({ pathname, method: 'POST', leaves });

test('finds values stable within each mode and different across modes', () => {
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
  const comparison = core.buildComparison(chat, work);
  assert.equal(comparison.discriminatorCount, 1);
  assert.equal(comparison.confidence, 'high');
  assert.equal(JSON.stringify(comparison.work.differencesFromChat), JSON.stringify([{ op: 'set', path: ['mode'], value: 'work' }]));
});

test('records stable field presence differences without applying them', () => {
  const comparison = core.buildComparison(
    [sample('/backend-api/conversation', [{ path: ['chat_only'], value: true }])],
    [sample('/backend-api/conversation', [{ path: ['work_only'], value: true }])]
  );
  assert.equal(comparison.confidence, 'provisional');
  assert.equal(JSON.stringify(comparison.work.differencesFromChat), JSON.stringify([
    { op: 'set', path: ['work_only'], value: true },
    { op: 'remove', path: ['chat_only'] }
  ]));
});

test('reports endpoint differences instead of attempting endpoint rewriting', () => {
  const comparison = core.buildComparison(
    [sample('/backend-api/conversation', [{ path: ['mode'], value: 'chat' }])],
    [sample('/backend-api/work', [{ path: ['mode'], value: 'work' }])]
  );
  assert.equal(comparison.endpointDiffers, true);
});
