import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const bridge = fs.readFileSync('src/bridge.js', 'utf8');
const popup = fs.readFileSync('popup.html', 'utf8');
const popupScript = fs.readFileSync('src/popup.js', 'utf8');

test('extension is a capture-only calibrator injected before page scripts', () => {
  assert.match(manifest.name, /Snapshot Calibrator/);
  assert.equal(manifest.version_name, '0.2.0-dev1');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.ok(!manifest.background);
  assert.ok(!manifest.permissions.includes('scripting'));
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.equal(manifest.content_scripts[0].world, 'MAIN');
  assert.deepEqual(manifest.content_scripts[0].js, ['src/snapshot-core.js', 'src/bridge.js']);
});

test('bridge never rewrites or resends a transformed request', () => {
  assert.match(bridge, /return originalFetch\.call\(this, input, init\)/);
  assert.match(bridge, /return originalSend\.call\(this, body\)/);
  assert.doesNotMatch(bridge, /applyOps|targetOps|sourceOps|transformed|CW_SWITCH/);
});

test('popup exposes scenario generation, next capture and JSON export', () => {
  assert.match(popup, /Chat 모델/);
  assert.match(popup, /Work 모델/);
  assert.match(popup, /다음 미캡처 대기/);
  assert.match(popup, /결과 JSON 복사/);
  assert.match(popupScript, /RS_ARM_SCENARIO/);
  assert.match(popupScript, /work-followup/);
  assert.match(popupScript, /promptTextStored: false/);
});
