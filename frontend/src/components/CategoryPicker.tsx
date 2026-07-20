import type { DiscordChannel } from "../types";

/** Множественный выбор категорий сервера — проект владеет одной или несколькими. */
export function CategoryPicker({
  channels,
  selected,
  onChange,
  loading,
  error,
}: {
  channels: DiscordChannel[];
  selected: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  error?: string | null;
}) {
  const categories = channels.filter((c) => c.type === "category");

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  if (loading) return <p className="muted">Загружаю категории сервера…</p>;
  if (error) return <div className="error">{error}</div>;
  if (categories.length === 0)
    return <p className="muted">На сервере нет категорий — создайте их в Discord.</p>;

  // Сколько каналов внутри — чтобы мастер понимал, что заберёт вместе с категорией.
  const countIn = (id: string) =>
    channels.filter((c) => c.parent_id === id && c.type !== "category").length;

  return (
    <div className="category-picker">
      {categories.map((c) => (
        <label key={c.channel_id} className="category-option">
          <input
            type="checkbox"
            checked={selected.includes(c.channel_id)}
            onChange={() => toggle(c.channel_id)}
          />
          <span>📁 {c.name}</span>
          <span className="muted" style={{ fontSize: 13 }}>
            {countIn(c.channel_id)} кан.
          </span>
        </label>
      ))}
    </div>
  );
}
