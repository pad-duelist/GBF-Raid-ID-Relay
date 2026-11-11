console.log("[GBF Raid] background loaded (multi-group userId mode)");
// --- config cache (avoid storage.sync.get on every send) ---
let cfgCache = null;
let cfgCacheLoaded = false;

function getSyncConfigRaw() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        apiBaseUrl: "https://gbf-raid-id-relay.vercel.app",
        groupIds: [],
        groupId: "",
        userName: "",
        userId: "",
      },
      (items) => resolve(items || {})
    );
  });
}

async function getSyncConfigCached() {
  if (cfgCacheLoaded && cfgCache) return cfgCache;
  cfgCache = await getSyncConfigRaw();
  cfgCacheLoaded = true;
  return cfgCache;
}

// SW起動時に即キャッシュを温める（最初のイベント時のストレージ待ちを排除）
getSyncConfigRaw().then((cfg) => {
  cfgCache = cfg;
  cfgCacheLoaded = true;
});

if (chrome.storage && chrome.storage.onChanged && chrome.storage.sync) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    // 変更があれば即再取得してキャッシュを更新
    getSyncConfigRaw().then((cfg) => {
      cfgCache = cfg;
      cfgCacheLoaded = true;
    });
  });
}

// --- per-tab tracking ---
const startHookInstalledByTab = {};
const lastSentByTab = {}; // tabId -> { raidId: string, ts: number }
const inflightByTab = {};

// 文字列/配列どちらでも受けて、["a","b"] に正規化
function normalizeGroupIds(input) {
  if (Array.isArray(input)) {
    return Array.from(
      new Set(
        input
          .map((s) => String(s ?? "").trim())
          .filter((s) => s.length > 0)
      )
    );
  }
  const s = String(input ?? "").trim();
  if (!s) return [];
  // カンマ/改行/タブ/スペース区切りを許容
  return Array.from(
    new Set(
      s
        .split(/[\n,\t ]+/g)
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
    )
  );
}

// payload -> API（複数groupIdに送る）
async function postRaidToApi(payload) {
  try {
    const cfg = await getSyncConfigCached();
    const apiBaseUrl = cfg.apiBaseUrl || "https://gbf-raid-id-relay.vercel.app";

          // ✅ 送信先グループ一覧（優先順位: payload.groupIds > cfg.groupIds > payload.groupId/cfg.groupId）
    const fromPayload = normalizeGroupIds(payload.groupIds);
    const fromCfg = normalizeGroupIds(cfg.groupIds);

    const fallbackSingle =
      normalizeGroupIds(payload.groupId).length > 0
        ? normalizeGroupIds(payload.groupId)
        : normalizeGroupIds(cfg.groupId);

    let groupList =
      fromPayload.length > 0
        ? fromPayload
        : fromCfg.length > 0
        ? fromCfg
        : fallbackSingle;

    // 何も設定がなければ従来通り friends1
    if (!groupList || groupList.length === 0) groupList = ["friends1"];

    const userName = payload.userName || cfg.userName || "extension-user";
    const senderUserId = (cfg.userId || "").trim() || null;

    // payload から参戦者数を取り出す（null でも送る）
    const memberCurrent = payload.memberCurrent ?? payload.member_current ?? null;
    const memberMax = payload.memberMax ?? payload.member_max ?? null;

    // 共通body（groupIdだけ差し替える）
    const baseBody = {
      raidId: payload.raidId,
      // サポーター遷移用（無ければ null）
      raidInternalId: payload.raidInternalId || null,
      questId: payload.questId || null,
      supporterSuffix: payload.supporterSuffix || null,
      bossName: payload.bossName || null,
      battleName: payload.battleName || null,
      hpPercent: typeof payload.hpPercent === "number" ? payload.hpPercent : null,
      hpValue: typeof payload.hpValue === "number" ? payload.hpValue : null,
      userName,
      senderUserId,
      // 参戦者数は両方のキーを入れて冗長に渡す（API側でどちらでも拾えるように）
      memberCurrent: typeof memberCurrent === "number" ? memberCurrent : null,
      member_max: typeof memberMax === "number" ? memberMax : null,
      member_current: typeof memberCurrent === "number" ? memberCurrent : null,
      memberMax: typeof memberMax === "number" ? memberMax : null,
    };

    console.log("[GBF Raid] groups =", groupList);

    // ✅ 全グループへ送信（並列）
    const results = await Promise.allSettled(
      groupList.map(async (groupId) => {
        const body = { groupId, ...baseBody };
        console.log("[GBF Raid] POST", apiBaseUrl + "/api/raids", body);
        const res = await fetch(`${apiBaseUrl}/api/raids`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text();
          console.error("[GBF Raid] API error group=" + groupId, res.status, text);
          throw new Error("API error: " + groupId);
        }
        return true;
      })
    );

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) throw new Error("Some groups failed: " + failed.length);
    return true;
  } catch (e) {
    console.error("[GBF Raid] postRaidToApi error", e);
    throw e;
  }
}

