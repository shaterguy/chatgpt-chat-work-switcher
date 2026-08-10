(() => {
  'use strict';

  const CHANNEL = 'chat-work-switcher-v1';
  const STORAGE_KEY = 'chatWorkSwitcherStateV1';
  const MAX_SAMPLES = 3;
  const core = globalThis.ChatWorkProfileCore;

  let state = {
    samples: { chat: [], work: [] },
    profiles: null,
    modeByConversation: {}
  };
  let captureMode = null;
  let currentConversationId = null;
  let ui = {};

  const post = (type, payload = {}) => window.postMessage({
    channel: CHANNEL,
    direction: 'extension-to-bridge',
    type,
    ...payload
  }, '*');

  function conversationIdFromUrl() {
    return location.pathname.match(/\/c\/([0-9a-z-]+)/i)?.[1] || null;
  }

  async function loadState() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const next = stored[STORAGE_KEY];
    if (next && next.samples && next.modeByConversation) state = next;
    recomputeProfiles();
  }

  async function saveState() {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function recomputeProfiles() {
    state.profiles = core.buildProfiles(state.samples.chat, state.samples.work);
  }

  function ready() {
    return Boolean(state.profiles && state.profiles.discriminatorCount > 0 && !state.profiles.endpointDiffers);
  }

  function configureCurrentConversation() {
    currentConversationId = conversationIdFromUrl();
    if (!currentConversationId || !ready()) {
      post('CW_DISABLE');
      render();
      return;
    }
    const mode = state.modeByConversation[currentConversationId];
    if (!mode) {
      post('CW_DISABLE');
      render();
      return;
    }
    const profile = state.profiles[mode];
    post('CW_CONFIG', {
      conversationId: currentConversationId,
      mode,
      ops: profile.ops
    });
    render();
  }

  async function selectMode(mode) {
    if (!currentConversationId || !ready()) return;
    state.modeByConversation[currentConversationId] = mode;
    await saveState();
    configureCurrentConversation();
    setStatus(`${mode === 'chat' ? 'Chat' : 'Work'} 전환 준비됨`, 'ok');
  }

  function setCapture(mode) {
    captureMode = captureMode === mode ? null : mode;
    post('CW_CAPTURE_MODE', { mode: captureMode });
    setStatus(captureMode ? `${captureMode === 'chat' ? 'Chat' : 'Work'} 요청 1회를 보내 캡처하세요.` : '캡처 중지', 'info');
    render();
  }

  async function acceptSample(mode, sample) {
    if (!['chat', 'work'].includes(mode) || mode !== captureMode) return;
    state.samples[mode].push(sample);
    if (state.samples[mode].length > MAX_SAMPLES) state.samples[mode].shift();
    captureMode = null;
    post('CW_CAPTURE_MODE', { mode: null });
    recomputeProfiles();
    await saveState();
    render();
    if (state.profiles?.endpointDiffers) {
      setStatus('Chat/Work가 서로 다른 endpoint를 사용합니다. 안전상 자동 변환을 중지했습니다.', 'error');
    } else if (ready()) {
      setStatus(`프로필 학습 완료 (${state.profiles.discriminatorCount}개 모드 차이)`, 'ok');
      configureCurrentConversation();
    } else {
      setStatus('반대 모드도 한 번 캡처하세요.', 'info');
    }
  }

  async function resetProfiles() {
    state.samples = { chat: [], work: [] };
    state.profiles = null;
    state.modeByConversation = {};
    captureMode = null;
    await saveState();
    post('CW_DISABLE');
    render();
    setStatus('학습 데이터를 초기화했습니다.', 'info');
  }

  function diagnosticText() {
    return JSON.stringify({
      version: 1,
      conversationDetected: Boolean(currentConversationId),
      samples: { chat: state.samples.chat.length, work: state.samples.work.length },
      profiles: state.profiles ? {
        discriminatorCount: state.profiles.discriminatorCount,
        endpointDiffers: state.profiles.endpointDiffers,
        confidence: state.profiles.confidence,
        chatEndpoint: state.profiles.chat.endpoint,
        workEndpoint: state.profiles.work.endpoint,
        chatOps: state.profiles.chat.ops,
        workOps: state.profiles.work.ops
      } : null
    }, null, 2);
  }

  function setStatus(text, kind = 'info') {
    if (!ui.status) return;
    ui.status.textContent = text;
    ui.status.dataset.kind = kind;
  }

  function render() {
    if (!ui.host) return;
    currentConversationId = conversationIdFromUrl();
    const profileReady = ready();
    const selected = currentConversationId ? state.modeByConversation[currentConversationId] : null;

    ui.chat.disabled = !currentConversationId || !profileReady;
    ui.work.disabled = !currentConversationId || !profileReady;
    ui.chat.dataset.active = selected === 'chat' ? 'true' : 'false';
    ui.work.dataset.active = selected === 'work' ? 'true' : 'false';
    ui.captureChat.dataset.active = captureMode === 'chat' ? 'true' : 'false';
    ui.captureWork.dataset.active = captureMode === 'work' ? 'true' : 'false';
    ui.captureChat.textContent = `Chat 캡처 (${state.samples.chat.length})`;
    ui.captureWork.textContent = `Work 캡처 (${state.samples.work.length})`;
    ui.conv.textContent = currentConversationId ? `대화 ${currentConversationId.slice(0, 8)}…` : '대화 화면이 아닙니다';
    ui.readiness.textContent = state.profiles
      ? state.profiles.endpointDiffers
        ? 'endpoint 차이 감지 — 안전 중지'
        : state.profiles.discriminatorCount > 0
          ? `모드 차이 ${state.profiles.discriminatorCount}개 · ${state.profiles.confidence === 'high' ? '고신뢰' : '임시'}`
          : '모드 차이를 찾지 못함'
      : 'Chat/Work를 각각 1회 캡처하세요';
  }

  function mount() {
    if (document.getElementById('cw-switcher-root')) return;
    const host = document.createElement('aside');
    host.id = 'cw-switcher-root';
    host.innerHTML = `
      <div class="cw-bar">
        <button class="cw-mode" data-role="chat">Chat</button>
        <button class="cw-mode" data-role="work">Work</button>
        <button class="cw-gear" data-role="gear" title="설정">⚙</button>
      </div>
      <section class="cw-panel" data-role="panel" hidden>
        <div class="cw-title">Chat ↔ Work Switcher <span>v0.1.0</span></div>
        <div class="cw-conv" data-role="conv"></div>
        <div class="cw-readiness" data-role="readiness"></div>
        <p class="cw-help">기존 native Chat 대화에서 Chat 캡처를 누르고 메시지 1회를 보내세요. native Work 대화에서도 같은 방식으로 1회 캡처하면 현재 conversation에 적용할 차이만 학습합니다. 메시지 본문·ID·토큰은 저장하지 않습니다.</p>
        <div class="cw-captures">
          <button data-role="capture-chat">Chat 캡처 (0)</button>
          <button data-role="capture-work">Work 캡처 (0)</button>
        </div>
        <div class="cw-actions">
          <button data-role="diagnostics">진단 보기</button>
          <button data-role="reset">학습 초기화</button>
        </div>
        <textarea class="cw-diagnostics" data-role="diag" readonly hidden></textarea>
      </section>
      <div class="cw-status" data-role="status" data-kind="info">확장 프로그램 준비됨</div>
    `;
    document.documentElement.appendChild(host);

    ui = {
      host,
      chat: host.querySelector('[data-role="chat"]'),
      work: host.querySelector('[data-role="work"]'),
      gear: host.querySelector('[data-role="gear"]'),
      panel: host.querySelector('[data-role="panel"]'),
      conv: host.querySelector('[data-role="conv"]'),
      readiness: host.querySelector('[data-role="readiness"]'),
      captureChat: host.querySelector('[data-role="capture-chat"]'),
      captureWork: host.querySelector('[data-role="capture-work"]'),
      diagnostics: host.querySelector('[data-role="diagnostics"]'),
      reset: host.querySelector('[data-role="reset"]'),
      diag: host.querySelector('[data-role="diag"]'),
      status: host.querySelector('[data-role="status"]')
    };

    ui.chat.addEventListener('click', () => selectMode('chat'));
    ui.work.addEventListener('click', () => selectMode('work'));
    ui.gear.addEventListener('click', () => { ui.panel.hidden = !ui.panel.hidden; });
    ui.captureChat.addEventListener('click', () => setCapture('chat'));
    ui.captureWork.addEventListener('click', () => setCapture('work'));
    ui.reset.addEventListener('click', resetProfiles);
    ui.diagnostics.addEventListener('click', () => {
      ui.diag.hidden = !ui.diag.hidden;
      ui.diag.value = diagnosticText();
      if (!ui.diag.hidden) ui.diag.select();
    });

    render();
    configureCurrentConversation();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== 'bridge-to-extension') return;
    if (data.type === 'CW_CAPTURED') acceptSample(data.mode, data.sample);
    if (data.type === 'CW_APPLIED') setStatus(`${data.mode === 'chat' ? 'Chat' : 'Work'} 모드 차이 ${data.operationCount}개 적용`, 'ok');
    if (data.type === 'CW_ROLLBACK') {
      if (data.conversationId) delete state.modeByConversation[data.conversationId];
      saveState();
      render();
      setStatus(`서버 오류(${data.status ?? 'network'})로 변환을 자동 해제했습니다. 원본 동작으로 되돌아갑니다.`, 'error');
    }
    if (data.type === 'CW_INVARIANT_REJECTED') setStatus('conversation ID 불변조건이 맞지 않아 요청 변환을 차단했습니다.', 'error');
  });

  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    configureCurrentConversation();
  }, 500);

  (async () => {
    await loadState();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }
  })();
})();
