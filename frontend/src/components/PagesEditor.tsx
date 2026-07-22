import type { ReactNode } from "react";
import type { RenderedPage } from "../types";

/** Редактор страниц описания.
 *
 * У эмбеда есть предел длины, поэтому длинные статы разбиваются на страницы —
 * в Discord игрок листает их кнопками. Счётчик считает ГОТОВЫЙ текст:
 * одна строка `{{ описание }}` может развернуться в тысячи символов.
 */
export function PagesEditor({
  pages,
  onChange,
  rendered,
  limit,
  hint,
}: {
  pages: string[];
  onChange: (pages: string[]) => void;
  rendered?: RenderedPage[];
  limit: number;
  hint?: ReactNode;
}) {
  function patch(index: number, value: string) {
    onChange(pages.map((p, i) => (i === index ? value : p)));
  }
  function remove(index: number) {
    onChange(pages.filter((_, i) => i !== index));
  }
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="stack">
      <div className="row spread">
        <label style={{ margin: 0 }}>
          Страницы описания{pages.length > 1 ? ` (${pages.length})` : ""}
        </label>
        <button className="ghost" onClick={() => onChange([...pages, ""])}>
          + страница
        </button>
      </div>
      {hint}

      {pages.length === 0 && (
        <p className="muted">Страниц нет — карточка сущности будет пустой.</p>
      )}

      {pages.map((page, i) => {
        const info = rendered?.[i];
        const length = info?.length ?? page.length;
        const over = info ? info.over_limit : length > limit;
        return (
          <div className="page-block" key={i}>
            <div className="row spread">
              <span className="muted" style={{ fontSize: 13 }}>
                Страница {i + 1}
              </span>
              <div className="row" style={{ gap: 4, alignItems: "center" }}>
                <span className={over ? "error" : "muted"} style={{ fontSize: 13 }}>
                  {length} / {limit}
                  {info ? "" : " (без подстановки)"}
                </span>
                <button className="ghost" title="Выше" onClick={() => move(i, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button
                  className="ghost"
                  title="Ниже"
                  onClick={() => move(i, 1)}
                  disabled={i === pages.length - 1}
                >
                  ↓
                </button>
                <button className="ghost danger" title="Удалить" onClick={() => remove(i)}>
                  ✕
                </button>
              </div>
            </div>
            <textarea
              value={page}
              style={{ minHeight: 200, fontFamily: "ui-monospace, monospace" }}
              onChange={(e) => patch(i, e.target.value)}
            />
            {over && (
              <div className="error" style={{ fontSize: 13 }}>
                Страница длиннее {limit} символов — разбейте её, иначе в Discord
                текст будет обрезан.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Предпросмотр готовых страниц: в Discord они листаются кнопками. */
export function PagesPreview({ pages, error }: { pages?: RenderedPage[]; error?: string | null }) {
  if (error) return <div className="error">{error}</div>;
  if (!pages || pages.length === 0) return <p className="muted">Описание пустое.</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {pages.map((p, i) => (
        <div key={i}>
          {pages.length > 1 && (
            <span className="muted" style={{ fontSize: 13 }}>
              Страница {i + 1} из {pages.length}
            </span>
          )}
          <div className="embed-preview">{p.rendered || " "}</div>
        </div>
      ))}
    </div>
  );
}
