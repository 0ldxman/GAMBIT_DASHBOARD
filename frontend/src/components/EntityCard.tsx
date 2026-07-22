import { useEffect, useState } from "react";
import type { RenderedPage } from "../types";

const DEFAULT_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

/**
 * Карточка сущности так, как её увидит игрок в `/me-info`.
 *
 * Раньше страницы описания показывались в дашборде стопкой — а в Discord их
 * листают кнопками. Мастер видел не то, что получит игрок, и не замечал, что
 * важное уехало на третью страницу.
 */
export function EntityCard({
  label,
  picture,
  pages,
  error,
  limit,
}: {
  label: string;
  picture: string;
  pages?: RenderedPage[];
  error?: string | null;
  limit: number;
}) {
  const [index, setIndex] = useState(0);
  const total = pages?.length ?? 0;

  // Страниц стало меньше (мастер удалил последнюю) — не зависаем на пустой.
  useEffect(() => {
    if (index >= total) setIndex(Math.max(0, total - 1));
  }, [index, total]);

  if (error) return <div className="error">{error}</div>;
  if (!pages || total === 0) return <p className="muted">Описание пустое — карточка не покажет ничего.</p>;

  const page = pages[Math.min(index, total - 1)];

  return (
    <div className="stack tight">
      <div className="dc-message">
        <img
          className="dc-avatar"
          src={picture || DEFAULT_AVATAR}
          alt=""
          onError={(e) => {
            (e.target as HTMLImageElement).src = DEFAULT_AVATAR;
          }}
        />
        <div className="dc-body">
          <div className="dc-header">
            <span className="dc-author">Gambit Dashboard</span>
            <span className="dc-bot">BOT</span>
          </div>
          <div className="dc-embed" style={{ borderLeftColor: "#5865f2" }}>
            <div className="dc-embed-title">{label || "Без названия"}</div>
            <div className="dc-embed-desc">{page.rendered || " "}</div>
          </div>
          {total > 1 && (
            <div className="dc-buttons">
              <button className="dc-button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
                ‹
              </button>
              <span className="dc-time">
                Страница {index + 1} из {total}
              </span>
              <button
                className="dc-button"
                disabled={index >= total - 1}
                onClick={() => setIndex(index + 1)}
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="row spread">
        <span className={page.over_limit ? "error" : "muted"} style={{ fontSize: "var(--fs-cap)" }}>
          {page.length} / {limit} символов
        </span>
        {page.over_limit && <span className="error">Discord обрежет эту страницу</span>}
      </div>
    </div>
  );
}
