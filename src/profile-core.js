(() => {
  'use strict';

  const pathKey = (path) => JSON.stringify(path);
  const CONTROL_PATHS = new Set([
    '["model"]',
    '["conversation_origin"]',
    '["thinking_effort"]',
    '["service_tier"]',
    '["conversation_mode","kind"]',
    '["force_parallel_switch"]',
    '["paragen_cot_summary_display_override"]',
    '["enable_message_followups"]',
    '["supports_buffering"]',
    '["client_prepare_state"]'
  ]);

  function leafMap(sample, controlOnly = false) {
    const map = new Map();
    for (const leaf of sample?.leaves || []) {
      if (!Array.isArray(leaf.path) || leaf.path.length === 0) continue;
      const key = pathKey(leaf.path);
      if (controlOnly && !CONTROL_PATHS.has(key)) continue;
      map.set(key, { path: leaf.path, value: leaf.value });
    }
    return map;
  }

  function stableLeaves(samples, controlOnly = false) {
    if (!Array.isArray(samples) || samples.length === 0) return new Map();
    const maps = samples.map((sample) => leafMap(sample, controlOnly));
    const stable = new Map();
    for (const [key, first] of maps[0]) {
      if (maps.every((map) => map.has(key) && Object.is(map.get(key).value, first.value))) {
        stable.set(key, first);
      }
    }
    return stable;
  }

  function absentFromAll(samples, key, controlOnly = false) {
    return samples.every((sample) => !leafMap(sample, controlOnly).has(key));
  }

  function stableEndpoint(samples) {
    if (!samples?.length) return null;
    const first = samples[0]?.pathname || null;
    return first && samples.every((sample) => sample.pathname === first) ? first : null;
  }

  function buildTargetOps(targetSamples, otherSamples) {
    const target = stableLeaves(targetSamples, true);
    const other = stableLeaves(otherSamples, true);
    const ops = [];

    for (const [key, leaf] of target) {
      const previous = other.get(key);
      if (!previous || !Object.is(previous.value, leaf.value)) {
        ops.push({ op: 'set', path: leaf.path, value: leaf.value });
      }
    }

    for (const [key, leaf] of other) {
      if (!target.has(key) && absentFromAll(targetSamples, key, true)) {
        ops.push({ op: 'remove', path: leaf.path });
      }
    }

    return ops;
  }

  function buildComparison(chatSamples, workSamples) {
    if (!chatSamples?.length || !workSamples?.length) return null;
    const chatEndpoint = stableEndpoint(chatSamples);
    const workEndpoint = stableEndpoint(workSamples);
    const chatOps = buildTargetOps(chatSamples, workSamples);
    const workOps = buildTargetOps(workSamples, chatSamples);
    return {
      version: 2,
      chat: { endpoint: chatEndpoint, differencesFromWork: chatOps },
      work: { endpoint: workEndpoint, differencesFromChat: workOps },
      discriminatorCount: Math.max(chatOps.length, workOps.length),
      endpointDiffers: Boolean(chatEndpoint && workEndpoint && chatEndpoint !== workEndpoint),
      confidence: chatSamples.length >= 2 && workSamples.length >= 2 ? 'high' : 'provisional'
    };
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getAtPath(root, path) {
    let cursor = root;
    for (const key of path || []) {
      if (!cursor || typeof cursor !== 'object' || !(key in cursor)) return { exists: false, value: undefined };
      cursor = cursor[key];
    }
    return { exists: true, value: cursor };
  }

  function setAtPath(root, path, value) {
    if (!Array.isArray(path) || path.length === 0) return false;
    let cursor = root;
    for (let i = 0; i < path.length - 1; i += 1) {
      const key = path[i];
      if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) cursor[key] = {};
      cursor = cursor[key];
    }
    cursor[path[path.length - 1]] = value;
    return true;
  }

  function removeAtPath(root, path) {
    if (!Array.isArray(path) || path.length === 0) return false;
    let cursor = root;
    for (let i = 0; i < path.length - 1; i += 1) {
      const key = path[i];
      if (!cursor || typeof cursor !== 'object' || !(key in cursor)) return false;
      cursor = cursor[key];
    }
    if (!cursor || typeof cursor !== 'object') return false;
    const key = path[path.length - 1];
    if (!(key in cursor)) return false;
    delete cursor[key];
    return true;
  }

  function applyOps(body, ops) {
    const next = cloneJson(body);
    let applied = 0;
    for (const op of ops || []) {
      if (!Array.isArray(op?.path) || op.path.length === 0) continue;
      if (op.op === 'set') {
        const current = getAtPath(next, op.path);
        if (!current.exists || !Object.is(current.value, op.value)) {
          if (setAtPath(next, op.path, op.value)) applied += 1;
        }
      } else if (op.op === 'remove') {
        if (removeAtPath(next, op.path)) applied += 1;
      }
    }
    return { value: next, applied };
  }

  function matchesOps(body, ops) {
    for (const op of ops || []) {
      const current = getAtPath(body, op.path);
      if (op.op === 'set' && (!current.exists || !Object.is(current.value, op.value))) return false;
      if (op.op === 'remove' && current.exists) return false;
    }
    return true;
  }

  globalThis.ChatWorkProfileCore = {
    stableLeaves,
    buildComparison,
    applyOps,
    matchesOps,
    controlPaths: [...CONTROL_PATHS]
  };
})();
