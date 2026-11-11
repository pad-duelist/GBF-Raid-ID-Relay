import type { Metadata } from "next";
import Link from "next/link";
import manifest from "@/extension/manifest.json";
import DownloadButton from "./DownloadButton";

export const metadata: Metadata = {
  title: "拡張機能のダウンロード | GBF Raid ID Relay",
};

// public/downloads に置いた配布用zip（scripts/pack-extension.py で作成）
const ZIP_PATH = "/downloads/gbf-raid-id-relay-extension.zip";

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "zipをダウンロードして解凍する",
    body: (
      <>
        上のボタンからzipを保存し、解凍します。解凍してできた
        <code className="mx-1 rounded bg-gray-800 px-1">gbf-raid-id-relay-extension</code>
        フォルダは、削除しない場所に置いてください。
      </>
    ),
  },
  {
    title: "Chromeの拡張機能ページを開く",
    body: (
      <>
        アドレスバーに
        <code className="mx-1 rounded bg-gray-800 px-1">chrome://extensions</code>
        と入力して開き、右上の「デベロッパー モード」をオンにします。
      </>
    ),
  },
  {
    title: "解凍したフォルダを読み込む",
    body: (
      <>
        「パッケージ化されていない拡張機能を読み込む」を押し、手順1のフォルダを選びます。
      </>
    ),
  },
  {
    title: "ユーザーIDとグループを設定する",
    body: (
      <>
        拡張機能のオプション画面を開き、
        <Link href="/extension-token" className="mx-1 underline text-blue-300 hover:text-blue-200">
          ユーザーIDのページ
        </Link>
        でコピーしたユーザーIDと、送信先のグループ名を入力して保存します。
        ログインした状態でダウンロードしたzipなら、最初から入力済みなのでこの手順は不要です。
      </>
    ),
  },
];

export default function ExtensionDownloadPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-8 space-y-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-white">拡張機能のダウンロード</h1>
        <Link
          href="/extension-token"
          className="rounded border border-gray-500 px-3 py-1 text-xs text-gray-200 hover:bg-gray-700 whitespace-nowrap"
        >
          ユーザーIDのページへ
        </Link>
      </div>

      <section className="space-y-3">
        <p className="text-sm text-gray-300">
          グラブルの参戦IDを GBF Raid ID Relay に自動送信する Chrome 拡張機能です。
        </p>
        <DownloadButton zipPath={ZIP_PATH} version={manifest.version} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">インストール手順</h2>
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm"
            >
              <div className="font-semibold text-gray-100">
                {i + 1}. {s.title}
              </div>
              <div className="mt-1 text-xs leading-relaxed text-gray-300">{s.body}</div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-white">更新するとき</h2>
        <p className="text-xs leading-relaxed text-gray-300">
          新しいzipを解凍して同じフォルダに上書きし、
          <code className="mx-1 rounded bg-gray-800 px-1">chrome://extensions</code>
          で拡張機能の更新（再読み込み）ボタンを押してください。設定はそのまま残ります。
        </p>
      </section>
    </div>
  );
}
