(() => {
  "use strict";

  if (window.__GBF_HOOK_V3__) return;
  window.__GBF_HOOK_V3__ = true;

  function isStartJsonUrl(url) {
    if (!url) return false;
    const s = String(url);
    return s.includes("/rest/raid/start.json") || s.includes("/rest/multiraid/start.json");
  }

  function extractPayload(obj) {
    if (!obj) return null;
    const raidId = obj.twitter?.battle_id ? String(obj.twitter.battle_id) : "";
    if (!raidId) return null;

    const p0 = obj.boss?.param?.[0] || null;
    let bossName = null, hpPercent = null, hpValue = null;

    if (p0) {
      const hp = Number(p0.hp);
      const hpmax = Number(p0.hpmax);
      if (hpmax > 0 && !isNaN(hp) && !isNaN(hpmax)) {
        hpValue = hp;
        hpPercent = Math.round((hp / hpmax * 100) * 10) / 10;
      }
      bossName = p0.name?.ja || p0.name?.en || null;
    }

    const memberCurrent = obj.fellow != null ? Number(obj.fellow) : null;
    const memberMax = obj.limit_number != null ? Number(obj.limit_number) : null;

    // サポーター遷移用：内部レイドID / クエストID
    const raidInternalId = obj.raid_id != null ? String(obj.raid_id) : null;
    const questId = obj.quest_id != null ? String(obj.quest_id) : null;

    return { raidId, bossName, hpPercent, hpValue, memberCurrent, memberMax,
             member_current: memberCurrent, member_max: memberMax,
             raidInternalId, questId };
  }

  function emit(payload) {
    window.postMessage({ __GBF_START_EVENT__: true, tStart: performance.now(), payload }, "*");
  }

  // fetch hook
  const origFetch = window.fetch;
  window.fetch = function patchedFetch(input, init) {
    const url = typeof input === "string" ? input : (input?.url ?? "");
    const p = origFetch.apply(this, arguments);
    if (isStartJsonUrl(url)) {
      p.then((res) => {
        res.clone().json().then((j) => {
          const payload = extractPayload(j);
          if (payload) emit(payload);
        }).catch(() => {});
      }).catch(() => {});
    }
    return p;
  };

  // XHR hook
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__gbf_url__ = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend() {
    if (isStartJsonUrl(this.__gbf_url__)) {
      this.addEventListener("load", () => {
        try {
          const j = JSON.parse(this.responseText);
          const payload = extractPayload(j);
          if (payload) emit(payload);
        } catch (_) {}
      }, { once: true });
    }
    return origSend.apply(this, arguments);
  };
})();
