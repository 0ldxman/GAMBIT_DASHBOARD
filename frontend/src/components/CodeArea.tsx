import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

/** Что можно вставить в шаблон правой кнопкой. */
export interface Suggestion {
  /** Как показать в меню: «ВС.танки», «бюджет.итого». */
  label: string;
  /** Что вставить: «{{ ВС.танки }}». */
  snippet: string;
  /** Правая колонка меню — значение или пояснение. */
  hint?: string;
}

export interface SuggestionGroup {
  title: string;
  items: Suggestion[];
}

/** Кусок шаблона: обычный текст или тег Jinja. */
type Token = { text: string; kind: "text" | "var" | "tag" | "comment" };

// {{ … }} — подстановка, {% … %} — управляющий тег, {# … #} — комментарий.
const TOKEN_RE = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\})/g;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > last) tokens.push({ text: text.slice(last, start), kind: "text" });
    const chunk = match[0];
    const kind = chunk.startsWith("{{") ? "var" : chunk.startsWith("{%") ? "tag" : "comment";
    tokens.push({ text: chunk, kind });
    last = start + chunk.length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), kind: "text" });
  return tokens;
}

/**
 * Поле шаблона с подсветкой Jinja и вставкой атрибутов по правой кнопке.
 *
 * Подсветка сделана слоями: снизу `<pre>` с раскрашенными кусками, сверху сам
 * `<textarea>` с прозрачным текстом. Оба слоя рисуют одинаковый текст одним и
 * тем же шрифтом, поэтому буквы совпадают, а редактирование остаётся штатным —
 * ни своей каретки, ни своей истории отмен писать не нужно.
 */
export function CodeArea({
  value,
  onChange,
  minHeight = 200,
  suggestions = [],
  onSelectionChange,
  areaRef,
}: {
  value: string;
  onChange: (value: string) => void;
  minHeight?: number;
  /** Что предлагать по правой кнопке. Пусто — меню не показывается. */
  suggestions?: SuggestionGroup[];
  /** Сообщить наружу позицию каретки — по ней вставляют из других мест. */
  onSelectionChange?: (start: number, end: number) => void;
  areaRef?: MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; at: number } | null>(null);
  const [query, setQuery] = useState("");

  const setRef = (node: HTMLTextAreaElement | null) => {
    localRef.current = node;
    if (areaRef) areaRef.current = node;
  };

  // Меню закрывается кликом мимо и по Escape — как любое контекстное.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function insert(snippet: string, at: number) {
    const next = `${value.slice(0, at)}${snippet}${value.slice(at)}`;
    onChange(next);
    setMenu(null);
    setQuery("");
    // Каретка встаёт за вставленным куском, чтобы можно было писать дальше.
    requestAnimationFrame(() => {
      const area = localRef.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(at + snippet.length, at + snippet.length);
    });
  }

  const needle = query.trim().toLowerCase();
  const groups = suggestions
    .map((group) => ({
      title: group.title,
      items: needle
        ? group.items.filter((item) => item.label.toLowerCase().includes(needle))
        : group.items,
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="code-wrap" style={{ minHeight }}>
      <pre className="code-hl" ref={highlightRef} aria-hidden>
        {tokenize(value).map((token, i) =>
          token.kind === "text" ? (
            token.text
          ) : (
            <span className={`tok-${token.kind}`} key={i}>
              {token.text}
            </span>
          ),
        )}
        {/* Хвостовой перевод строки иначе не занимает высоту, и слои разъезжаются. */}
        {"\n"}
      </pre>
      <textarea
        ref={setRef}
        className="code-input"
        value={value}
        spellCheck={false}
        style={{ minHeight }}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          const pre = highlightRef.current;
          if (!pre) return;
          pre.scrollTop = e.currentTarget.scrollTop;
          pre.scrollLeft = e.currentTarget.scrollLeft;
        }}
        onSelect={(e) =>
          onSelectionChange?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)
        }
        onContextMenu={(e) => {
          if (suggestions.length === 0) return;
          e.preventDefault();
          setQuery("");
          setMenu({ x: e.clientX, y: e.clientY, at: e.currentTarget.selectionStart });
        }}
      />

      {menu && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            className="ctx-search"
            value={query}
            autoFocus
            placeholder="поиск…"
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="ctx-list">
            {groups.length === 0 && <div className="ctx-empty">Ничего не найдено</div>}
            {groups.map((group) => (
              <div key={group.title}>
                <div className="ctx-group">{group.title}</div>
                {group.items.map((item) => (
                  <button
                    className="ctx-item"
                    key={item.snippet}
                    title={item.snippet}
                    onClick={() => insert(item.snippet, menu.at)}
                  >
                    <span className="ctx-label">{item.label}</span>
                    {item.hint && <span className="ctx-hint">{item.hint}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
