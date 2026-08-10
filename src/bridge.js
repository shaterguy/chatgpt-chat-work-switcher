(() => {
  'use strict';

  const CHANNEL = 'chat-work-switcher-probe-v1';
  if (globalThis.__chatWorkSwitcherProbeInstalled) return;
  globalThis.__chatWorkSwitcherProbeInstalled = true;

  const blockedKeys = new Set([
    'id', 'conversation_id', 'parent_message_id', 'message_id', 'current_node',
    'request_id', 'client_request_id', 'user_id', 'account_id', 'token',
    'authorization', 'cookie', 'set-cookie', 'prompt', 'input', 'text',
    'content', 'parts', 'messages', 'attachments', 'files'
  ]);
  const blockedPattern = /(token|secret|credential|password|cookie|authorization|session)/i;
  const likelyUuid = /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i;
  const likelyLongOpaque = /^[A-Za-z0-9_\-./+=]{80,}$/;
  const likelyEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  let captureMode = null;
  let captureSequence = 0;

  function emit(type, payload = {}) {
    window.postMessage({ channel: CHANNEL, direction: 'bridge-to-extension', type, ...payload }, '*');
  }

  function currentConversationId() {
    return location.pathname.match(/\/c\/([0-9a-z-]+)/i)?.[1] || null;
  }

  function routeKind() {
    if (!currentConversationId()) return 'non-conversation';
    return location.pathname.includes('/g/') ? 'project-conversation' : 'conversation';
  }

  function shouldSkipKey(key) {
    const lower = String(key).toLowerCase();
    return blockedKeys.has(lower) || blockedPattern.test(lower);
  }

  function safePrimitive(value) {
    if (typeof value === 'boolean' || typeof value === 'number' || value === null) return true;
    if (typeof value !== 'string') return false;
    if (value.length > 120 || likelyUuid.test(value) || likelyLongOpaque.test(value)) return false;
    if (/^https?:\/\//i.test(value) || likelyEmail.test(value)) return false;
    return true;
  }

  function extractLeaves(body) {
    const leaves = [];
    const walk = (value, path, depth) => {
      if (depth > 6 || Array.isArray(value)) return;
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (shouldSkipKey(key)) continue;
          walk(child, [...path, key], depth + 1);
        }
        return;
      }
      if (path.length && safePrimitive(value)) leaves.push({ path, value });
    };
    walk(body, [], 0);
    return leaves;
  }

  function candidate(url, method, body) {
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    let parsed;
    try { parsed = new URL(url, location.href); } catch { return false; }
    if (parsed.origin !== location.origin || !parsed.pathname.includes('/backend-api/')) return false;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    return Array.isArray(body.messages) || typeof body.action === 'string' || typeof body.parent_message_id === 'string';
  }

  function createCapture(url, method, body, transport, modeAtSend) {
    if (!modeAtSend || !candidate(url, method, body)) return null;
    const captureId = ++captureSequence;
    const parsed = new URL(url, location.href);
    const urlConversationId = currentConversationId();
    const bodyConversationId = typeof body.conversation_id === 'string' ? body.conversation_id : null;
    const sample = {
      captureId,
      pathname: parsed.pathname,
      method: String(method || 'POST').toUpperCase(),
      transport,
      routeKind: routeKind(),
      hasConversationId: Boolean(bodyConversationId),
      conversationIdConsistent: bodyConversationId && urlConversationId ? bodyConversationId === urlConversationId : null,
      leaves: extractLeaves(body),
      response: null
    };
    emit('CW_CAPTURED', { mode: modeAtSend, sample });
    return { captureId, mode: modeAtSend };
  }

  function emitResponse(capture, responseLike, responseUrl) {
    if (!capture) return;
    let pathname = null;
    try { pathname = new URL(responseUrl || location.href, location.href).pathname; } catch {}
    let contentType = null;
    try { contentType = responseLike?.headers?.get?.('content-type') || null; } catch {}
    emit('CW_CAPTURE_RESPONSE', {
      captureId: capture.captureId,
      mode: capture.mode,
      response: {
        ok: typeof responseLike?.ok === 'boolean' ? responseLike.ok : null,
        status: Number.isFinite(responseLike?.status) ? responseLike.status : null,
        pathname,
        contentType: typeof contentType === 'string' ? contentType.slice(0, 80) : null
      }
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== 'extension-to-bridge') return;
    if (data.type === 'CW_CAPTURE_MODE') {
      captureMode = data.mode === 'chat' || data.mode === 'work' ? data.mode : null;
      emit('CW_CAPTURE_STATE', { mode: captureMode });
    }
  });

  const originalFetch = window.fetch;
  window.fetch = function chatWorkSwitcherProbeFetch(input, init) {
    const modeAtSend = captureMode;
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const method = init?.method || input?.method || 'GET';

    // Start the native request first and return its original Promise unchanged.
    // Observation is deliberately kept off the request's critical path.
    const nativePromise = originalFetch.call(this, input, init);

    let capturePromise = Promise.resolve(null);
    try {
      if (typeof init?.body === 'string' && init.body.trim().startsWith('{')) {
        const parsedBody = JSON.parse(init.body);
        capturePromise = Promise.resolve(createCapture(url, method, parsedBody, 'fetch', modeAtSend));
      } else if (input instanceof Request && !init?.body && modeAtSend) {
        capturePromise = input.clone().text()
          .then((bodyText) => {
            if (!bodyText.trim().startsWith('{')) return null;
            return createCapture(url, method, JSON.parse(bodyText), 'fetch', modeAtSend);
          })
          .catch(() => null);
      }
    } catch {
      capturePromise = Promise.resolve(null);
    }

    nativePromise.then(
      (response) => capturePromise.then((capture) => emitResponse(capture, response, response.url || url)),
      () => capturePromise.then((capture) => {
        if (!capture) return;
        emit('CW_CAPTURE_RESPONSE', {
          captureId: capture.captureId,
          mode: capture.mode,
          response: { ok: false, status: null, pathname: null, contentType: null, networkError: true }
        });
      })
    );

    return nativePromise;
  };

  const xhrMeta = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    xhrMeta.set(this, { method, url: String(url) });
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const meta = xhrMeta.get(this);
    const modeAtSend = captureMode;
    let capture = null;
    try {
      if (meta && typeof body === 'string' && body.trim().startsWith('{')) {
        capture = createCapture(meta.url, meta.method, JSON.parse(body), 'xhr', modeAtSend);
      }
    } catch {}

    if (capture) {
      this.addEventListener('loadend', () => {
        emit('CW_CAPTURE_RESPONSE', {
          captureId: capture.captureId,
          mode: capture.mode,
          response: {
            ok: this.status >= 200 && this.status < 400,
            status: Number.isFinite(this.status) ? this.status : null,
            pathname: (() => { try { return new URL(this.responseURL || meta.url, location.href).pathname; } catch { return null; } })(),
            contentType: (this.getResponseHeader('content-type') || '').slice(0, 80) || null
          }
        });
      }, { once: true });
    }

    return originalSend.call(this, body);
  };

  emit('CW_BRIDGE_READY', { readOnly: true });
})();
