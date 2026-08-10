(() => {
  'use strict';

  const CHANNEL = 'chat-work-switcher-probe-v1';
  const STORAGE_KEY = 'chatWorkSwitcherProbeStateV1';
  const MAX_SAMPLES = 3;
  const core = globalThis.ChatWorkProfileCore;

  let state = { samples: { chat: [], work: [] }, comparison: null };
  let captureMode = null;
  let ui = {};

  const post = (type, payload = {}) => window.postMessage({
    channel: CHANNEL,
    direction: 'extension-to-bridge',
    type,
    ...payload
  }, '*');

  async function loadState() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (stored[STORAGE_KEY]?.samples) state = stored[STORAGE_KEY];
    recompute();
  }

  async function saveState() {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function recompute() {
    state.comparison = core.buildComparison(state.samples.chat, state.samples.work);
  }

  function setStatus(text, kind = 'info') {
    if (!ui.status) return;
    ui.status.textContent = text;
    ui.status.dataset.kind = kind;
  }

  function setCapture(mode) {
    captureMode = captureMode === mode ? null : mode;
    post('CW_CAPTURE_MODE', { mode: captureMode });
    setStatus(captureMode ? `${captureMode === 'chat' ? 'Chat' : 'Work'} native 대화에서 메시지 1회를 보내세요.` : '캡처를 취소했습니다.', 'info');
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
      setStatus('반대 모드도 1회 캡처하면 차이를 계산합니다.', 'info');
    } else if (state.comparison?.endpointDiffers) {
      setStatus('Chat과 Work가 서로 다른 endpoint를 사용합니다. 요청 변조 없이 차이만 기록했습니다.', 'warn');
    } else {
      setStatus(`읽기 전용 비교 완료: 안정 후보 ${state.comparison?.discriminatorCount || 0}개`, 'ok');
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
    state = { samples: { chat: [], work: [] }, comparison: null };
    captureMode = null;
    post('CW_CAPTURE_MODE', { mode: null });
    await saveState();
    render();
    setStatus('캡처 데이터를 초기화했습니다.', 'info');
  }

  function diagnosticText() {
    return JSON.stringify({
      probeVersion: '0.0.1',
      readOnly: true,
      page: {
        routeKind: location.pathname.includes('/c/') ? (location.pathname.includes('/g/') ? 'project-conversation' : 'conversation') : 'non-conversation'
      },
      sampleCounts: { chat: state.samples.chat.length, work: state.samples.work.length },
      comparison: state.comparison,
      samples: state.samples
    }, null, 2);
  }

  function render() {
    if (!ui.host) return;
    ui.captureChat.dataset.active = captureMode === 'chat' ? 'true' : 'false';
    ui.captureWork.dataset.active = captureMode === 'work' ? 'true' : 'false';
    ui.captureChat.textContent = `Chat 기록 ${state.samples.chat.length}`;
    ui.captureWork.textContent = `Work 기록 ${state.samples.work.length}`;
    ui.readiness.textContent = state.comparison
      ? `${state.comparison.endpointDiffers ? 'endpoint 다름' : 'endpoint 동일'} · 차이 ${state.comparison.discriminatorCount}개 · ${state.comparison.confidence === 'high' ? '고신뢰' : '임시'}`
      : 'Chat/Work를 각각 1회 기록하세요';
    if (!ui.diag.hidden) ui.diag.value = diagnosticText();
  }

  function mount() {
    if (document.getElementById('cw-switcher-root')) return;
    const host = document.createElement('aside');
    host.id = 'cw-switcher-root';
    host.innerHTML = `
      <div class="cw-bar">
        <button data-role="capture-chat">Chat 기록 0</button>
        <button data-role="capture-work">Work 기록 0</button>
        <button class="cw-gear" data-role="gear" title="설정">⚙</button>
      </div>
      <section class="cw-panel" data-role="panel" hidden>
        <div class="cw-title">Chat ↔ Work Probe <span>v0.0.1 · READ ONLY</span></div>
        <div class="cw-readiness" data-role="readiness"></div>
        <p class="cw-help">이 빌드는 전환 요청을 만들지 않습니다. native Chat과 native Work에서 각각 한 번씩 메시지 전송 요청을 관찰해 endpoint와 민감정보가 제거된 제어 필드 차이만 기록합니다.</p>
        <p class="cw-help">프롬프트, 메시지 배열, conversation/message ID, 토큰, 쿠키, 인증정보, 첨부파일은 저장하지 않습니다.</p>
        <div class="cw-actions">
          <button data-role="diagnostics">진단 보기</button>
          <button data-role="reset">기록 초기화</button>
        </div>
        <textarea class="cw-diagnostics" data-role="diag" readonly hidden></textarea>
      </section>
      <div class="cw-status" data-role="status" data-kind="info">읽기 전용 프로브 준비됨</div>
    `;
    document.documentElement.appendChild(host);

    ui = {
      host,
      captureChat: host.querySelector('[data-role="capture-chat"]'),
      captureWork: host.querySelector('[data-role="capture-work"]'),
      gear: host.querySelector('[data-role="gear"]'),
      panel: host.querySelector('[data-role="panel"]'),
      readiness: host.querySelector('[data-role="readiness"]'),
      diagnostics: host.querySelector('[data-role="diagnostics"]'),
      reset: host.querySelector('[data-role="reset"]'),
      diag: host.querySelector('[data-role="diag"]'),
      status: host.querySelector('[data-role="status"]')
    };

    ui.captureChat.addEventListener('click', () => setCapture('chat'));
    ui.captureWork.addEventListener('click', () => setCapture('work'));
    ui.gear.addEventListener('click', () => { ui.panel.hidden = !ui.panel.hidden; });
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
  });

  (async () => {
    await loadState();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  })();
})();
