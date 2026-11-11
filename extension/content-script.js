// content-script.js (event-driven, 直接fetch + background fallback)
console.log("[GBF Raid] content script loaded");

// --- local config cache ---
const DEFAULT_CFG = {
  apiBaseUrl: "https://gbf-raid-id-relay.vercel.app",
  groupIds: [],
  groupId: "",
  userName: "",
  userId: "",
};
let localCfg = null;

function refreshCfg() {
  chrome.storage.sync.get(DEFAULT_CFG, (items) => { localCfg = items || DEFAULT_CFG; });
}
refreshCfg();
chrome.storage.onChanged.addListener((changes, area) => { if (area === "sync") refreshCfg(); });

function normalizeGroupIds(input) {
  if (Array.isArray(input)) {
    return Array.from(new Set(input.map((s) => String(s ?? "").trim()).filter((s) => s.length > 0)));
  }
  const s = String(input ?? "").trim();
  if (!s) return [];
  return Array.from(new Set(s.split(/[\n,\t ]+/g).map((x) => x.trim()).filter((x) => x.length > 0)));
}

function resolveGroups(cfg) {
  const fromCfg = normalizeGroupIds(cfg.groupIds);
  if (fromCfg.length > 0) return fromCfg;
  const single = normalizeGroupIds(cfg.groupId);
  if (single.length > 0) return single;
  return ["friends1"];
}

// 直接fetch（CORSヘッダー対応済みAPIに送信）
function sendRaidDirect(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
    cache: "no-store",
  }).then((res) => {
    if (!res.ok) {
      return res.text().then((t) => {
        console.error("[GBF Raid][cs] API error", res.status, body.groupId, t);
        throw new Error("api_error:" + res.status);
      });
    }
  });
}

// --- サポーター遷移用：#quest/supporter_raid/{内部ID}/{クエストID}/{末尾} を記憶 ---
// 末尾（例: 1/5/0/7）はクエスト種別ごとに違うため、通過時に覚えてクエストID単位で保存する
const SUPPORTER_RE = /^#quest\/supporter_raid\/(\d+)\/(\d+)\/(\d+(?:\/\d+)*)\/?$/;
const SUFFIX_STORE_KEY = "supporterSuffixByQuest";
let lastSupporter = null; // { raidInternalId, questId, suffix }
let suffixByQuest = {};
try {
  chrome.storage.local.get({ [SUFFIX_STORE_KEY]: {} }, (items) => {
    suffixByQuest = { ...(items?.[SUFFIX_STORE_KEY] || {}), ...suffixByQuest };
  });
} catch (_) {}

function trackSupporterHash() {
  const m = (location.hash || "").match(SUPPORTER_RE);
  if (!m) return;
  lastSupporter = { raidInternalId: m[1], questId: m[2], suffix: m[3] };
  if (suffixByQuest[m[2]] !== m[3]) {
    suffixByQuest[m[2]] = m[3];
    try { chrome.storage.local.set({ [SUFFIX_STORE_KEY]: suffixByQuest }); } catch (_) {}
  }
}

function resolveSupporterInfo(info) {
  const hashMatch = (location.hash || "").match(/^#raid_multi\/(\d+)/);
  const raidInternalId = info.raidInternalId || (hashMatch ? hashMatch[1] : null);
  let questId = info.questId || null;
  let supporterSuffix = null;
  if (lastSupporter && raidInternalId && lastSupporter.raidInternalId === raidInternalId) {
    questId = questId || lastSupporter.questId;
    if (questId === lastSupporter.questId) supporterSuffix = lastSupporter.suffix;
  }
  if (!supporterSuffix && questId) supporterSuffix = suffixByQuest[questId] || null;
  return { raidInternalId, questId, supporterSuffix };
}

// --- dedup ---
const sentIds = new Set();

// --- start.json イベント受信 → 直接fetch（失敗時はbackground fallback） ---
window.addEventListener("message", (ev) => {
  const data = ev?.data;
  if (!data || data.__GBF_START_EVENT__ !== true) return;

  const info = data.payload;
  if (!info?.raidId) return;

  const raidId = String(info.raidId);
  if (sentIds.has(raidId)) return;
  sentIds.add(raidId);

  const tReceived = performance.now();
  const tStart = typeof data.tStart === "number" ? data.tStart : null;
  const dt = tStart != null ? Math.round((tReceived - tStart) * 10) / 10 : null;
  console.log("[GBF Raid][cs] start.json event raidId=", raidId, "dt(ms)=", dt);

  const cfg = localCfg || DEFAULT_CFG;
  const apiBaseUrl = cfg.apiBaseUrl || "https://gbf-raid-id-relay.vercel.app";
  const groups = resolveGroups(cfg);
  const userName = cfg.userName || "extension-user";
  const senderUserId = (cfg.userId || "").trim() || null;

  const supporterInfo = resolveSupporterInfo(info);

  const baseBody = {
    raidId,
    raidInternalId: supporterInfo.raidInternalId,
    questId: supporterInfo.questId,
    supporterSuffix: supporterInfo.supporterSuffix,
    bossName: info.bossName || null,
    battleName: null,
    hpPercent: info.hpPercent ?? null,
    hpValue: info.hpValue ?? null,
    userName,
    senderUserId,
    memberCurrent: info.memberCurrent ?? null,
    memberMax: info.memberMax ?? null,
    member_current: info.memberCurrent ?? null,
    member_max: info.memberMax ?? null,
  };

  const endpoint = `${apiBaseUrl}/api/raids`;
  let allOk = true;
  const sends = groups.map((groupId) =>
    sendRaidDirect(endpoint, { groupId, ...baseBody }).catch(() => { allOk = false; })
  );

  Promise.all(sends).then(() => {
    if (allOk) {
      // burst poll 重複防止通知
      try { chrome.runtime.sendMessage({ type: "GBF_MARK_SENT", raidId }); } catch (_) {}
    } else {
      // 直接fetch失敗 → background経由でリトライ
      console.warn("[GBF Raid][cs] direct fetch failed, retrying via background");
      try { chrome.runtime.sendMessage({ type: "GBF_SEND_RAID", payload: { ...info, ...supporterInfo } }); } catch (_) {}
    }
  });
});

// --- #quest/supporter_raid/ 到達時にAPIをプレウォーム（Vercelコールドスタート対策） ---
function preWarmApi() {
  const h = location.hash || "";
  if (!h.startsWith("#quest/supporter_raid/")) return;
  try {
    chrome.runtime.sendMessage({ type: "GBF_PREWARM" });
  } catch (e) {}
}

// --- hash change 時のバーストポール（フォールバック、イベント失敗時保険） ---
function burstPollOnRaidMulti() {
  const h = location.hash || "";
  if (!h.startsWith("#raid_multi/")) return;

  let tries = 0;
  const maxTries = 20; // 20 * 50ms = 1.0s

  const tick = () => {
    tries++;
    try {
      chrome.runtime.sendMessage({ type: "GBF_POLL_RAID" }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res?.ok && !res?.skipped) return;
        if (tries < maxTries) setTimeout(tick, 50);
      });
    } catch (e) {}
  };
  tick();
}

window.addEventListener("hashchange", () => {
  trackSupporterHash();
  preWarmApi();
  burstPollOnRaidMulti();
});
trackSupporterHash();
preWarmApi();
burstPollOnRaidMulti();

// injected.js は manifest の world:"MAIN" コンテンツスクリプトとして登録済み（CSP 回避・確実）
