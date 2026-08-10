(() => {
  'use strict';

  const pathKey = (path) => JSON.stringify(path);

  function leafMap(sample) {
    const map = new Map();
    for (const leaf of sample?.leaves || []) {
      if (!Array.isArray(leaf.path) || leaf.path.length === 0) continue;
      map.set(pathKey(leaf.path), { path: leaf.path, value: leaf.value });
    }
    return map;
  }

  function stableLeaves(samples) {
    if (!Array.isArray(samples) || samples.length === 0) return new Map();
    const maps = samples.map(leafMap);
    const stable = new Map();
    for (const [key, first] of maps[0]) {
      if (maps.every((map) => map.has(key) && Object.is(map.get(key).value, first.value))) {
        stable.set(key, first);
      }
    }
    return stable;
  }

  function absentFromAll(samples, key) {
    return samples.every((sample) => !leafMap(sample).has(key));
  }

  function stableEndpoint(samples) {
    if (!samples?.length) return null;
    const first = samples[0]?.pathname || null;
    return first && samples.every((sample) => sample.pathname === first) ? first : null;
  }

  function buildTargetOps(targetSamples, otherSamples) {
    const target = stableLeaves(targetSamples);
    const other = stableLeaves(otherSamples);
    const ops = [];

    for (const [key, leaf] of target) {
      const previous = other.get(key);
      if (!previous || !Object.is(previous.value, leaf.value)) {
        ops.push({ op: 'set', path: leaf.path, value: leaf.value });
      }
    }

    for (const [key, leaf] of other) {
      if (!target.has(key) && absentFromAll(targetSamples, key)) {
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
      version: 1,
      chat: { endpoint: chatEndpoint, differencesFromWork: chatOps },
      work: { endpoint: workEndpoint, differencesFromChat: workOps },
      discriminatorCount: Math.max(chatOps.length, workOps.length),
      endpointDiffers: Boolean(chatEndpoint && workEndpoint && chatEndpoint !== workEndpoint),
      confidence: chatSamples.length >= 2 && workSamples.length >= 2 ? 'high' : 'provisional'
    };
  }

  globalThis.ChatWorkProfileCore = { stableLeaves, buildComparison };
})();
