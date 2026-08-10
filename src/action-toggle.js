(() => {
  'use strict';

  if (globalThis.__chatWorkSwitcherActionToggleInstalled) return;
  globalThis.__chatWorkSwitcherActionToggleInstalled = true;

  function findPanel() {
    const root = document.getElementById('cw-switcher-root');
    const panel = root?.querySelector('[data-role="panel"]');
    return { root, panel };
  }

  async function waitForPanel(timeoutMs = 1500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = findPanel();
      if (found.panel) return found;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return findPanel();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== 'chat-work-switcher-background' || message.type !== 'CW_ACTION_TOGGLE_PANEL') {
      return undefined;
    }

    (async () => {
      const { panel } = await waitForPanel();
      if (!panel) return { ok: false, error: 'controller-panel-not-mounted' };
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        panel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      return { ok: true, open: !panel.hidden };
    })().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

    return true;
  });
})();
