import { useRef } from "react";

const INDENT = "  ";

/**
 * Textarea для JSON, где Tab вставляет отступ, а не уводит фокус.
 * Shift+Tab снимает отступ. Escape возвращает переход по Tab — иначе из поля
 * было бы не выйти с клавиатуры.
 */
export function JsonEditor({
  value,
  onChange,
  minHeight = 260,
}: {
  value: string;
  onChange: (v: string) => void;
  minHeight?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const escaped = useRef(false);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      escaped.current = true;
      return;
    }
    if (e.key !== "Tab" || escaped.current) {
      escaped.current = false;
      return;
    }
    e.preventDefault();

    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = el;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;

    if (e.shiftKey) {
      // Снять один уровень отступа у каждой затронутой строки.
      const block = value.slice(lineStart, end);
      const dedented = block
        .split("\n")
        .map((l) => (l.startsWith(INDENT) ? l.slice(INDENT.length) : l.replace(/^\t/, "")))
        .join("\n");
      onChange(value.slice(0, lineStart) + dedented + value.slice(end));
      const removed = block.length - dedented.length;
      queueMicrotask(() => {
        el.selectionStart = Math.max(lineStart, start - INDENT.length);
        el.selectionEnd = Math.max(lineStart, end - removed);
      });
      return;
    }

    if (start !== end) {
      // Отступ для выделенного блока целиком.
      const block = value.slice(lineStart, end);
      const indented = block
        .split("\n")
        .map((l) => INDENT + l)
        .join("\n");
      onChange(value.slice(0, lineStart) + indented + value.slice(end));
      const added = indented.length - block.length;
      queueMicrotask(() => {
        el.selectionStart = start + INDENT.length;
        el.selectionEnd = end + added;
      });
      return;
    }

    onChange(value.slice(0, start) + INDENT + value.slice(end));
    queueMicrotask(() => {
      el.selectionStart = el.selectionEnd = start + INDENT.length;
    });
  }

  return (
    <textarea
      ref={ref}
      value={value}
      spellCheck={false}
      onKeyDown={handleKeyDown}
      onChange={(e) => onChange(e.target.value)}
      style={{ minHeight, fontFamily: "ui-monospace, monospace", tabSize: 2 }}
    />
  );
}
