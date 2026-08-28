(() => {
  'use strict';

  const core = globalThis.ChatGptRequestSnapshotCore;
  const CONFIG_KEY = 'chatGptRequestSnapshotConfigV1';
  const CAPTURES_KEY = 'chatGptRequestSnapshotCapturesV1';
  const SOURCE = 'chatgpt-request-snapshot-popup';

  const els = {
    chatModels: document.getElementById('chat-models'),
    chatReasoning: document.getElementById('chat-reasoning'),
    workModels: document.getElementById('work-models'),
    workReasoning: document.getElementById('work-reasoning'),
    generate: document.getElementById('generate'),
    resetCaptures: document.getElementById('reset-captures'),
    planSummary: document.getElementById('plan-summary'),
    scenarioList: document.getElementById('scenario-list'),
    armNext: document.getElementById('arm-next'),
    armedStatus: document.getElementById('armed-status'),
    copyJson: document.getElementById('copy-json'),
    downloadJson: document.getElementById('download-json'),
    exportPreview: document.getElementById('export-preview'),
    status: document.getElementById('status'),
    tabStatus: document.getElementById('tab-status')
  };

  let plan = null;
  let captures = [];
  let activeTabId = null;
  let activeScenario = null;

  function setStatus(text, kind = 'info') {
    els.status.textContent = text;
    els.status.dataset.kind = kind;
  }

  function configFromInputs() {
    return {
      chatModels: core.normalizeList(els.chatModels.value),
      chatReasoning: core.normalizeList(els.chatReasoning.value),
      workModels: core.normalizeList(els.workModels.value),
      workReasoning: core.normalizeList(els.workReasoning.value)
    };
  }

  function putConfig(config) {
    els.chatModels.value = (config.chatModels || []).join('\n');
    els.chatReasoning.value = (config.chatReasoning || []).join('\n');
    els.workModels.value = (config.workModels || []).join('\n');
    els.workReasoning.value = (config.workReasoning || []).join('\n');
  }

  async function currentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('활성 탭을 찾지 못했습니다.');
    if (!String(tab.url || '').startsWith('https://chatgpt.com/')) {
      throw new Error('ChatGPT 탭에서 확장프로그램을 열어주세요.');
    }
    activeTabId = tab.id;
    els.tabStatus.textContent = 'ChatGPT 연결';
    return tab;
  }

  async function send(type, payload = {}) {
    if (!activeTabId) await currentTab();
    try {
      return await chrome.tabs.sendMessage(activeTabId, { source: SOURCE, type, ...payload });
    } catch (error) {
      throw new Error('현재 ChatGPT 탭에 캡처 스크립트가 없습니다. 확장프로그램 설치 후 이 탭을 한 번 새로고침해 주세요.');
    }
  }

  function captureCounts() {
    const counts = new Map();
    for (const capture of captures) counts.set(capture.scenarioId, (counts.get(capture.scenarioId) || 0) + 1);
    return counts;
  }

  function escapeText(value) {
    return String(value ?? '');
  }

  function render() {
    if (!plan || plan.error) {
      els.planSummary.textContent = plan?.error || '옵션을 입력해 주세요.';
      els.scenarioList.replaceChildren();
      els.armNext.disabled = true;
      updateExport();
      return;
    }
    const counts = captureCounts();
    const completedRequired = plan.scenarios.filter((item) => item.required && counts.has(item.id)).length;
    els.planSummary.textContent = `필수 ${plan.requiredCount}회 · 완료 ${completedRequired}/${plan.requiredCount} · 선택 교차검증 ${plan.optionalCount}회`;
    els.armNext.disabled = completedRequired >= plan.requiredCount;
    els.scenarioList.replaceChildren();

    for (const scenario of plan.scenarios) {
      const count = counts.get(scenario.id) || 0;
      const card = document.createElement('div');
      card.className = 'scenario';
      card.dataset.done = count > 0 ? 'true' : 'false';

      const top = document.createElement('div');
      top.className = 'scenario-top';
      const title = document.createElement('div');
      title.className = 'scenario-title';
      title.textContent = `${scenario.order}. ${scenario.mode.toUpperCase()} · ${scenario.phase === 'first' ? '첫 턴' : '후속 턴'}`;
      const tag = document.createElement('span');
      tag.className = scenario.required ? 'tag' : 'tag optional';
      tag.textContent = scenario.required ? '필수' : '선택';
      title.appendChild(tag);
      if (count) {
        const done = document.createElement('span');
        done.className = 'tag done';
        done.textContent = `캡처 ${count}`;
        title.appendChild(done);
      }
      const button = document.createElement('button');
      button.textContent = activeScenario?.id === scenario.id ? '대기 중' : '이 시나리오 대기';
      button.disabled = activeScenario?.id === scenario.id;
      button.addEventListener('click', () => armScenario(scenario));
      top.append(title, button);

      const meta = document.createElement('div');
      meta.className = 'scenario-meta';
      meta.textContent = `모델: ${escapeText(scenario.model)} · 추론: ${escapeText(scenario.reasoning)}`;
      const instruction = document.createElement('div');
      instruction.className = 'scenario-instruction';
      instruction.textContent = scenario.instruction;
      card.append(top, meta, instruction);
      els.scenarioList.appendChild(card);
    }
    els.armedStatus.textContent = activeScenario
      ? `캡처 대기: ${activeScenario.order}. ${activeScenario.mode.toUpperCase()} · ${activeScenario.model} · ${activeScenario.reasoning}`
      : '대기 중인 시나리오 없음';
    els.armedStatus.dataset.active = activeScenario ? 'true' : 'false';
    updateExport();
  }

  async function armScenario(scenario) {
    try {
      const response = await send('RS_ARM_SCENARIO', { scenario });
      if (!response?.ok) throw new Error(response?.error || '캡처 대기 설정에 실패했습니다.');
      activeScenario = scenario;
      render();
      setStatus('이제 ChatGPT에서 메뉴를 원하는 상태로 맞춘 뒤 프롬프트를 1회 전송하세요. 메뉴 클릭 자체는 기록되지 않습니다.', 'warn');
    } catch (error) {
      setStatus(error.message || String(error), 'error');
    }
  }

  function nextMissingScenario() {
    if (!plan?.scenarios) return null;
    const counts = captureCounts();
    return plan.scenarios.find((item) => item.required && !counts.has(item.id)) || null;
  }

  function exportObject() {
    const analysis = plan && !plan.error ? core.buildAnalysis(plan, captures) : [];
    return {
      schema: 'chatgpt-request-snapshot-calibration-v1',
      extensionVersion: '0.2.0-dev1',
      exportedAt: new Date().toISOString(),
      privacy: {
        promptTextStored: false,
        messageContentStored: false,
        attachmentsStored: false,
        identifiersStored: false,
        authOrCookieStored: false
      },
      plan,
      captures,
      comparisons: analysis
    };
  }

  function updateExport() {
    els.exportPreview.value = JSON.stringify(exportObject(), null, 2);
  }

  async function load() {
    try {
      await currentTab();
      const stored = await chrome.storage.local.get([CONFIG_KEY, CAPTURES_KEY]);
      const config = stored[CONFIG_KEY] || { chatModels: [], chatReasoning: [], workModels: [], workReasoning: [] };
      captures = Array.isArray(stored[CAPTURES_KEY]) ? stored[CAPTURES_KEY] : [];
      putConfig(config);
      plan = core.buildScenarioPlan(config);
      const tabState = await send('RS_GET_STATE');
      activeScenario = tabState?.activeScenario || null;
      render();
      setStatus(plan.error ? plan.error : '준비되었습니다. 다음 미캡처 시나리오부터 진행하세요.', plan.error ? 'warn' : 'ok');
    } catch (error) {
      els.tabStatus.textContent = '연결 실패';
      setStatus(error.message || String(error), 'error');
      const stored = await chrome.storage.local.get([CONFIG_KEY, CAPTURES_KEY]);
      const config = stored[CONFIG_KEY] || { chatModels: [], chatReasoning: [], workModels: [], workReasoning: [] };
      captures = Array.isArray(stored[CAPTURES_KEY]) ? stored[CAPTURES_KEY] : [];
      putConfig(config);
      plan = core.buildScenarioPlan(config);
      render();
    }
  }

  els.generate.addEventListener('click', async () => {
    const config = configFromInputs();
    plan = core.buildScenarioPlan(config);
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
    render();
    setStatus(plan.error || `최소 필수 시나리오 ${plan.requiredCount}회를 생성했습니다.`, plan.error ? 'error' : 'ok');
  });

  els.armNext.addEventListener('click', () => {
    const scenario = nextMissingScenario();
    if (scenario) armScenario(scenario);
  });

  els.resetCaptures.addEventListener('click', async () => {
    await chrome.storage.local.set({ [CAPTURES_KEY]: [] });
    captures = [];
    activeScenario = null;
    try { await send('RS_DISARM'); } catch {}
    render();
    setStatus('캡처 결과를 초기화했습니다. 시나리오 설정은 유지됩니다.', 'ok');
  });

  els.copyJson.addEventListener('click', async () => {
    try {
      const text = JSON.stringify(exportObject(), null, 2);
      await navigator.clipboard.writeText(text);
      setStatus('결과 JSON을 복사했습니다. 그대로 ChatGPT에 붙여 넣으면 됩니다.', 'ok');
    } catch (error) {
      setStatus(`복사 실패: ${error?.message || error}`, 'error');
    }
  });

  els.downloadJson.addEventListener('click', () => {
    const text = JSON.stringify(exportObject(), null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chatgpt-request-snapshots-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('결과 JSON 파일 저장을 시작했습니다.', 'ok');
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[CAPTURES_KEY]) return;
    captures = Array.isArray(changes[CAPTURES_KEY].newValue) ? changes[CAPTURES_KEY].newValue : [];
    if (activeScenario && captures.some((item) => item.scenarioId === activeScenario.id)) activeScenario = null;
    render();
  });

  load();
})();
