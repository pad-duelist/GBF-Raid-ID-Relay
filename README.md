# GBF Raid ID Viewer

グラブル参戦ID共有用の簡易ビューアです。

## セットアップ

```bash
npm install
cp .env.local.example .env.local
# .env.local を編集して Supabase の URL / Service Role Key を設定
npm run dev
```

- `http://localhost:3000/` : トップ（グループID入力）
- `http://localhost:3000/g/friends1` : グループ `friends1` の参戦ID一覧
