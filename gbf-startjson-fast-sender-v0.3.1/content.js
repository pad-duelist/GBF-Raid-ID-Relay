(() => {
  "use strict";

  const ENDPOINT = "https://gbf-raid-id-relay.vercel.app/api/fast";
  const GROUP_KEY = "duo";
  const DEBUG = true;
  const STORAGE_KEY_USER_ID = "sender_user_id";

  const SENT_KEY = "__gbf_fast_sent_ids__";
  const sent = new Set();

  function log(...args) { if (DEBUG) console.log("[GBF FastSender]", ...args); }
  function warn(...args) { if (DEBUG) console.warn("[GBF FastSender]", ...args); }

  try {
    const raw = sessionStorage.getItem(SENT_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) arr.forEach((id) => sent.add(String(id)));
    }
  } catch (_) {}

  function persistSent() {
    try {
      const arr = Array.from(sent).slice(-200);
      sessionStorage.setItem(SENT_KEY, JSON.stringify(arr));
    } catch (_) {}
  }

  let cachedUserId = null;
  try {
    chrome.storage.sync.get([STORAGE_KEY_USER_ID], (res) => {
      cachedUserId = String(res?.[STORAGE_KEY_USER_ID] ?? "").trim() || null;
      log("loaded sender_user_id:", cachedUserId);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if (changes[STORAGE_KEY_USER_ID]) {
        cachedUserId = String(changes[STORAGE_KEY_USER_ID].newValue ?? "").trim() || null;
        log("sender_user_id updated:", cachedUserId);
      }
    });
  } catch (e) {
    warn("storage init failed:", e);
  }

  function sendFast({ battle_id, monster, raid_id }) {
    // battle_id 優先（参戦ID）
    const id = battle_id || raid_id;
    if (!id) return;

    if (sent.has(id)) {
      log("skip duplicate:", id);
      return;
    }
    sent.add(id);
    persistSent();

    const body = {
      group_key: GROUP_KEY,
      battle_id: String(id),
      monster: monster != null ? String(monster) : null,
      sender_user_id: cachedUserId
    };

    log("send body:", body);

    try {
      const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
      const ok = navigator.sendBeacon(ENDPOINT, blob);
      log("sendBeacon result:", ok);
      if (ok) return;
    } catch (e) {
      warn("sendBeacon threw:", e);
    }

    try {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
        credentials: "omit",
        cache: "no-store",
        mode: "cors"
      })
        .then((r) => log("fetch fallback status:", r.status))
        .catch((e) => warn("fetch fallback error:", e));
    } catch (e) {
      warn("fetch fallback threw:", e);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__gbf_fast_sender__ !== true) return;
    if (data.type === "start_extracted") {
      log("received extracted:", data.payload);
      sendFast(data.payload || {});
    }
  });

  try {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("injected.js");
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
    log("injected.js added");
  } catch (e) {
    warn("inject failed:", e);
  }

  log("installed v0.3.1");
})();