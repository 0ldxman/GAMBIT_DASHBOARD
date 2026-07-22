import { useEffect, useRef } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { CodeArea } from "./CodeArea";
import type { SuggestionGroup } from "./CodeArea";
import type { RenderedPage } from "../types";

/** Страница описания: шаблон и цвет полосы эмбеда. */
export interface Page {
  text: string;
  /** «#5865F2» либо пусто — цвет Discord по умолчанию. */
  color: string;
}

const DEFAULT_COLOR = "#5865F2";

/** Хранятся страницы и цвета двумя списками — собрать и разобрать. */
export function toPages(texts: string[], colors: string[]): Page[] {
  return texts.map((text, i) => ({ text, color: colors[i] ?? "" }));
}
export const pageTexts = (pages: Page[]) => pages.map((p) => p.text);
export const pageColors = (pages: Page[]) => pages.map((p) => p.color);

/** Куда вставлять текст: страница и позиция курсора в ней. */
interface Caret {
  index: number;
  start: number;
  end: number;
}

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
  insertRef,
  suggestions = [],
}: {
  pages: Page[];
  onChange: (pages: Page[]) => void;
  rendered?: RenderedPage[];
  limit: number;
  hint?: ReactNode;
  /** Сюда кладётся функция вставки текста — ею пользуется редактор формул. */
  insertRef?: MutableRefObject<((text: string) => void) | null>;
  /** Что предлагать по правой кнопке: атрибуты, формулы, особые переменные. */
  suggestions?: SuggestionGroup[];
}) {
  // Последнее место, где стоял курсор. Пока страницу не трогали — конец первой.
  const caret = useRef<Caret>({ index: 0, start: -1, end: -1 });

  // Замыкание держит актуальные pages, поэтому переустанавливаем на каждый рендер.
  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (text: string) => {
      const { index, start, end } = caret.current;
      const page = pages[index] ?? pages[0];
      const body = page?.text ?? "";
      const at = start < 0 ? body.length : start;
      const to = end < 0 ? body.length : end;
      const next = `${body.slice(0, at)}${text}${body.slice(to)}`;
      caret.current = { index, start: at + text.length, end: at + text.length };
      onChange(
        pages.length > 0
          ? pages.map((p, i) => (i === index ? { ...p, text: next } : p))
          : [{ text: next, color: "" }],
      );
    };
  });

  function patch(index: number, part: Partial<Page>) {
    onChange(pages.map((p, i) => (i === index ? { ...p, ...part } : p)));
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
        <button className="ghost small" onClick={() => onChange([...pages, { text: "", color: "" }])}>
          + страница
        </button>
      </div>
      {hint}

      {pages.length === 0 && (
        <p className="muted">Страниц нет — карточка сущности будет пустой.</p>
      )}

      {pages.map((page, i) => {
        const info = rendered?.[i];
        const length = info?.length ?? page.text.length;
        const over = info ? info.over_limit : length > limit;
        return (
          <div className="page-block" key={i}>
            <div className="row spread">
              <span className="muted" style={{ fontSize: "var(--fs-cap)" }}>
                Страница {i + 1}
              </span>
              <div className="row" style={{ gap: 4 }}>
                <span className={over ? "error" : "muted"} style={{ fontSize: "var(--fs-cap)" }}>
                  {length} / {limit}
                  {info ? "" : " (без подстановки)"}
                </span>
                {/* Цвет полосы эмбеда именно этой страницы. */}
                <input
                  type="color"
                  title="Цвет полосы эмбеда"
                  value={page.color || DEFAULT_COLOR}
                  style={{ width: 32, height: 28, padding: 2 }}
                  onChange={(e) => patch(i, { color: e.target.value })}
                />
                {page.color && (
                  <button
                    className="icon"
                    title="Убрать цвет — останется цвет Discord по умолчанию"
                    onClick={() => patch(i, { color: "" })}
                  >
                    ⊘
                  </button>
                )}
                <button className="icon" title="Выше" onClick={() => move(i, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button
                  className="icon"
                  title="Ниже"
                  onClick={() => move(i, 1)}
                  disabled={i === pages.length - 1}
                >
                  ↓
                </button>
                <button className="icon danger" title="Удалить" onClick={() => remove(i)}>
                  ✕
                </button>
              </div>
            </div>
            <CodeArea
              value={page.text}
              suggestions={suggestions}
              onChange={(text) => patch(i, { text })}
              onSelectionChange={(start, end) => {
                caret.current = { index: i, start, end };
              }}
            />
            {over && (
              <div className="error">
                Страница длиннее {limit} символов — разбейте её, иначе в Discord текст будет
                обрезан.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