// バトル画面（MAIN world）の stage から ID・敵名・HP・参戦者数 を取得
function mainWorldExtractor() {
  try {
    // @ts-ignore
    const st = window.stage ?? null;
    if (!st || !st.pJsnData) return null;
    // @ts-ignore
    const t = st.pJsnData;

    const raidId =
      t.twitter && t.twitter.battle_id ? String(t.twitter.battle_id) : "";
    if (!raidId) return null;

    const bossParam = t.boss && t.boss.param ? t.boss.param : null;
    let bossName = null;
    let hpPercent = null;
    let hpValue = null;

    if (bossParam) {
      for (const key in bossParam) {
        if (!Object.prototype.hasOwnProperty.call(bossParam, key)) continue;
        const b = bossParam[key];
        if (!b) continue;

        const hp = parseInt(b.hp, 10);
        const hpmax = parseInt(b.hpmax, 10);
        if (!hpmax || isNaN(hp) || isNaN(hpmax)) continue;

        bossName = b.monster || null;
        hpValue = hp;

        const pctRaw = (hp / hpmax) * 100;
        hpPercent = Math.round(pctRaw * 10) / 10;

        break;
      }
    }

    // 参戦者数取得
    let memberCurrent = null;
    let memberMax = null;

    try {
      const info = t.multi_raid_member_info;
      if (Array.isArray(info)) {
        memberCurrent = info.length;
      } else if (
        typeof info === "object" &&
        info !== null &&
        typeof info.length === "number"
      ) {
        memberCurrent = Number(info.length);
      }

      const limit = t.limit_number ?? t.pJsnData?.limit_number ?? null;
      if (typeof limit === "number") {
        memberMax = limit;
      } else if (typeof limit === "string" && limit.trim() !== "") {
        const n = Number(limit);
        if (!isNaN(n)) memberMax = n;
      } else if (typeof t.limit_number === "number") {
        memberMax = t.limit_number;
      }
    } catch (e) {
      memberCurrent = null;
      memberMax = null;
    }

    return {
      raidId,
      raidInternalId: t.raid_id != null ? String(t.raid_id) : null,
      questId: t.quest_id != null ? String(t.quest_id) : null,
      bossName,
      battleName: null,
      hpPercent,
      hpValue,
      memberCurrent,
      member_max: memberMax,
      member_current: memberCurrent,
      memberMax,
    };
  } catch (e) {
    return null;
  }
}
// CSP等でscriptタグ注入が失敗した場合のフォールバック用フックインストーラ
function installStartJsonHook() {
  try {
    if (window.__GBF_HOOK_V3__) return true;
    window.__GBF_HOOK_V3__ = true;

    function isStartJsonUrl(url) {
      if (!url) return false;
      const s = String(url);
      return s.includes("/rest/raid/start.json") || s.includes("/rest/multiraid/start.json");
    }
    function extractAndEmit(obj) {
      if (!obj) return;
      const raidId = obj.twitter?.battle_id ? String(obj.twitter.battle_id) : "";
      if (!raidId) return;
      const p0 = obj.boss?.param?.[0] || null;
      let bossName = null, hpPercent = null, hpValue = null;
      if (p0) {
        const hp = Number(p0.hp), hpmax = Number(p0.hpmax);
        if (hpmax > 0 && !isNaN(hp) && !isNaN(hpmax)) { hpValue = hp; hpPercent = Math.round(hp / hpmax * 1000) / 10; }
        bossName = p0.name?.ja || p0.name?.en || null;
      }
      const memberCurrent = obj.fellow != null ? Number(obj.fellow) : null;
      const memberMax = obj.limit_number != null ? Number(obj.limit_number) : null;
      window.postMessage({ __GBF_START_EVENT__: true, tStart: performance.now(),
        payload: { raidId, bossName, hpPercent, hpValue, memberCurrent, memberMax,
                   member_current: memberCurrent, member_max: memberMax,
                   raidInternalId: obj.raid_id != null ? String(obj.raid_id) : null,
                   questId: obj.quest_id != null ? String(obj.quest_id) : null } }, "*");
    }
    const origFetch = window.fetch;
    window.fetch = function(input, init) {
      const url = typeof input === "string" ? input : (input?.url ?? "");
      const p = origFetch.apply(this, arguments);
      if (isStartJsonUrl(url)) p.then(r => r.clone().json().then(extractAndEmit).catch(()=>{})).catch(()=>{});
      return p;
    };
    const origOpen = XMLHttpRequest.prototype.open, origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(m, url) { this.__gbf_url__ = url; return origOpen.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function() {
      if (isStartJsonUrl(this.__gbf_url__)) this.addEventListener("load", () => {
        try { extractAndEmit(JSON.parse(this.responseText)); } catch(_) {}
      }, { once: true });
      return origSend.apply(this, arguments);
    };
    return true;
  } catch(e) { return false; }
}

// メッセージ受信（content-script → background）

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // CSP フォールバック: scriptタグ注入失敗時に executeScript でフックをインストール
  if (msg && msg.type === "GBF_INSTALL_START_HOOK" && sender.tab && sender.tab.id != null) {
    const tabId = sender.tab.id;
    if (startHookInstalledByTab[tabId]) { sendResponse && sendResponse({ ok: true }); return; }
    startHookInstalledByTab[tabId] = true;
    chrome.scripting.executeScript({ target: { tabId }, func: installStartJsonHook, world: "MAIN" }, () => {
      if (chrome.runtime.lastError) { console.warn("[GBF Raid] install hook error", chrome.runtime.lastError); }
      sendResponse && sendResponse({ ok: !chrome.runtime.lastError });
    });
    return true;
  }

  // start.json イベント → content-script から転送されてきた参戦ID送信
  if (msg && msg.type === "GBF_SEND_RAID" && sender.tab && sender.tab.id != null) {
    const tabId = sender.tab.id;
    const info = msg.payload;
    if (!info?.raidId) { sendResponse && sendResponse({ ok: false, reason: "no_raidId" }); return; }
    const raidId = String(info.raidId);

    // burst poll との重複防止
    if (lastSentByTab[tabId]?.raidId === raidId) {
      sendResponse && sendResponse({ ok: true, skipped: true });
      return;
    }
    lastSentByTab[tabId] = { raidId, ts: Date.now() };

    postRaidToApi(info)
      .then(() => sendResponse && sendResponse({ ok: true }))
      .catch((e) => {
        console.error("[GBF Raid][bg] GBF_SEND_RAID error", e);
        sendResponse && sendResponse({ ok: false, error: String(e) });
      });
    return true; // async
  }

  // プレウォーム
  if (msg && msg.type === "GBF_PREWARM") {
    getSyncConfigCached().then((cfg) => {
      const apiBaseUrl = cfg.apiBaseUrl || "https://gbf-raid-id-relay.vercel.app";
      fetch(`${apiBaseUrl}/api/raids?groupId=_warm&userId=_warm`, {
        credentials: "omit",
        cache: "no-store",
      }).catch(() => {});
    });
    return;
  }

  // content-script が fetch で送信済みを通知 → burst poll 重複防止
  if (msg && msg.type === "GBF_MARK_SENT" && sender.tab && sender.tab.id != null) {
    const tabId = sender.tab.id;
    const raidId = String(msg.raidId || "");
    if (raidId) {
      lastSentByTab[tabId] = { raidId, ts: Date.now() };
      inflightByTab[tabId] = null;
    }
    return;
  }

  if (msg.type === "GBF_POLL_RAID" && sender.tab && sender.tab.id != null) {
    const tabId = sender.tab.id;

    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: mainWorldExtractor,
        world: "MAIN",
      },
      (results) => {
        if (chrome.runtime.lastError) {
          console.error(
            "[GBF Raid] executeScript error",
            chrome.runtime.lastError
          );
          sendResponse({ ok: false });
          return;
        }
        if (!results || !results.length) {
          sendResponse({ ok: false });
          return;
        }
        const info = results[0].result;
        if (!info || !info.raidId) {
          sendResponse({ ok: false });
          return;
        }

        const last = lastSentByTab[tabId];
        if (inflightByTab[tabId] === info.raidId) {
          sendResponse({ ok: true, skipped: true, reason: "inflight" });
          return;
        }
        if (last && last.raidId === info.raidId) {
          sendResponse({ ok: true, skipped: true });
          return;
        }
        lastSentByTab[tabId] = { raidId: info.raidId, ts: Date.now() };

        console.log("[GBF Raid][bg] auto detected (poll)", info);

        postRaidToApi(info)
          .then(() => sendResponse({ ok: true }))
          .catch((e) => {
            console.error("[GBF Raid] auto post error", e);
            sendResponse({ ok: false });
          });
      }
    );
    return true; // async
  }
});