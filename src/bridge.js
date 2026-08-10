(() => {
  'use strict';

  const CHANNEL = 'chat-work-switcher-probe-v1';
  const core = globalThis.ChatWorkProfileCore;
  if (!core || globalThis.__chatWorkSwitcherProbeInstalled) return;
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
  let activeSwitch = null;

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

  function pathnameOf(url) {
    try { return new URL(url, location.href).pathname; } catch { return null; }
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
    let contentType = null;
    try { contentType = responseLike?.headers?.get?.('content-type') || null; } catch {}
    emit('CW_CAPTURE_RESPONSE', {
      captureId: capture.captureId,
      mode: capture.mode,
      response: {
        ok: typeof responseLike?.ok === 'boolean' ? responseLike.ok : null,
        status: Number.isFinite(responseLike?.status) ? responseLike.status : null,
        pathname: pathnameOf(responseUrl || location.href),
        contentType: typeof contentType === 'string' ? contentType.slice(0, 80) : null
      }
    });
  }

  function disableSwitch(reason, details = {}) {
    if (!activeSwitch) return;
    const previous = activeSwitch;
    activeSwitch = null;
    emit('CW_SWITCH_DISABLED', {
      reason,
      mode: previous.mode,
      conversationIdMatches: currentConversationId() === previous.conversationId,
      ...details
    });
  }

  function transformCandidate(url, method, body) {
    if (!activeSwitch || !candidate(url, method, body)) return { body, applied: 0, transformed: false };

    const currentId = currentConversationId();
    if (!currentId || currentId !== activeSwitch.conversationId) {
      disableSwitch('conversation-changed');
      return { body, applied: 0, transformed: false };
    }

    const pathname = pathnameOf(url);
    if (!pathname || pathname !== activeSwitch.endpoint) {
      emit('CW_SWITCH_BYPASS', { reason: 'endpoint-mismatch', pathname, expectedPathname: activeSwitch.endpoint });
      return { body, applied: 0, transformed: false };
    }

    const bodyConversationId = typeof body.conversation_id === 'string' ? body.conversation_id : null;
    if (bodyConversationId && bodyConversationId !== currentId) {
      disableSwitch('conversation-id-mismatch');
      return { body, applied: 0, transformed: false };
    }

    if (core.matchesOps(body, activeSwitch.targetOps)) {
      return { body, applied: 0, transformed: false, alreadyTarget: true };
    }

    if (!core.matchesOps(body, activeSwitch.sourceOps)) {
      emit('CW_SWITCH_BYPASS', { reason: 'source-profile-mismatch', pathname });
      return { body, applied: 0, transformed: false };
    }

    const beforeConversationId = body.conversation_id;
    const beforeMessages = body.messages;
    const result = core.applyOps(body, activeSwitch.targetOps);
    const next = result.value;

    if (beforeConversationId !== undefined) next.conversation_id = beforeConversationId;
    if (beforeMessages !== undefined) next.messages = beforeMessages;

    emit('CW_SWITCH_APPLIED', {
      mode: activeSwitch.mode,
      pathname,
      operationCount: result.applied,
      protectedConversationId: beforeConversationId !== undefined,
      protectedMessages: beforeMessages !== undefined
    });

    return { body: next, applied: result.applied, transformed: result.applied > 0 };
  }

  function monitorTransformedPromise(promise, meta, capture, url) {
    promise.then(
      (response) => {
        emitResponse(capture, response, response.url || url);
        if (meta?.transformed && response && response.ok === false) {
          disableSwitch('http-failure', { status: response.status });
        }
      },
      () => {
        if (capture) emit('CW_CAPTURE_RESPONSE', {
          captureId: capture.captureId,
          mode: capture.mode,
          response: { ok: false, status: null, pathname: null, contentType: null, networkError: true }
        });
        if (meta?.transformed) disableSwitch('network-failure');
      }
    );
    return promise;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== 'extension-to-bridge') return;

    if (data.type === 'CW_CAPTURE_MODE') {
      captureMode = data.mode === 'chat' || data.mode === 'work' ? data.mode : null;
      if (captureMode) activeSwitch = null;
      emit('CW_CAPTURE_STATE', { mode: captureMode });
      return;
    }

    if (data.type === 'CW_SWITCH_CONFIG') {
      const conversationId = currentConversationId();
      const validMode = data.mode === 'chat' || data.mode === 'work';
      const validOps = Array.isArray(data.sourceOps) && Array.isArray(data.targetOps);
      if (!conversationId || data.conversationId !== conversationId || !validMode || !validOps || !data.endpoint) {
        activeSwitch = null;
        emit('CW_SWITCH_REJECTED', { reason: 'invalid-config' });
        return;
      }
      captureMode = null;
      activeSwitch = {
        conversationId,
        mode: data.mode,
        endpoint: data.endpoint,
        sourceOps: data.sourceOps,
        targetOps: data.targetOps
      };
      emit('CW_SWITCH_READY', {
        mode: activeSwitch.mode,
        endpoint: activeSwitch.endpoint,
        sourceOperationCount: activeSwitch.sourceOps.length,
        targetOperationCount: activeSwitch.targetOps.length
      });
      return;
    }

    if (data.type === 'CW_SWITCH_DISABLE') {
      disableSwitch(data.reason || 'user-disabled');
    }
  });

  const originalFetch = window.fetch;
  window.fetch = function chatWorkSwitcherFetch(input, init) {
    const modeAtSend = captureMode;
    const shouldInspect = Boolean(modeAtSend || activeSwitch);
    if (!shouldInspect) return originalFetch.call(this, input, init);

    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const method = init?.method || input?.method || 'GET';

    const runWithBody = (bodyText) => {
      let parsedBody = null;
      try {
        if (typeof bodyText === 'string' && bodyText.trim().startsWith('{')) parsedBody = JSON.parse(bodyText);
      } catch {}

      const capture = parsedBody ? createCapture(url, method, parsedBody, 'fetch', modeAtSend) : null;
      const transformed = parsedBody ? transformCandidate(url, method, parsedBody) : { body: parsedBody, applied: 0, transformed: false };
      const nextBody = transformed.transformed ? JSON.stringify(transformed.body) : bodyText;

      let promise;
      try {
        if (input instanceof Request) {
          const request = transformed.transformed ? new Request(input, { ...init, body: nextBody }) : input;
          promise = originalFetch.call(this, request, transformed.transformed ? undefined : init);
        } else {
          const nextInit = transformed.transformed ? { ...(init || {}), body: nextBody } : init;
          promise = originalFetch.call(this, input, nextInit);
        }
      } catch (error) {
        if (transformed.transformed) disableSwitch('request-rebuild-failure');
        throw error;
      }

      return monitorTransformedPromise(promise, transformed, capture, url);
    };

    if (typeof init?.body === 'string') return runWithBody(init.body);

    if (input instanceof Request && !init?.body) {
      const clonedText = input.clone().text().catch(() => null);
      return clonedText.then((bodyText) => bodyText === null
        ? originalFetch.call(this, input, init)
        : runWithBody(bodyText));
    }

    return originalFetch.call(this, input, init);
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
    let parsedBody = null;
    try {
      if (meta && typeof body === 'string' && body.trim().startsWith('{')) parsedBody = JSON.parse(body);
    } catch {}

    const capture = meta && parsedBody ? createCapture(meta.url, meta.method, parsedBody, 'xhr', modeAtSend) : null;
    const transformed = meta && parsedBody ? transformCandidate(meta.url, meta.method, parsedBody) : { body: parsedBody, applied: 0, transformed: false };
    const nextBody = transformed.transformed ? JSON.stringify(transformed.body) : body;

    this.addEventListener('loadend', () => {
      if (capture) {
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
      }
      if (transformed.transformed && !(this.status >= 200 && this.status < 400)) {
        disableSwitch('http-failure', { status: Number.isFinite(this.status) ? this.status : null });
      }
    }, { once: true });

    return originalSend.call(this, nextBody);
  };

  emit('CW_BRIDGE_READY', { readOnly: false, experimentalSwitching: true });
})();
