(() => {
  'use strict';

  const CHANNEL = 'chat-work-switcher-v1';
  const core = globalThis.ChatWorkProfileCore;
  if (!core || globalThis.__chatWorkSwitcherBridgeInstalled) return;
  globalThis.__chatWorkSwitcherBridgeInstalled = true;

  const protectedKeys = new Set([
    'id', 'conversation_id', 'parent_message_id', 'message_id', 'current_node',
    'request_id', 'client_request_id', 'user_id', 'account_id', 'token',
    'authorization', 'cookie', 'set-cookie', 'prompt', 'input', 'text',
    'content', 'parts', 'messages', 'attachments', 'files'
  ]);
  const sensitiveKeyPattern = /(token|secret|credential|password|cookie|authorization|session)/i;
  const likelyUuid = /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i;
  const likelyLongOpaque = /^[A-Za-z0-9_\-./+=]{80,}$/;

  let captureMode = null;
  let activeConfig = null;
  let lastConversationId = null;

  function emit(type, payload = {}) {
    window.postMessage({ channel: CHANNEL, direction: 'bridge-to-extension', type, ...payload }, '*');
  }

  function currentConversationId() {
    const match = location.pathname.match(/\/c\/([0-9a-z-]+)/i);
    return match?.[1] || null;
  }

  function shouldSkipKey(key) {
    const lower = String(key).toLowerCase();
    return protectedKeys.has(lower) || sensitiveKeyPattern.test(lower);
  }

  function safePrimitive(value) {
    if (typeof value === 'boolean' || typeof value === 'number' || value === null) return true;
    if (typeof value !== 'string') return false;
    if (value.length > 160 || likelyUuid.test(value) || likelyLongOpaque.test(value)) return false;
    if (/^https?:\/\//i.test(value) || value.includes('@')) return false;
    return true;
  }

  function extractLeaves(body) {
    const leaves = [];
    const walk = (value, path, depth) => {
      if (depth > 6) return;
      if (Array.isArray(value)) return;
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

  function fingerprint(url, method, body) {
    const parsed = new URL(url, location.href);
    return {
      pathname: parsed.pathname,
      method: String(method || 'POST').toUpperCase(),
      leaves: extractLeaves(body)
    };
  }

  function transform(url, method, body) {
    const conversationId = currentConversationId();
    if (!conversationId || !activeConfig || activeConfig.conversationId !== conversationId) {
      return { body, applied: 0 };
    }
    if (!candidate(url, method, body)) return { body, applied: 0 };
    const beforeConversationId = body.conversation_id;
    const beforeMessages = body.messages;
    const result = core.applyOps(body, activeConfig.ops || []);
    const next = result.value;

    if (beforeConversationId !== undefined) next.conversation_id = beforeConversationId;
    if (beforeMessages !== undefined) next.messages = beforeMessages;

    if (beforeConversationId && beforeConversationId !== conversationId) {
      emit('CW_INVARIANT_REJECTED', { reason: 'conversation-id-mismatch' });
      return { body, applied: 0 };
    }

    return { body: next, applied: result.applied };
  }

  function handleCandidate(url, method, body) {
    if (!candidate(url, method, body)) return { body, applied: 0 };
    if (captureMode) {
      emit('CW_CAPTURED', { mode: captureMode, sample: fingerprint(url, method, body) });
    }
    const transformed = transform(url, method, body);
    if (transformed.applied > 0) {
      emit('CW_APPLIED', {
        mode: activeConfig?.mode,
        conversationId: currentConversationId(),
        operationCount: transformed.applied,
        pathname: new URL(url, location.href).pathname
      });
    }
    return transformed;
  }

  function rollback(reason, status = null) {
    if (!activeConfig) return;
    const failedMode = activeConfig.mode;
    activeConfig = null;
    emit('CW_ROLLBACK', { reason, status, failedMode, conversationId: currentConversationId() });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== 'extension-to-bridge') return;
    if (data.type === 'CW_CAPTURE_MODE') {
      captureMode = data.mode === 'chat' || data.mode === 'work' ? data.mode : null;
      emit('CW_CAPTURE_STATE', { mode: captureMode });
    } else if (data.type === 'CW_CONFIG') {
      const conversationId = currentConversationId();
      if (!conversationId || data.conversationId !== conversationId || !['chat', 'work'].includes(data.mode)) {
        activeConfig = null;
        return;
      }
      activeConfig = {
        conversationId,
        mode: data.mode,
        ops: Array.isArray(data.ops) ? data.ops : []
      };
      lastConversationId = conversationId;
      emit('CW_CONFIGURED', { conversationId, mode: data.mode, operationCount: activeConfig.ops.length });
    } else if (data.type === 'CW_DISABLE') {
      activeConfig = null;
      captureMode = null;
      emit('CW_DISABLED');
    }
  });

  const originalFetch = window.fetch;
  window.fetch = async function chatWorkSwitcherFetch(input, init) {
    let url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    let method = init?.method || input?.method || 'GET';
    let bodyText = init?.body;
    let parsedBody = null;

    try {
      if (typeof bodyText !== 'string' && input instanceof Request && !init?.body) {
        bodyText = await input.clone().text();
      }
      if (typeof bodyText === 'string' && bodyText.trim().startsWith('{')) parsedBody = JSON.parse(bodyText);
    } catch {
      parsedBody = null;
    }

    if (!parsedBody || !candidate(url, method, parsedBody)) return originalFetch.call(this, input, init);

    const transformed = handleCandidate(url, method, parsedBody);
    let response;
    try {
      if (transformed.applied > 0) {
        const nextBody = JSON.stringify(transformed.body);
        if (input instanceof Request) {
          const request = new Request(input, { ...init, body: nextBody });
          response = await originalFetch.call(this, request);
        } else {
          response = await originalFetch.call(this, input, { ...init, body: nextBody });
        }
      } else {
        response = await originalFetch.call(this, input, init);
      }
    } catch (error) {
      if (transformed.applied > 0) rollback('fetch-exception');
      throw error;
    }

    if (transformed.applied > 0 && !response.ok) rollback('http-error', response.status);
    return response;
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
    let parsedBody = null;
    try {
      if (typeof body === 'string' && body.trim().startsWith('{')) parsedBody = JSON.parse(body);
    } catch {
      parsedBody = null;
    }
    if (!meta || !parsedBody || !candidate(meta.url, meta.method, parsedBody)) return originalSend.call(this, body);

    const transformed = handleCandidate(meta.url, meta.method, parsedBody);
    if (transformed.applied > 0) {
      this.addEventListener('loadend', () => {
        if (this.status >= 400) rollback('xhr-http-error', this.status);
      }, { once: true });
      return originalSend.call(this, JSON.stringify(transformed.body));
    }
    return originalSend.call(this, body);
  };

  setInterval(() => {
    const now = currentConversationId();
    if (lastConversationId && now !== lastConversationId) activeConfig = null;
    lastConversationId = now;
  }, 1000);

  emit('CW_BRIDGE_READY');
})();
