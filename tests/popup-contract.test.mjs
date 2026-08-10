import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const popup = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
const popupScript = fs.readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8');
const contentScript = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');

test('toolbar action opens the popup', () => {
  assert.equal(manifest.action?.default_popup, 'popup.html');
  assert.ok(manifest.permissions?.includes('activeTab'));
  assert.equal(manifest.version, '0.0.2');
});

test('popup exposes the required user controls', () => {
  for (const action of ['chat', 'work', 'diagnostics', 'reset']) {
    assert.match(popup, new RegExp(`data-action="${action}"`));
  }
  assert.match(popup, /Chat 기록/);
  assert.match(popup, /Work 기록/);
});

test('popup and content script share the runtime command contract', () => {
  for (const command of [
    'CW_POPUP_GET_STATE',
    'CW_POPUP_SET_CAPTURE',
    'CW_POPUP_GET_DIAGNOSTICS',
    'CW_POPUP_RESET'
  ]) {
    assert.ok(popupScript.includes(command), `${command} missing from popup.js`);
    assert.ok(contentScript.includes(command), `${command} missing from content.js`);
  }
});

test('popup explains stale-tab and wrong-tab failures instead of silently failing', () => {
  assert.match(popupScript, /새로고침한 뒤 다시 눌러주세요/);
  assert.match(popupScript, /ChatGPT 탭에서 확장프로그램 아이콘을 눌러주세요/);
});
