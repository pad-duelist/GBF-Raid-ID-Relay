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
  return Array.from(
    new Set(
      s
        .split(/[\n,\t ]+/g)
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
    )
  );
}

document.addEventListener("DOMContentLoaded", () => {
  const apiBaseUrlInput = document.getElementById("apiBaseUrl");
  const groupIdsInput = document.getElementById("groupIds");
  const userNameInput = document.getElementById("userName");
  const userIdInput = document.getElementById("userId");
  const saveButton = document.getElementById("save");
  const status = document.getElementById("status");

  chrome.storage.sync.get(
    {
      apiBaseUrl: "https://gbf-raid-id-relay.vercel.app",
      // 新: groupIds（配列 or 文字列）
      groupIds: [],
      // 旧: groupId（単体）
      groupId: "",
      userName: "",
      userId: "",
    },
    (items) => {
      apiBaseUrlInput.value =
        items.apiBaseUrl || "https://gbf-raid-id-relay.vercel.app";

      const list =
        normalizeGroupIds(items.groupIds).length > 0
          ? normalizeGroupIds(items.groupIds)
          : normalizeGroupIds(items.groupId);

      groupIdsInput.value = list.join("\n");
      userNameInput.value = items.userName || "";
      userIdInput.value = items.userId || "";
    }
  );

  saveButton.addEventListener("click", () => {
    const apiBaseUrl =
      apiBaseUrlInput.value.trim() || "https://gbf-raid-id-relay.vercel.app";
    const groupIdsRaw = groupIdsInput.value;
    const groupIds = normalizeGroupIds(groupIdsRaw);

    // 後方互換: 旧キー groupId も一応埋める（先頭の1つ）
    const groupId = groupIds[0] || "";

    const userName = userNameInput.value.trim();
    const userId = userIdInput.value.trim();

    chrome.storage.sync.set(
      { apiBaseUrl, groupIds, groupId, userName, userId },
      () => {
        status.textContent = "保存しました。";
        setTimeout(() => {
          status.textContent = "";
        }, 2000);
      }
    );
  });
});
