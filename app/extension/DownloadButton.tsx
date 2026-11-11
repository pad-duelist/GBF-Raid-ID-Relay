"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

// zip内のトップフォルダ名（scripts/pack-extension.py の TOP と合わせる）
const ZIP_TOP_DIR = "gbf-raid-id-relay-extension";

type Preset = {
  userId: string;
  groupIds: string[];
  userName: string;
};

type Props = {
  zipPath: string;
  version: string;
};

export default function DownloadButton({ zipPath, version }: Props) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [checking, setChecking] = useState(true);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ログイン中なら、ユーザーIDと所属グループ（全部）を取得
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!supabase) return;

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        let groupIds: string[] = [];
        try {
          const res = await fetch("/api/profile/groups", {
            headers: { "X-User-Id": user.id },
            cache: "no-store",
          });
          if (res.ok) {
            const data = (await res.json()) as { groups?: { name: string }[] };
            groupIds = Array.from(
              new Set(
                (data.groups ?? [])
                  .map((g) => String(g?.name ?? "").trim())
                  .filter((s) => s.length > 0)
              )
            );
          }
        } catch {}

        const meta = (user.user_metadata ?? {}) as Record<string, any>;
        const userName = String(
          meta.custom_claims?.global_name ?? meta.full_name ?? meta.name ?? ""
        ).trim();

        if (!cancelled) setPreset({ userId: user.id, groupIds, userName });
      } catch {
        // 未ログイン扱い
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const handleDownload = async () => {
    setError(null);
    setBusy(true);
    const filename = `gbf-raid-id-relay-extension-v${version}.zip`;

    try {
      const res = await fetch(zipPath, { cache: "no-store" });
      if (!res.ok) throw new Error(`zipの取得に失敗しました (${res.status})`);
      const base = await res.blob();

      if (!preset) {
        saveBlob(base, filename);
        return;
      }

      // ブラウザ内で defaults.json を差し込む（ユーザーIDはサーバーに送らない）
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(base);
      zip.file(
        `${ZIP_TOP_DIR}/defaults.json`,
        JSON.stringify(
          { userId: preset.userId, groupIds: preset.groupIds, userName: preset.userName },
          null,
          2
        )
      );
      const out = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      saveBlob(out, filename);
    } catch (e: any) {
      console.error("extension download failed", e);
      setError(e?.message ?? "ダウンロードに失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleDownload}
          disabled={busy || checking}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? "準備中…" : "拡張機能をダウンロード（zip）"}
        </button>
        <span className="text-xs text-gray-400">バージョン {version}</span>
      </div>

      {checking ? (
        <p className="text-xs text-gray-400">ログイン状態を確認中…</p>
      ) : preset ? (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs leading-relaxed text-emerald-100">
          <div className="font-semibold">あなた専用の設定を入れた状態でダウンロードします</div>
          <ul className="mt-1 list-disc pl-5 text-emerald-100/90">
            <li>ユーザーID：入力済み</li>
            <li>
              送信先グループ：
              {preset.groupIds.length > 0
                ? `${preset.groupIds.join("、")}（所属グループすべて）`
                : "所属グループなし（あとで手動入力）"}
            </li>
            {preset.userName && <li>表示名：{preset.userName}</li>}
          </ul>
          <div className="mt-1 text-emerald-200/80">
            このzipにはあなたのユーザーIDが入っています。他の人に渡さないでください。
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-400">
          未ログインのため、設定が空のzipをダウンロードします。
          <a href="/login" className="mx-1 underline text-blue-300 hover:text-blue-200">
            ログイン
          </a>
          してからダウンロードすると、ユーザーIDとグループが入力済みになります。
        </p>
      )}

      {error && (
        <p className="text-xs text-red-400">
          {error}{" "}
          <a href={zipPath} download className="underline text-blue-300 hover:text-blue-200">
            設定なしのzipを直接ダウンロード
          </a>
        </p>
      )}
    </div>
  );
}
