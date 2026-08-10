(() => {
  'use strict';

  if (globalThis.__chatWorkSwitcherActionToggleInstalled) return;
  globalThis.__chatWorkSwitcherActionToggleInstalled = true;

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

  let host = null;
  let shadow = null;
  let statusEl = null;
  let modelInput = null;
  let effortInput = null;
  let reloadInput = null;
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

  const pathKey = (path) => JSON.stringify(path);

  function withoutSelectableFields(ops) {
    const blocked = new Set([pathKey(['model']), pathKey(['thinking_effort'])]);
    return (ops || []).filter((op) => !blocked.has(pathKey(op.path)));
  }

  function withOverride(ops, path, rawValue) {
    const next = Array.isArray(ops) ? ops.map((op) => ({ ...op, path: [...op.path] })) : [];
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) return next;
    const key = pathKey(path);
    return [{ op: 'set', path, value }, ...next.filter((op) => pathKey(op.path) !== key)];
  }

  function defaultValue(ops, path) {
    const key = pathKey(path);
    const op = (ops || []).find((item) => item.op === 'set' && pathKey(item.path) === key);
    return typeof op?.value === 'string' ? op.value : '';
  }

  async function activeComparison() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const samples = stored[STORAGE_KEY]?.samples;
      if (core && samples?.chat?.length && samples?.work?.length) {
        const comparison = core.buildComparison(samples.chat, samples.work);
        if (comparison) return comparison;
      }
    } catch {}
    return SEEDED_COMPARISON;
  }

  async function buildConfig(mode) {
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

    let targetOps = withOverride(baseTargetOps, ['model'], modelInput?.value || '');
    targetOps = withOverride(targetOps, ['thinking_effort'], effortInput?.value || '');

    if (!endpoint || !Array.isArray(targetOps) || targetOps.length === 0) {
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

  function setStatus(text, kind = 'info') {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
  }

  async function armSwitch(mode) {
    const config = await buildConfig(mode);
    const selectedModel = modelInput.value.trim() || config.defaults.model;
    const selectedEffort = effortInput.value.trim() || config.defaults.thinkingEffort;

    post('CW_CAPTURE_MODE', { mode: null });
    post('CW_SWITCH_CONFIG', {
      mode,
      conversationId: config.conversationId,
      endpoint: config.endpoint,
      sourceOps: config.sourceOps,
      targetOps: config.targetOps
    });

    pendingReload = {
      conversationId: config.conversationId,
      mode,
      autoReload: reloadInput.checked
    };

    setStatus(`${mode === 'chat' ? 'Chat' : 'Work'} 전환 준비됨 · ${selectedModel || '기본 모델'} · ${selectedEffort || '기본 추론'}. 다음 메시지를 보내세요.`, 'warn');
  }

  function disableSwitch() {
    pendingReload = null;
    post('CW_SWITCH_DISABLE', { reason: 'toolbar-controller-user-disabled' });
    setStatus('전환을 해제했습니다.', 'info');
  }

  async function populateDefaults(mode) {
    try {
      const config = await buildConfig(mode);
      if (!modelInput.value.trim()) modelInput.placeholder = config.defaults.model || '직접 입력 가능';
      if (!effortInput.value.trim()) effortInput.placeholder = config.defaults.thinkingEffort || '직접 입력 가능';
    } catch {}
  }

  function ensureController() {
    if (host?.isConnected) return host;

    host = document.createElement('div');
    host.id = 'cw-toolbar-controller-host';
    host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host{all:initial}
        .panel{width:360px;padding:14px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:#111827;color:#f9fafb;box-shadow:0 18px 50px rgba(0,0,0,.4);font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        .head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}.title{font-weight:800;font-size:14px}.badge{color:#9ca3af;font-size:10px}.close{background:#374151}
        .status{padding:9px;border-radius:8px;background:#1f2937;margin-bottom:10px}.status[data-kind="ok"]{background:#064e3b;color:#d1fae5}.status[data-kind="warn"]{background:#78350f;color:#fef3c7}.status[data-kind="error"]{background:#7f1d1d;color:#fee2e2}
        label{display:block;margin:8px 0 4px;color:#d1d5db;font-weight:700}input[type="text"]{width:100%;box-sizing:border-box;border:1px solid #4b5563;border-radius:8px;padding:8px;background:#0b1220;color:#fff}
        .reload{display:flex;gap:8px;align-items:flex-start;margin:10px 0;color:#cbd5e1;font-weight:400}.reload input{margin-top:2px}
        .actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}button{border:0;border-radius:8px;padding:10px 12px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer}button.work{background:#7c3aed}button.secondary{background:#374151}.hint{margin-top:9px;color:#9ca3af;font-size:10px}
      </style>
      <section class="panel">
        <div class="head"><div><div class="title">Chat ↔ Work Switcher</div><div class="badge">v0.1.2 · toolbar controller</div></div><button class="close" data-action="close">닫기</button></div>
        <div class="status" data-role="status" data-kind="info">모드와 옵션을 선택하세요.</div>
        <label>모델</label>
        <input type="text" data-role="model" list="cw-model-options" placeholder="비워두면 목표 모드 기본값">
        <datalist id="cw-model-options"><option value="gpt-5-6-thinking"></option><option value="gpt-5.6-luna-wm"></option></datalist>
        <label>추론 정도</label>
        <input type="text" data-role="effort" list="cw-effort-options" placeholder="비워두면 목표 모드 기본값">
        <datalist id="cw-effort-options"><option value="standard"></option><option value="max"></option></datalist>
        <label class="reload"><input type="checkbox" data-role="reload" checked><span>전환 응답 완료 후 같은 conversation을 자동 새로고침해 새 모드 레이아웃으로 재진입</span></label>
        <div class="actions"><button data-action="chat">Chat로 전환</button><button class="work" data-action="work">Work로 전환</button></div>
        <div class="actions"><button class="secondary" data-action="disable">전환 해제</button><button class="secondary" data-action="defaults">기본값 표시</button></div>
        <div class="hint">모델/추론 정도는 직접 입력할 수 있습니다. 현재 확인된 내부값만 추천 목록에 표시합니다.</div>
      </section>
    `;

    document.documentElement.appendChild(host);

    statusEl = shadow.querySelector('[data-role="status"]');
    modelInput = shadow.querySelector('[data-role="model"]');
    effortInput = shadow.querySelector('[data-role="effort"]');
    reloadInput = shadow.querySelector('[data-role="reload"]');

    shadow.querySelector('[data-action="close"]').addEventListener('click', () => { host.hidden = true; });
    shadow.querySelector('[data-action="chat"]').addEventListener('click', () => armSwitch('chat').catch((e) => setStatus(e.message, 'error')));
    shadow.querySelector('[data-action="work"]').addEventListener('click', () => armSwitch('work').catch((e) => setStatus(e.message, 'error')));
    shadow.querySelector('[data-action="disable"]').addEventListener('click', disableSwitch);
    shadow.querySelector('[data-action="defaults"]').addEventListener('click', async () => {
      const mode = currentConversationId() ? 'work' : 'chat';
      await populateDefaults(mode);
      setStatus('입력칸의 placeholder에 현재 기본 내부값을 표시했습니다.', 'info');
    });

    host.hidden = true;
    return host;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== 'bridge-to-extension') return;

    if (data.type === 'CW_SWITCH_READY') {
      setStatus(`${data.mode === 'chat' ? 'Chat' : 'Work'} 전환 준비 완료. 다음 메시지에 적용됩니다.`, 'warn');
    } else if (data.type === 'CW_SWITCH_APPLIED') {
      setStatus(`${data.mode === 'chat' ? 'Chat' : 'Work'} 요청 프로필 적용됨. 응답 완료를 확인 중입니다.`, 'ok');
    } else if (data.type === 'CW_SWITCH_BYPASS') {
      setStatus(`전환 미적용: ${data.reason}`, 'warn');
    } else if (data.type === 'CW_SWITCH_DISABLED' || data.type === 'CW_SWITCH_REJECTED') {
      pendingReload = null;
      setStatus(`전환 해제: ${data.reason || 'unknown'}`, 'error');
    } else if (data.type === 'CW_SWITCH_RESPONSE_COMPLETE' && pendingReload) {
      const currentId = currentConversationId();
      const matches = data.mode === pendingReload.mode && currentId === pendingReload.conversationId;
      const shouldReload = matches && pendingReload.autoReload;
      pendingReload = null;
      if (shouldReload) {
        setStatus('전환 응답 완료. 같은 대화를 새 레이아웃으로 다시 불러옵니다.', 'ok');
        setTimeout(() => location.reload(), 250);
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== 'chat-work-switcher-background' || message.type !== 'CW_ACTION_TOGGLE_PANEL') {
      return undefined;
    }

    try {
      const controller = ensureController();
      controller.hidden = !controller.hidden;
      if (!controller.hidden) {
        setStatus(currentConversationId() ? '모드와 모델/추론 옵션을 선택하세요.' : '기존 /c/... conversation에서 사용하세요.', currentConversationId() ? 'info' : 'error');
      }
      sendResponse({ ok: true, open: !controller.hidden });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
    return undefined;
  });

  ensureController();
})();
