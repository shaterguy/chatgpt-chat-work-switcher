(() => {
  'use strict';

  const CHANNEL = 'chat-work-switcher-probe-v1';
  const STORAGE_KEY = 'chatWorkSwitcherProbeStateV1';
  const MAX_SAMPLES = 3;
  const core = globalThis.ChatWorkProfileCore;

  const SEEDED_COMPARISON = {
    version: 2,
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
    confidence: 'provisional',
    source: 'observed-pair-2026-08-10'
  };

  let state = { samples: { chat: [], work: [] }, comparison: null };
  let captureMode = null;
  let switchMode = null;
  let switchStatus = null;
  let comparisonSource = 'seeded';
  let ui = {};

  const post = (type, payload = {}) => window.postMessage({
    channel: CHANNEL,
    direction: 'extension-to-bridge',
    type,
    ...payload
  }, '*');

  function currentConversationId() {
    return location.pathname.match(/\/c\/([0-9a-z-]+)/i)?.[1] || null;
  }

  function routeKind() {
    return currentConversationId() ? (location.pathname.includes('/g/') ? 'project-conversation' : 'conversation') : 'non-conversation';
  }

  async function loadState() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (stored[STORAGE_KEY]?.samples) state = stored[STORAGE_KEY];
    recompute();
  }

  async function saveState() {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function recompute() {
    const captured = core.buildComparison(state.samples.chat, state.samples.work);
    state.comparison = captured || SEEDED_COMPARISON;
    comparisonSource = captured ? 'captured' : 'seeded';
  }

  function activeComparison() {
    recompute();
    return state.comparison || SEEDED_COMPARISON;
  }

  function setStatus(text, kind = 'info') {
    if (!ui.status) return;
    ui.status.textContent = text;
    ui.status.dataset.kind = kind;
  }

  function setCapture(mode) {
    captureMode = captureMode === mode ? null : mode;
    switchMode = null;
    switchStatus = null;
    post('CW_SWITCH_DISABLE', { reason: 'calibration-started' });
    post('CW_CAPTURE_MODE', { mode: captureMode });
    setStatus(captureMode ? `${captureMode === 'chat' ? 'Chat' : 'Work'} native 대화에서 메시지 1회를 보내세요.` : '기록을 취소했습니다.', 'info');
    render();
  }

  async function acceptSample(mode, sample) {
    if (!['chat', 'work'].includes(mode) || mode !== captureMode) return;
    state.samples[mode].push(sample);
    if (state.samples[mode].length > MAX_SAMPLES) state.samples[mode].shift();
    captureMode = null;
    post('CW_CAPTURE_MODE', { mode: null });
    recompute();
    await saveState();
    render();

    if (!state.samples.chat.length || !state.samples.work.length) {
      setStatus('반대 모드도 1회 기록하면 이 PC의 프로필로 자동 교체합니다.', 'info');
    } else if (state.comparison?.endpointDiffers) {
      setStatus('Chat과 Work endpoint가 다릅니다. 안전을 위해 직접 전환을 막았습니다.', 'warn');
    } else {
      setStatus(`프로필 갱신 완료: 전환 후보 ${state.comparison?.discriminatorCount || 0}개`, 'ok');
    }
  }

  async function attachResponse(data) {
    for (const mode of ['chat', 'work']) {
      const sample = state.samples[mode].find((item) => item.captureId === data.captureId);
      if (!sample) continue;
      sample.response = data.response;
      recompute();
      await saveState();
      render();
      break;
    }
  }

  async function reset() {
    state = { samples: { chat: [], work: [] }, comparison: SEEDED_COMPARISON };
    captureMode = null;
    switchMode = null;
    switchStatus = null;
    comparisonSource = 'seeded';
    post('CW_CAPTURE_MODE', { mode: null });
    post('CW_SWITCH_DISABLE', { reason: 'user-reset' });
    await saveState();
    render();
    setStatus('사용자 기록을 초기화했습니다. 기본 관찰 프로필로 돌아갔습니다.', 'info');
  }

  function switchConfig(mode) {
    const comparison = activeComparison();
    if (!comparison || comparison.endpointDiffers) throw new Error('현재 프로필로는 안전하게 전환할 수 없습니다.');
    const conversationId = currentConversationId();
    if (!conversationId) throw new Error('기존 /c/... 대화에서만 전환할 수 있습니다.');

    const target = comparison[mode];
    const otherMode = mode === 'chat' ? 'work' : 'chat';
    const source = comparison[otherMode];
    const targetOps = mode === 'chat' ? target.differencesFromWork : target.differencesFromChat;
    const sourceOps = otherMode === 'chat' ? source.differencesFromWork : source.differencesFromChat;
    const endpoint = target.endpoint || source.endpoint;

    if (!endpoint || !Array.isArray(targetOps) || !Array.isArray(sourceOps) || targetOps.length === 0) {
      throw new Error('전환 프로필이 충분하지 않습니다.');
    }

    return { conversationId, endpoint, sourceOps, targetOps };
  }

  function setSwitch(mode) {
    if (!['chat', 'work'].includes(mode)) throw new Error('지원하지 않는 전환 모드입니다.');
    const config = switchConfig(mode);
    captureMode = null;
    post('CW_CAPTURE_MODE', { mode: null });
    post('CW_SWITCH_CONFIG', { mode, ...config });
    switchMode = mode;
    switchStatus = 'armed';
    setStatus(`${mode === 'chat' ? 'Chat' : 'Work'} 전환이 준비되었습니다. 이 대화에서 다음 메시지를 보내세요.`, 'warn');
    render();
  }

  function disableSwitch(reason = 'user-disabled') {
    post('CW_SWITCH_DISABLE', { reason });
    switchMode = null;
    switchStatus = null;
    setStatus('직접 전환을 해제했습니다.', 'info');
    render();
  }

  function diagnosticText() {
    const comparison = activeComparison();
    return JSON.stringify({
      switcherVersion: '0.1.0-preview',
      experimental: true,
      page: { routeKind: routeKind() },
      active: { captureMode, switchMode, switchStatus },
      profileSource: comparisonSource,
      sampleCounts: { chat: state.samples.chat.length, work: state.samples.work.length },
      comparison,
      samples: state.samples
    }, null, 2);
  }

  function snapshot() {
    const comparison = activeComparison();
    return {
      switcherVersion: '0.1.0-preview',
      captureMode,
      switchMode,
      switchStatus,
      sampleCounts: {
        chat: state.samples.chat.length,
        work: state.samples.work.length
      },
      comparison,
      profileSource: comparisonSource,
      switchAvailable: Boolean(currentConversationId() && comparison && !comparison.endpointDiffers && comparison.discriminatorCount > 0),
      routeKind: routeKind()
    };
  }

  function render() {
    if (!ui.host) return;
    const snap = snapshot();
    ui.switchChat.dataset.active = switchMode === 'chat' ? 'true' : 'false';
    ui.switchWork.dataset.active = switchMode === 'work' ? 'true' : 'false';
    ui.captureChat.dataset.active = captureMode === 'chat' ? 'true' : 'false';
    ui.captureWork.dataset.active = captureMode === 'work' ? 'true' : 'false';
    ui.captureChat.textContent = `Chat 기록 ${state.samples.chat.length}`;
    ui.captureWork.textContent = `Work 기록 ${state.samples.work.length}`;
    ui.switchChat.disabled = !snap.switchAvailable;
    ui.switchWork.disabled = !snap.switchAvailable;
    ui.readiness.textContent = `${comparisonSource === 'captured' ? '내 캡처' : '기본 관찰'} · ${snap.comparison?.confidence || '없음'} · 차이 ${snap.comparison?.discriminatorCount || 0}개`;
    if (!ui.diag.hidden) ui.diag.value = diagnosticText();
  }

  function mount() {
    if (document.getElementById('cw-switcher-root')) return;
    const host = document.createElement('aside');
    host.id = 'cw-switcher-root';
    host.innerHTML = `
      <div class="cw-bar">
        <button data-role="switch-chat">Chat</button>
        <button data-role="switch-work">Work</button>
        <button class="cw-gear" data-role="gear" title="설정">⚙</button>
      </div>
      <section class="cw-panel" data-role="panel" hidden>
        <div class="cw-title">Chat ↔ Work Switcher <span>v0.1.0 preview</span></div>
        <div class="cw-readiness" data-role="readiness"></div>
        <p class="cw-help">Chat/Work 버튼은 현재 conversation ID와 message tree를 그대로 두고 다음 전송 요청의 확인된 모드 제어 필드만 바꾸는 실험 기능입니다.</p>
        <p class="cw-help">현재 프로필은 2026-08-10 실제 Chat/Work 요청 1쌍에서 확인된 model, thinking_effort, conversation_origin, service_tier 차이를 사용합니다.</p>
        <div class="cw-actions">
          <button data-role="capture-chat">Chat 기록 0</button>
          <button data-role="capture-work">Work 기록 0</button>
        </div>
        <div class="cw-actions">
          <button data-role="diagnostics">진단 보기</button>
          <button data-role="disable-switch">전환 해제</button>
          <button data-role="reset">기록 초기화</button>
        </div>
        <textarea class="cw-diagnostics" data-role="diag" readonly hidden></textarea>
      </section>
      <div class="cw-status" data-role="status" data-kind="info">동일 conversation 전환 preview 준비됨</div>
    `;
    document.documentElement.appendChild(host);

    ui = {
      host,
      switchChat: host.querySelector('[data-role="switch-chat"]'),
      switchWork: host.querySelector('[data-role="switch-work"]'),
      captureChat: host.querySelector('[data-role="capture-chat"]'),
      captureWork: host.querySelector('[data-role="capture-work"]'),
      gear: host.querySelector('[data-role="gear"]'),
      panel: host.querySelector('[data-role="panel"]'),
      readiness: host.querySelector('[data-role="readiness"]'),
      diagnostics: host.querySelector('[data-role="diagnostics"]'),
      disable: host.querySelector('[data-role="disable-switch"]'),
      reset: host.querySelector('[data-role="reset"]'),
      diag: host.querySelector('[data-role="diag"]'),
      status: host.querySelector('[data-role="status"]')
    };

    ui.switchChat.addEventListener('click', () => { try { setSwitch('chat'); } catch (e) { setStatus(e.message, 'error'); } });
    ui.switchWork.addEventListener('click', () => { try { setSwitch('work'); } catch (e) { setStatus(e.message, 'error'); } });
    ui.captureChat.addEventListener('click', () => setCapture('chat'));
    ui.captureWork.addEventListener('click', () => setCapture('work'));
    ui.gear.addEventListener('click', () => { ui.panel.hidden = !ui.panel.hidden; });
    ui.disable.addEventListener('click', () => disableSwitch());
    ui.reset.addEventListener('click', reset);
    ui.diagnostics.addEventListener('click', () => {
      ui.diag.hidden = !ui.diag.hidden;
      ui.diag.value = diagnosticText();
      if (!ui.diag.hidden) ui.diag.select();
    });
    render();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== 'bridge-to-extension') return;
    if (data.type === 'CW_CAPTURED') acceptSample(data.mode, data.sample);
    if (data.type === 'CW_CAPTURE_RESPONSE') attachResponse(data);
    if (data.type === 'CW_SWITCH_READY') {
      switchStatus = 'armed';
      setStatus(`${data.mode === 'chat' ? 'Chat' : 'Work'} 전환 준비 완료. 다음 메시지 전송 때 적용됩니다.`, 'warn');
      render();
    }
    if (data.type === 'CW_SWITCH_APPLIED') {
      switchStatus = 'applied';
      setStatus(`${data.mode === 'chat' ? 'Chat' : 'Work'} 요청 프로필을 적용했습니다. 서버 응답을 확인하세요.`, 'ok');
      render();
    }
    if (data.type === 'CW_SWITCH_BYPASS') {
      switchStatus = 'bypassed';
      setStatus(`전환을 적용하지 않았습니다: ${data.reason}`, 'warn');
      render();
    }
    if (data.type === 'CW_SWITCH_DISABLED' || data.type === 'CW_SWITCH_REJECTED') {
      switchMode = null;
      switchStatus = data.reason || 'disabled';
      setStatus(`안전을 위해 전환을 해제했습니다: ${data.reason || 'unknown'}`, 'error');
      render();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== 'chat-work-switcher-popup') return undefined;

    (async () => {
      if (message.type === 'CW_POPUP_GET_STATE') return { ok: true, snapshot: snapshot() };
      if (message.type === 'CW_POPUP_SET_CAPTURE') {
        if (!['chat', 'work'].includes(message.mode)) throw new Error('지원하지 않는 기록 모드입니다.');
        setCapture(message.mode);
        return { ok: true, snapshot: snapshot() };
      }
      if (message.type === 'CW_POPUP_SET_SWITCH') {
        setSwitch(message.mode);
        return { ok: true, snapshot: snapshot() };
      }
      if (message.type === 'CW_POPUP_DISABLE_SWITCH') {
        disableSwitch('popup-user-disabled');
        return { ok: true, snapshot: snapshot() };
      }
      if (message.type === 'CW_POPUP_RESET') {
        await reset();
        return { ok: true, snapshot: snapshot() };
      }
      if (message.type === 'CW_POPUP_GET_DIAGNOSTICS') return { ok: true, text: diagnosticText(), snapshot: snapshot() };
      throw new Error('알 수 없는 팝업 명령입니다.');
    })().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

    return true;
  });

  (async () => {
    await loadState();
    switchMode = null;
    switchStatus = null;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  })();
})();
