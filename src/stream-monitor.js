(() => {
  'use strict';

  const CHANNEL = 'chat-work-switcher-probe-v1';
  if (globalThis.__chatWorkSwitcherStreamMonitorInstalled) return;
  globalThis.__chatWorkSwitcherStreamMonitorInstalled = true;

  let pending = null;

  function currentConversationId() {
    return location.pathname.match(/\/c\/([0-9a-z-]+)/i)?.[1] || null;
  }

  function emit(type, payload = {}) {
    window.postMessage({ channel: CHANNEL, direction: 'bridge-to-extension', type, ...payload }, '*');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== 'bridge-to-extension') return;
    if (data.type === 'CW_SWITCH_APPLIED') {
      pending = {
        mode: data.mode,
        conversationId: currentConversationId()
      };
    }
    if (data.type === 'CW_SWITCH_DISABLED' || data.type === 'CW_SWITCH_REJECTED') {
      pending = null;
    }
  });

  const previousFetch = window.fetch;
  window.fetch = function chatWorkSwitcherStreamMonitor(input, init) {
    const promise = previousFetch.call(this, input, init);
    Promise.resolve(promise).then((response) => {
      if (!response?.ok || !pending) return;
      let path = null;
      try { path = new URL(response.url || (typeof input === 'string' ? input : input?.url), location.href).pathname; } catch {}
      if (path !== '/backend-api/f/conversation') return;

      const snapshot = pending;
      let clone;
      try { clone = response.clone(); } catch { return; }
      clone.text().then(() => {
        if (!pending) return;
        const currentId = currentConversationId();
        const matches = snapshot.mode === pending.mode && snapshot.conversationId === pending.conversationId;
        if (!matches || currentId !== snapshot.conversationId) return;
        pending = null;
        emit('CW_SWITCH_RESPONSE_COMPLETE', {
          mode: snapshot.mode,
          conversationIdMatches: true,
          pathname: path
        });
      }).catch(() => {});
    }).catch(() => {});
    return promise;
  };
})();
