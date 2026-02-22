import type { AppInput } from "./types";

export const defaultInput: AppInput = {
  version: 1,
  game: {
    job: { id: "unknown", name: "" },
    base: { atk: 0, hp: 0 },

    characters: [
      { id: "ch1", name: "", ring: { hasKew: false } },
      { id: "ch2", name: "", ring: { hasKew: false } },
      { id: "ch3", name: "", ring: { hasKew: false } },
      { id: "ch4", name: "", ring: { hasKew: false } },
    ],

    weapons: Array.from({ length: 10 }, (_, i) => ({
      slot: i + 1,
      id: `wep${i + 1}`,
      name: "",
      skill: [],
      plus: 0,
      level: undefined,
      awaken: undefined,
    })),

    summons: [
      { slot: "main", id: "sum_main", name: "", level: undefined, plus: 0 },
      { slot: "friend", id: "sum_friend", name: "", level: undefined, plus: 0 },
      { slot: "sub1", id: "sum_sub1", name: "", level: undefined, plus: 0 },
      { slot: "sub2", id: "sum_sub2", name: "", level: undefined, plus: 0 },
      { slot: "sub3", id: "sum_sub3", name: "", level: undefined, plus: 0 },
      { slot: "sub4", id: "sum_sub4", name: "", level: undefined, plus: 0 },
    ],
  },

  app: {
    abilities: [],
    buffs: [],
    enemy: { element: undefined, defense: undefined, mode: undefined, special: [] },
    toggles: {
      ringKewToggle: true,
    },
  },
};
