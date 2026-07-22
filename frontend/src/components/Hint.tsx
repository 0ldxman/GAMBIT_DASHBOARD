import type { ReactNode } from "react";
import { useLocalFlag } from "../hooks";

/**
 * Пояснение к разделу, которое читают один раз.
 *
 * Раньше такие абзацы висели на экране всегда и занимали столько же места,
 * сколько сами поля. Теперь мастер сворачивает подсказку, и она больше не
 * возвращается — но остаётся доступной по «?».
 */
export function Hint({ id, children }: { id: string; children: ReactNode }) {
  const [open, setOpen] = useLocalFlag(`hint:${id}`, true);

  if (!open) {
    return (
      <button className="hint-toggle" title="Показать подсказку" onClick={() => setOpen(true)}>
        ? подсказка
      </button>
    );
  }
  return (
    <p className="hint">
      {children}{" "}
      <button className="hint-toggle" title="Больше не показывать" onClick={() => setOpen(false)}>
        скрыть
      </button>
    </p>
  );
}
