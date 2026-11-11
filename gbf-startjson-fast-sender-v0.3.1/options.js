(() => {
  "use strict";
  const STORAGE_KEY_USER_ID = "sender_user_id";

  const $uid = document.getElementById("uid");
  const $save = document.getElementById("save");
  const $clear = document.getElementById("clear");
  const $status = document.getElementById("status");

  function setStatus(msg, isErr=false) {
    $status.textContent = msg;
    $status.className = "status" + (isErr ? " err" : "");
    if (msg) setTimeout(() => { if ($status.textContent === msg) $status.textContent = ""; }, 2500);
  }

  function norm(v) {
    const s = String(v ?? "").trim();
    return s ? s : "";
  }

  function load() {
    try {
      chrome.storage.sync.get([STORAGE_KEY_USER_ID], (res) => {
        $uid.value = norm(res?.[STORAGE_KEY_USER_ID]);
      });
    } catch (e) {
      setStatus("読み込み失敗", true);
    }
  }

  function save() {
    const v = norm($uid.value);
    try {
      chrome.storage.sync.set({ [STORAGE_KEY_USER_ID]: v }, () => setStatus("保存しました"));
    } catch (e) {
      setStatus("保存失敗", true);
    }
  }

  function clear() {
    $uid.value = "";
    try {
      chrome.storage.sync.set({ [STORAGE_KEY_USER_ID]: "" }, () => setStatus("クリアしました"));
    } catch (e) {
      setStatus("クリア失敗", true);
    }
  }

  $save.addEventListener("click", save);
  $clear.addEventListener("click", clear);
  load();
})();