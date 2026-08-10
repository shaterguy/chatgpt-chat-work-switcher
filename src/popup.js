(() => {
  'use strict';

  const status = document.querySelector('[data-role="status"]');
  const switchChatButton = document.querySelector('[data-action="switch-chat"]');
  const switchWorkButton = document.querySelector('[data-action="switch-work"]');
  const disableSwitchButton = document.querySelector('[data-action="disable-switch"]');
  const captureChatButton = document.querySelector('[data-action="capture-chat"]');
  const captureWorkButton = document.querySelector('[data-action="capture-work"]');
  const chatCount = document.querySelector('[data-role="chat-count"]');
  const workCount = document.querySelector('[data-role="work-count"]');
  const diagnosticsButton = document.querySelector('[data-action="diagnostics"]');
  const resetButton = document.querySelector('[data-action="reset"]');
  const copyButton = document.querySelector('[data-action="copy"]');
  const diagnosticsPanel = document.querySelector('[data-role="diagnostics-panel"]');
  const diagnosticsText = document.querySelector('[data-role="diagnostics-text"]');

  let activeTabId = null;

  function setStatus(text, kind = 'info') {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function setEnabled(enabled) {
    for (const button of [
      switchChatButton,
      switchWorkButton,
      disableSwitchButton,
      captureChatButton,
      captureWorkButton,
      diagnosticsButton,
      resetButton
    ]) {
      button.disabled = !enabled;
    }
  }

  function renderSnapshot(snapshot) {
    if (!snapshot) return;
    chatCount.textContent = String(snapshot.sampleCounts?.chat ?? 0);
    workCount.textContent = String(snapshot.sampleCounts?.work ?? 0);
    switchChatButton.dataset.active = snapshot.switchMode === 'chat' ? 'true' : 'false';
    switchWorkButton.dataset.active = snapshot.switchMode === 'work' ? 'true' : 'false';
    captureChatButton.dataset.active = snapshot.captureMode === 'chat' ? 'true' : 'false';
    captureWorkButton.dataset.active = snapshot.captureMode === 'work' ? 'true' : 'false';
    switchChatButton.disabled = !snapshot.switchAvailable;
    switchWorkButton.disabled = !snapshot.switchAvailable;

    if (snapshot.captureMode === 'chat') {
      setStatus('Chat 기록 대기 중입니다. native Chat 대화에서 메시지를 1회 보내세요.', 'ok');
    } else if (snapshot.captureMode === 'work') {
      setStatus('Work 기록 대기 중입니다. native Work 대화에서 메시지를 1회 보내세요.', 'ok');
    } else if (snapshot.switchMode === 'chat') {
      setStatus('Chat 전환 준비됨. 같은 대화에서 다음 메시지를 보내세요.', snapshot.switchStatus === 'applied' ? 'ok' : 'warn');
    } else if (snapshot.switchMode === 'work') {
      setStatus('Work 전환 준비됨. 같은 대화에서 다음 메시지를 보내세요.', snapshot.switchStatus === 'applied' ? 'ok' : 'warn');
    } else if (snapshot.comparison?.endpointDiffers) {
      setStatus('Chat/Work endpoint가 달라 직접 전환을 막았습니다.', 'warn');
    } else if (snapshot.switchAvailable) {
      setStatus(`전환 가능 · ${snapshot.profileSource === 'captured' ? '내 캡처 프로필' : '기본 관찰 프로필'} · 차이 ${snapshot.comparison?.discriminatorCount || 0}개`, 'ok');
    } else {
      setStatus('기존 ChatGPT /c/... 대화에서 사용해 주세요.', 'info');
    }
  }

  async function currentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('활성 탭을 찾지 못했습니다.');
    if (!String(tab.url || '').startsWith('https://chatgpt.com/')) {
      throw new Error('ChatGPT 탭에서 확장프로그램 아이콘을 눌러주세요.');
    }
    activeTabId = tab.id;
    return tab;
  }

  async function send(type, payload = {}) {
    if (!activeTabId) await currentTab();
    try {
      return await chrome.tabs.sendMessage(activeTabId, {
        source: 'chat-work-switcher-popup',
        type,
        ...payload
      });
    } catch (error) {
      const message = String(error?.message || error);
      if (message.includes('Receiving end does not exist') || message.includes('Could not establish connection')) {
        throw new Error('ChatGPT 탭에 새 버전이 아직 로드되지 않았습니다. 탭을 새로고침한 뒤 다시 눌러주세요.');
      }
      throw error;
    }
  }

  async function refresh() {
    setEnabled(false);
    try {
      await currentTab();
      const response = await send('CW_POPUP_GET_STATE');
      if (!response?.ok) throw new Error(response?.error || '상태를 읽지 못했습니다.');
      setEnabled(true);
      renderSnapshot(response.snapshot);
    } catch (error) {
      setStatus(error.message || String(error), 'error');
      setEnabled(false);
    }
  }

  async function setSwitch(mode) {
    try {
      const response = await send('CW_POPUP_SET_SWITCH', { mode });
      if (!response?.ok) throw new Error(response?.error || '전환 준비에 실패했습니다.');
      renderSnapshot(response.snapshot);
    } catch (error) {
      setStatus(error.message || String(error), 'error');
    }
  }

  async function setCapture(mode) {
    try {
      const response = await send('CW_POPUP_SET_CAPTURE', { mode });
      if (!response?.ok) throw new Error(response?.error || '기록 모드 설정에 실패했습니다.');
      renderSnapshot(response.snapshot);
    } catch (error) {
      setStatus(error.message || String(error), 'error');
    }
  }

  switchChatButton.addEventListener('click', () => setSwitch('chat'));
  switchWorkButton.addEventListener('click', () => setSwitch('work'));
  captureChatButton.addEventListener('click', () => setCapture('chat'));
  captureWorkButton.addEventListener('click', () => setCapture('work'));

  disableSwitchButton.addEventListener('click', async () => {
    try {
      const response = await send('CW_POPUP_DISABLE_SWITCH');
      if (!response?.ok) throw new Error(response?.error || '전환 해제에 실패했습니다.');
      renderSnapshot(response.snapshot);
      setStatus('직접 전환을 해제했습니다.', 'ok');
    } catch (error) {
      setStatus(error.message || String(error), 'error');
    }
  });

  resetButton.addEventListener('click', async () => {
    try {
      const response = await send('CW_POPUP_RESET');
      if (!response?.ok) throw new Error(response?.error || '초기화에 실패했습니다.');
      diagnosticsPanel.hidden = true;
      diagnosticsText.value = '';
      renderSnapshot(response.snapshot);
      setStatus('사용자 기록을 초기화했습니다. 기본 관찰 프로필로 돌아갔습니다.', 'ok');
    } catch (error) {
      setStatus(error.message || String(error), 'error');
    }
  });

  diagnosticsButton.addEventListener('click', async () => {
    try {
      const response = await send('CW_POPUP_GET_DIAGNOSTICS');
      if (!response?.ok) throw new Error(response?.error || '진단 정보를 읽지 못했습니다.');
      diagnosticsText.value = response.text || '';
      diagnosticsPanel.hidden = false;
      diagnosticsText.focus();
      diagnosticsText.select();
      setStatus('진단 정보를 표시했습니다.', 'ok');
    } catch (error) {
      setStatus(error.message || String(error), 'error');
    }
  });

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(diagnosticsText.value || '');
      setStatus('진단 정보를 클립보드에 복사했습니다.', 'ok');
    } catch {
      diagnosticsText.focus();
      diagnosticsText.select();
      setStatus('자동 복사가 차단되었습니다. 선택된 내용을 직접 복사해 주세요.', 'warn');
    }
  });

  refresh();
})();
