(() => {
  'use strict';

  const isChatGptUrl = (url) => String(url || '').startsWith('https://chatgpt.com/');

  async function showBadge(tabId, text, color) {
    try {
      await chrome.action.setBadgeBackgroundColor({ tabId, color });
      await chrome.action.setBadgeText({ tabId, text });
      setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 1800);
    } catch {}
  }

  async function toggleExisting(tabId) {
    return chrome.tabs.sendMessage(tabId, {
      source: 'chat-work-switcher-background',
      type: 'CW_ACTION_TOGGLE_PANEL'
    });
  }

  async function injectController(tabId) {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['src/content.css']
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['src/profile-core.js', 'src/bridge.js', 'src/stream-monitor.js']
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      files: ['src/profile-core.js', 'src/content.js', 'src/switch-options.js', 'src/action-toggle.js']
    });
  }

  chrome.action.onClicked.addListener(async (tab) => {
    const tabId = tab?.id;
    if (!tabId) return;

    if (!isChatGptUrl(tab.url)) {
      await showBadge(tabId, '!', '#b91c1c');
      return;
    }

    try {
      const response = await toggleExisting(tabId);
      if (response?.ok) {
        await showBadge(tabId, response.open ? 'ON' : 'OFF', '#2563eb');
        return;
      }
    } catch {}

    try {
      await injectController(tabId);
      const response = await toggleExisting(tabId);
      if (!response?.ok) throw new Error(response?.error || 'panel-open-failed');
      await showBadge(tabId, response.open ? 'ON' : 'OFF', '#2563eb');
    } catch {
      await showBadge(tabId, 'ERR', '#b91c1c');
    }
  });
})();
