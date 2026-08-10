(() => {
  'use strict';

  const CHANNEL = 'chat-work-switcher-probe-v1';
  const STORAGE_KEY = 'chatWorkSwitcherProbeStateV1';
  const core = globalThis.ChatWorkProfileCore;

  const SEEDED_COMPARISON = {
    chat: {
      endpoint: '/backend-api/f/conversation',
      differencesFromWork: [
        { op: 'set', path: ['model'], value: 'gpt-5-6-thinking' },
        { op: 'set', path: ['thinking_effort'], value: 'max' },
        { op: 'remove', path: ['conversation_origin'] },
        { op: 'remove', path: ['service_tier'] }
      ]
    },
    work: {
      endpoint: '/backend-api/f/conversation',
      differencesFromChat: [
        { op: 'set', path: ['model'], value: 'gpt-5.6-luna-wm' },
        { op: 'set', path: ['thinking_effort'], value: 'standard' },
        { op: 'set', path: ['conversation_origin'], value: 'tpp' },
        { op: 'set', path: ['service_tier'], value: 'standard' }
      ]
    },
    discriminatorCount: 4,
    endpointDiffers: false,
    confidence: 'provisional'
  };

  let pendingReload = null;

  const post = (type, payload = {}) => window.postMessage({
    channel: CHANNEL,
    direction: 'extension-to-bridge',
    type,
    ...payload
  }, '*');

  function currentConversationId() {
    return location.pathname.match(/\/c\/([0-9a-z-]+)/i)?.[1] || null;
  }

  function pathKey(path) {
    return JSON.stringify(path);
  }

  function withOverride(ops, path, rawValue) {
    const next = Array.isArray(ops) ? ops.map((op) => ({ ...op, path: [...op.path] })) : [];
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) return next;

    const key = pathKey(path);
    const filtered = next.filter((op) => pathKey(op.path) !== key);
    filtered.unshift({ op: 'set', path, value });
    return filtered;
  }

  function withoutSelectableFields(ops) {
    const excluded = new Set([pathKey(['model']), pathKey(['thinking_effort'])]);
    return (ops || []).filter((op) => !excluded.has(pathKey(op.path))).map((op) => ({ ...op, path: [...op.path] }));
  }

  function defaultValue(ops, path) {
    const key = pathKey(path);
    const op = (ops || []).find((item) => item.op === 'set' && pathKey(item.path) === key);
    return typeof op?.value === 'string' ? op.value : '';
  }

  async function activeComparison() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const samples = stored[STORAGE_KEY]?.samples;
    if (core && samples?.chat?.length && samples?.work?.length) {
      const comparison = core.buildComparison(samples.chat, samples.work);
      if (comparison) return comparison;
    }
    return SEEDED_COMPARISON;
  }

  async function buildConfig(mode, options = {}) {
    if (!['chat', 'work'].includes(mode)) throw new Error('지원하지 않는 전환 모드입니다.');
    const conversationId = currentConversationId();
    if (!conversationId) throw new Error('기존 /c/... 대화에서만 전환할 수 있습니다.');

    const comparison = await activeComparison();
    if (!comparison || comparison.endpointDiffers) throw new Error('현재 프로필로는 안전하게 전환할 수 없습니다.');

    const target = comparison[mode];
    const otherMode = mode === 'chat' ? 'work' : 'chat';
    const source = comparison[otherMode];
    const baseTargetOps = mode === 'chat' ? target.differencesFromWork : target.differencesFromChat;
    const rawSourceOps = otherMode === 'chat' ? source.differencesFromWork : source.differencesFromChat;
    const sourceOps = withoutSelectableFields(rawSourceOps);
    const endpoint = target.endpoint || source.endpoint;

    let targetOps = withOverride(baseTargetOps, ['model'], options.model);
    targetOps = withOverride(targetOps, ['thinking_effort'], options.thinkingEffort);

    if (!endpoint || !Array.isArray(targetOps) || !Array.isArray(sourceOps) || targetOps.length === 0) {
      throw new Error('전환 프로필이 충분하지 않습니다.');
    }

    return {
      conversationId,
      endpoint,
      sourceOps,
      targetOps,
      defaults: {
        model: defaultValue(baseTargetOps, ['model']),
        thinkingEffort: defaultValue(baseTargetOps, ['thinking_effort'])
      }
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== 'chat-work-switcher-popup-options') return undefined;

    (async () => {
      if (message.type === 'CW_OPTIONS_GET_DEFAULTS') {
        const chat = await buildConfig('chat');
        const work = await buildConfig('work');
        return { ok: true, defaults: { chat: chat.defaults, work: work.defaults } };
      }

      if (message.type === 'CW_OPTIONS_SET_SWITCH') {
        const config = await buildConfig(message.mode, {
          model: message.model,
          thinkingEffort: message.thinkingEffort
        });
        post('CW_CAPTURE_MODE', { mode: null });
        post('CW_SWITCH_CONFIG', {
          mode: message.mode,
          conversationId: config.conversationId,
          endpoint: config.endpoint,
          sourceOps: config.sourceOps,
          targetOps: config.targetOps
        });
        pendingReload = {
          conversationId: config.conversationId,
          mode: message.mode,
          autoReload: message.autoReload !== false
        };
        return {
          ok: true,
          mode: message.mode,
          model: (message.model || '').trim() || config.defaults.model,
          thinkingEffort: (message.thinkingEffort || '').trim() || config.defaults.thinkingEffort,
          autoReload: pendingReload.autoReload
        };
      }

      throw new Error('알 수 없는 전환 옵션 명령입니다.');
    })().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

    return true;
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== 'bridge-to-extension') return;

    if (data.type === 'CW_SWITCH_DISABLED' || data.type === 'CW_SWITCH_REJECTED') {
      pendingReload = null;
      return;
    }

    if (data.type !== 'CW_SWITCH_RESPONSE_COMPLETE' || !pendingReload) return;
    const currentId = currentConversationId();
    const matches = data.mode === pendingReload.mode && currentId === pendingReload.conversationId;
    const shouldReload = matches && pendingReload.autoReload;
    pendingReload = null;
    if (shouldReload) {
      setTimeout(() => location.reload(), 250);
    }
  });
})();
