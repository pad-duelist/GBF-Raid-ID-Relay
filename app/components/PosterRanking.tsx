// components/PosterRanking.tsx
type Item = {
  user_id: string | null;
  user_id_text: string;
  last_used_name: string | null;
  post_count: number;
  last_post_at: string | null;
};

export default function PosterRanking({ items }: { items: Item[] }) {
  return (
    <ul>
      {items.map((it, i) => {
        // 匿名(user_id が null) の場合は user_id_text ('anonymous') と index を組み合わせて key を一意に
        const key = it.user_id ?? `${it.user_id_text}-${i}`;
        return (
          <li key={key}>
            <strong>{i + 1}.</strong>{" "}
            {it.last_used_name ?? "匿名"} — {it.post_count} 投稿
          </li>
        );
      })}
    </ul>
  );
}
