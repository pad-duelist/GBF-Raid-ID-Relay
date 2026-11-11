(() => {
  "use strict";

  const MARK = "__gbf_fast_sender_installed__";
  if (window[MARK]) return;
  window[MARK] = true;

  function isStartJsonUrl(url) {
    if (!url) return false;
    const s = String(url);
    return s.includes("/rest/multiraid/start.json") || /\/start\.json\b/.test(s);
  }

  function extractFromStartJson(obj) {
    const tw = obj && obj.twitter;
    const battle_id = tw && (tw.battle_id || tw.battleId);
    const raid_id = tw && (tw.raid_id || tw.raidId); // 互換
    const monster = tw && (tw.monster || tw.monster_name || tw.monsterName);
    const id = battle_id || raid_id;
    if (!id) return null;
    return {
      battle_id: battle_id != null ? String(battle_id) : null,
      raid_id: raid_id != null ? String(raid_id) : null,
      monster: monster != null ? String(monster) : null
    };
  }

  function emit(payload) {
    window.postMessage({ __gbf_fast_sender__: true, type: "start_extracted", payload }, "*");
  }

  async function handleResponse(res) {
    try {
      const data = await res.clone().json();
      const extracted = extractFromStartJson(data);
      if (extracted) emit(extracted);
    } catch (_) {}
  }

  const origFetch = window.fetch;
  window.fetch = function patchedFetch(input, init) {
    const url =
      typeof input === "string"
        ? input
        : (input && typeof input.url === "string" ? input.url : "");
    const p = origFetch.apply(this, arguments);
    if (isStartJsonUrl(url)) {
      p.then((res) => handleResponse(res)).catch(() => {});
    }
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__gbf_fast_url__ = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    const url = this.__gbf_fast_url__;
    if (isStartJsonUrl(url)) {
      this.addEventListener("load", () => {
        try {
          const text = this.responseText;
          if (!text) return;
          const data = JSON.parse(text);
          const extracted = extractFromStartJson(data);
          if (extracted) emit(extracted);
        } catch (_) {}
      }, { once: true });
    }
    return origSend.apply(this, arguments);
  };
})();