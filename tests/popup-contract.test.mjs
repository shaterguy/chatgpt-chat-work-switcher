import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const popup = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
const popupScript = fs.readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8');
const contentScript = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const bridgeScript = fs.readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');

test('toolbar action opens the preview popup', () => {
  assert.equal(manifest.action?.default_popup, 'popup.html');
  assert.ok(manifest.permissions?.includes('activeTab'));
  assert.equal(manifest.version, '0.1.0');
});

test('popup exposes direct switch and calibration controls', () => {
  for (const action of [
    'switch-chat', 'switch-work', 'disable-switch',
    'capture-chat', 'capture-work', 'diagnostics', 'reset'
  ]) {
    assert.match(popup, new RegExp(`data-action="${action}"`));
  }
  assert.match(popup, /Chat로 전환/);
  assert.match(popup, /Work로 전환/);
});

test('popup and content script share switch and capture runtime commands', () => {
  for (const command of [
    'CW_POPUP_GET_STATE',
    'CW_POPUP_SET_CAPTURE',
    'CW_POPUP_SET_SWITCH',
    'CW_POPUP_DISABLE_SWITCH',
    'CW_POPUP_GET_DIAGNOSTICS',
    'CW_POPUP_RESET'
  ]) {
    assert.ok(popupScript.includes(command), `${command} missing from popup.js`);
    assert.ok(contentScript.includes(command), `${command} missing from content.js`);
  }
});

test('content and MAIN-world bridge share guarded switch protocol', () => {
  for (const command of ['CW_SWITCH_CONFIG', 'CW_SWITCH_DISABLE', 'CW_SWITCH_APPLIED']) {
    assert.ok(contentScript.includes(command), `${command} missing from content.js`);
    assert.ok(bridgeScript.includes(command), `${command} missing from bridge.js`);
  }
  assert.match(bridgeScript, /conversation-id-mismatch/);
  assert.match(bridgeScript, /source-profile-mismatch/);
  assert.match(bridgeScript, /beforeConversationId/);
  assert.match(bridgeScript, /beforeMessages/);
});

test('Request-body inspection cannot resend after the native fetch rejects', () => {
  assert.doesNotMatch(bridgeScript, /\.then\(runWithBody\)\s*\.catch/);
  assert.match(bridgeScript, /const clonedText = input\.clone\(\)\.text\(\)\.catch\(\(\) => null\)/);
});

test('popup explains stale-tab and wrong-tab failures instead of silently failing', () => {
  assert.match(popupScript, /새로고침한 뒤 다시 눌러주세요/);
  assert.match(popupScript, /ChatGPT 탭에서 확장프로그램 아이콘을 눌러주세요/);
});
