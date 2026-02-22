"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { AppInput } from "@/domain/types";
import { defaultInput } from "@/domain/defaultInput";
import { prettyJson, validateAppInput } from "@/domain/validate";
import { clearStorage, loadFromStorage, saveToStorage } from "@/lib/storage";

type Toast = { type: "ok" | "ng"; msg: string };

export default function Page() {
  const [input, setInput] = useState<AppInput>(defaultInput);
  const [importText, setImportText] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);

  const currentJson = useMemo(() => prettyJson(input), [input]);

  const show = (t: Toast) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 2200);
  };

  useEffect(() => {
    const stored = loadFromStorage();
    if (!stored) return;
    const r = validateAppInput(stored);
    if (r.ok) {
      setInput(r.value);
      show({ type: "ok", msg: "保存データを読み込みました" });
    }
  }, []);

  const onImport = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      show({ type: "ng", msg: "JSONのパースに失敗しました" });
      return;
    }
    const r = validateAppInput(parsed);
    if (!r.ok) {
      show({ type: "ng", msg: `取り込み失敗: ${r.error}` });
      return;
    }
    setInput(r.value);
    show({ type: "ok", msg: "取り込みOK" });
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentJson);
      show({ type: "ok", msg: "JSONをコピーしました" });
    } catch {
      show({ type: "ng", msg: "コピーに失敗しました（権限/ブラウザ設定を確認）" });
    }
  };

  const onPaste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      setImportText(t);
      show({ type: "ok", msg: "クリップボードを貼り付けました" });
    } catch {
      show({ type: "ng", msg: "貼り付けに失敗しました（権限/ブラウザ設定を確認）" });
    }
  };

  const onSave = () => {
    saveToStorage(input);
    show({ type: "ok", msg: "保存しました" });
  };

  const onLoad = () => {
    const stored = loadFromStorage();
    if (!stored) {
      show({ type: "ng", msg: "保存データがありません" });
      return;
    }
    const r = validateAppInput(stored);
    if (!r.ok) {
      show({ type: "ng", msg: `保存データが壊れています: ${r.error}` });
      return;
    }
    setInput(r.value);
    show({ type: "ok", msg: "読み込みました" });
  };

  const onClear = () => {
    clearStorage();
    show({ type: "ok", msg: "保存データを削除しました" });
  };

  const onReset = () => {
    setInput(defaultInput);
    show({ type: "ok", msg: "defaultに戻しました" });
  };

  const onDownload = () => {
    const blob = new Blob([currentJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gbf_appinput_v1.json";
    a.click();
    URL.revokeObjectURL(url);
    show({ type: "ok", msg: "JSONをダウンロードしました" });
  };

  const canImport = importText.trim().length > 0;

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6 text-slate-900">
      <header className="mb-4">
        <h1 className="text-xl md:text-2xl font-bold">グラブル計算機（受け口）</h1>
        <p className="mt-1 text-sm text-slate-600">
          AppInput(JSON)の取り込み・保存・コピーができる最小UI。拡張は最終的にこのJSONを送るだけに寄せます。
        </p>
      </header>

      {toast && (
        <div
          className={[
            "mb-4 rounded-lg border px-3 py-2 text-sm",
            toast.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900",
          ].join(" ")}
        >
          {toast.msg}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Import */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="font-semibold">JSON取り込み</h2>
            <p className="mt-1 text-xs text-slate-500">左に貼って「取り込む」→右の現在値が更新されます</p>
          </div>

          <div className="p-4">
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                onClick={onPaste}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 active:bg-slate-100"
              >
                クリップボード貼り付け
              </button>
              <button
                onClick={onImport}
                disabled={!canImport}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 active:bg-slate-950 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                取り込む
              </button>
              <button
                onClick={() => setImportText("")}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 active:bg-slate-100"
              >
                クリア
              </button>
            </div>

            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="ここに AppInput JSON を貼り付け"
              className="h-[420px] w-full resize-y rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs leading-5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>
        </div>

        {/* Current */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="font-semibold">現在のAppInput</h2>
            <p className="mt-1 text-xs text-slate-500">コピー/保存で拡張との連携テストができます</p>
          </div>

          <div className="p-4">
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                onClick={onCopy}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 active:bg-slate-950"
              >
                JSONコピー
              </button>
              <button
                onClick={onDownload}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 active:bg-slate-100"
              >
                JSONダウンロード
              </button>
              <button
                onClick={onSave}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 active:bg-slate-100"
              >
                保存(localStorage)
              </button>
              <button
                onClick={onLoad}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 active:bg-slate-100"
              >
                読込(localStorage)
              </button>
              <button
                onClick={onClear}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 active:bg-slate-100"
              >
                保存削除
              </button>
              <button
                onClick={onReset}
                className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 hover:bg-rose-100 active:bg-rose-200"
              >
                defaultへリセット
              </button>
            </div>

            <textarea
              value={currentJson}
              readOnly
              className="h-[420px] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-900 focus:outline-none"
            />
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">次にやること（最短）</h2>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700 space-y-1">
          <li>このAppInputに「ゲーム画面から取れる値」を埋める拡張を作る（まずはコピー出力だけでOK）</li>
          <li>アプリ側は AppInput を分割入力できるフォームUI（ジョブ/基礎ステ/武器/召喚石）を追加</li>
          <li>
            計算コアは <code className="rounded bg-slate-100 px-1">domain/calc.ts</code> みたいに純関数で実装して、UIから呼ぶ
          </li>
        </ul>
      </section>
    </main>
  );
}