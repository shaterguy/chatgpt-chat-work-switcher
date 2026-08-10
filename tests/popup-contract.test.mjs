import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const popup = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
const popupScript = fs.readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8');
const contentScript = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const bridgeScript = fs.readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');
const optionsScript = fs.readFileSync(new URL('../src/switch-options.js', import.meta.url), 'utf8');
const streamMonitor = fs.readFileSync(new URL('../src/stream-monitor.js', import.meta.url), 'utf8');
const backgroundScript = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const actionToggle = fs.readFileSync(new URL('../src/action-toggle.js', import.meta.url), 'utf8');

test('toolbar action is handled by a service worker instead of a fragile popup', () => {
  assert.equal(manifest.action?.default_popup, undefined);
  assert.equal(manifest.background?.service_worker, 'src/background.js');
  assert.ok(manifest.permissions?.includes('activeTab'));
  assert.ok(manifest.permissions?.includes('scripting'));
  assert.ok(manifest.host_permissions?.includes('https://chatgpt.com/*'));
  assert.equal(manifest.version, '0.1.2');
  assert.ok(manifest.content_scripts[0].js.includes('src/stream-monitor.js'));
  assert.ok(manifest.content_scripts[1].js.includes('src/switch-options.js'));
  assert.ok(manifest.content_scripts[1].js.includes('src/action-toggle.js'));
});

test('toolbar click toggles the in-page panel and can inject stale tabs', () => {
  assert.match(backgroundScript, /chrome\.action\.onClicked/);
  assert.match(backgroundScript, /CW_ACTION_TOGGLE_PANEL/);
  assert.match(backgroundScript, /chrome\.scripting\.executeScript/);
  assert.match(backgroundScript, /src\/action-toggle\.js/);
  assert.match(actionToggle, /CW_ACTION_TOGGLE_PANEL/);
  assert.match(actionToggle, /controller-panel-not-mounted/);
  assert.match(actionToggle, /panel\.hidden = !panel\.hidden/);
});

test('legacy popup still exposes direct switch, model, reasoning and reload controls', () => {
  for (const action of [
    'switch-chat', 'switch-work', 'disable-switch',
    'capture-chat', 'capture-work', 'diagnostics', 'reset'
  ]) {
    assert.match(popup, new RegExp(`data-action="${action}"`));
  }
  assert.match(popup, /data-role="model"/);
  assert.match(popup, /data-role="thinking-effort"/);
  assert.match(popup, /data-role="auto-reload"/);
});

test('legacy popup retains the original calibration/runtime contract', () => {
  for (const command of [
    'CW_POPUP_GET_STATE',
    'CW_POPUP_SET_CAPTURE',
    'CW_POPUP_DISABLE_SWITCH',
    'CW_POPUP_GET_DIAGNOSTICS',
    'CW_POPUP_RESET'
  ]) {
    assert.ok(popupScript.includes(command), `${command} missing from popup.js`);
    assert.ok(contentScript.includes(command), `${command} missing from content.js`);
  }
});

test('selectable switch options use their own message contract', () => {
  for (const command of ['CW_OPTIONS_GET_DEFAULTS', 'CW_OPTIONS_SET_SWITCH']) {
    assert.ok(popupScript.includes(command), `${command} missing from popup.js`);
    assert.ok(optionsScript.includes(command), `${command} missing from switch-options.js`);
  }
  assert.match(optionsScript, /\['model'\]/);
  assert.match(optionsScript, /\['thinking_effort'\]/);
  assert.match(optionsScript, /withoutSelectableFields/);
});

test('MAIN-world bridge keeps guarded same-conversation switching', () => {
  for (const command of ['CW_SWITCH_CONFIG', 'CW_SWITCH_DISABLE', 'CW_SWITCH_APPLIED']) {
    assert.ok(bridgeScript.includes(command), `${command} missing from bridge.js`);
  }
  assert.match(bridgeScript, /conversation-id-mismatch/);
  assert.match(bridgeScript, /source-profile-mismatch/);
  assert.match(bridgeScript, /beforeConversationId/);
  assert.match(bridgeScript, /beforeMessages/);
});

test('successful switched response completion can trigger same-route reload', () => {
  assert.match(streamMonitor, /CW_SWITCH_RESPONSE_COMPLETE/);
  assert.match(streamMonitor, /response\.clone\(\)/);
  assert.match(optionsScript, /location\.reload\(\)/);
  assert.match(optionsScript, /currentId === pendingReload\.conversationId/);
});

test('Request-body inspection cannot resend after the native fetch rejects', () => {
  assert.doesNotMatch(bridgeScript, /\.then\(runWithBody\)\s*\.catch/);
  assert.match(bridgeScript, /const clonedText = input\.clone\(\)\.text\(\)\.catch\(\(\) => null\)/);
});
