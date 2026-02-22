import type { AppInput } from "./types";

type ValidateResult =
  | { ok: true; value: AppInput }
  | { ok: false; error: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

export function validateAppInput(raw: unknown): ValidateResult {
  if (!isObject(raw)) return { ok: false, error: "JSONのルートがオブジェクトではありません" };

  if (raw.version !== 1) {
    return { ok: false, error: "version が 1 ではありません" };
  }

  const game = raw.game;
  const app = raw.app;

  if (!isObject(game)) return { ok: false, error: "game が不正です" };
  if (!isObject(app)) return { ok: false, error: "app が不正です" };

  // base
  const base = game.base;
  if (!isObject(base)) return { ok: false, error: "game.base が不正です" };
  if (!isNumber(base.atk) || !isNumber(base.hp)) {
    return { ok: false, error: "game.base.atk / hp は数値である必要があります" };
  }

  // job
  const job = game.job;
  if (!isObject(job) || !isString(job.id)) {
    return { ok: false, error: "game.job.id が不正です" };
  }

  // characters
  const chars = asArray(game.characters);
  if (!chars) return { ok: false, error: "game.characters が配列ではありません" };

  // weapons
  const weapons = asArray(game.weapons);
  if (!weapons) return { ok: false, error: "game.weapons が配列ではありません" };

  // summons
  const summons = asArray(game.summons);
  if (!summons) return { ok: false, error: "game.summons が配列ではありません" };

  // toggles
  const toggles = app.toggles;
  if (!isObject(toggles) || typeof toggles.ringKewToggle !== "boolean") {
    return { ok: false, error: "app.toggles.ringKewToggle が不正です" };
  }

  // buffs
  const buffs = asArray(app.buffs);
  if (!buffs) return { ok: false, error: "app.buffs が配列ではありません" };

  // abilities
  const abilities = asArray(app.abilities);
  if (!abilities) return { ok: false, error: "app.abilities が配列ではありません" };

  // enemy
  const enemy = app.enemy;
  if (!isObject(enemy)) return { ok: false, error: "app.enemy が不正です" };

  // ここまで通れば、とりあえず AppInput として扱う（厳密型チェックは後で強化）
  return { ok: true, value: raw as AppInput };
}

export function prettyJson(v: unknown): string {
  return JSON.stringify(v, null, 2);
}
