import { parseCsv } from "@/lib/csv";

export type WeaponMasterRow = {
  id: string;      // internal key (fallback: slug(name))
  name: string;    // s
  iconUrl: string; // m (small square)
  mainUrl: string; // ls (main-hand portrait). fallback: iconUrl
};

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    // keep alnum, underscore, hyphen, and common JP ranges
    .replace(/[^\w\u3000-\u30FF\u4E00-\u9FFF-]/g, "");
}

export function weaponsFromCsv(csvText: string): WeaponMasterRow[] {
  const table = parseCsv(csvText);
  if (table.length < 2) return [];

  const header = table[0].map((h) => (h ?? "").trim());
  const idxM = header.indexOf("m");
  const idxS = header.indexOf("s");
  const idxLS = header.indexOf("ls");

  if (idxM === -1 || idxS === -1 || idxLS === -1) return [];

  const out: WeaponMasterRow[] = [];

  for (const r of table.slice(1)) {
    const name = (r[idxS] ?? "").trim();
    const iconUrlRaw = (r[idxM] ?? "").trim();
    const mainUrlRaw = (r[idxLS] ?? "").trim();

    if (!name) continue;
    if (!iconUrlRaw && !mainUrlRaw) continue;

    const iconUrl = iconUrlRaw || mainUrlRaw;
    const mainUrl = mainUrlRaw || iconUrl;

    out.push({
      id: slugify(name),
      name,
      iconUrl,
      mainUrl,
    });
  }

  return out;
}
