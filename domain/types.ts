export type AppInput = {
  version: 1;

  game: {
    job: { id: string; name?: string };
    base: { atk: number; hp: number };

    characters: Array<{
      id: string;
      name?: string;
      base?: { atk?: number; hp?: number };

      ring?: { hasKew: boolean; atk?: number; hp?: number; other?: string };
      earring?: { atk?: number; hp?: number; other?: string };
      awakening?: { type?: string; level?: number };

      af?: Array<{ slot: number; key: string; value?: number | string }>;
    }>;

    weapons: Array<{
      slot: number; // 1-10
      id: string;
      name?: string;

      skill: Array<{ id: string; name?: string; lv?: number }>;
      plus?: number;
      level?: number;
      awaken?: { type?: string; lv?: number };
    }>;

    summons: Array<{
      slot: "main" | "friend" | "sub1" | "sub2" | "sub3" | "sub4";
      id: string;
      name?: string;
      level?: number;
      plus?: number;
    }>;
  };

  app: {
    abilities: Array<{ id: string; name?: string; on: boolean }>;
    buffs: Array<{ key: string; value: number; source?: string }>;

    enemy: {
      element?: string;
      defense?: number;
      mode?: string;
      special?: Array<{ key: string; value: number }>;
    };

    toggles: {
      ringKewToggle: boolean;
    };
  };
};
