// lib/bossNormalizer.ts
export function toHalfwidthAndLower(s: string) {
  return s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
export function removeCommonNoise(s: string) {
  let out = s.replace(/\(.*?\)|（.*?）/g, "");
  out = out.replace(/(no\.?\s?\d+|\#\d+|\d+番?)$/i, "");
  out = out.replace(/[\/:;「」『』"“”'’‘、。,・\-\—]/g, "");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}
export function normalizeKey(raw: string) {
  return removeCommonNoise(toHalfwidthAndLower(raw || ""));
}

/**
 * createBossNameNormalizer(map, sortedKeys)
 * - map: { normalizedKey: afterName, ... }
 * - sortedKeys: [normalizedKey...], 長いキー順に並んでいることを推奨
 */
export function createBossNameNormalizer(map: Record<string, string>, sortedKeys?: string[]) {
  const m = new Map<string, string>(Object.entries(map));
  const keys = (sortedKeys && sortedKeys.length > 0) ? sortedKeys : Array.from(m.keys()).sort((a, b) => b.length - a.length);

  return function normalizeBossName(raw: string): string {
    if (!raw) return raw;
    const key = normalizeKey(raw);

    // 完全一致優先
    if (m.has(key)) return m.get(key)!;

    // 長いキー順に部分一致チェック（誤判定が怖ければここを削除）
    for (const k of keys) {
      if (k && key.includes(k)) return m.get(k)!;
    }

    // マップに見つからなければトリムした元文字列を返す（または key を返す方針も可）
    return raw.trim();
  };
}
