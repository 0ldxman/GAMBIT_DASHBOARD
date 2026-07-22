import { useState } from "react";
import type { ComputedField, ComputedValue } from "../types";

/** Разложить пути по общему корню: «бюджет.деньги» и «бюджет.итого» — одна группа. */
function group<T extends { path: string }>(items: T[]): { root: string; items: T[] }[] {
  const groups: { root: string; items: T[] }[] = [];
  for (const item of items) {
    const root = item.path.includes(".") ? item.path.split(".")[0] : "";
    const last = groups[groups.length - 1];
    if (last && last.root === root) last.items.push(item);
    else groups.push({ root, items: [item] });
  }
  return groups;
}

/** Хвост пути без корня: «бюджет.ресурсы.минералы» → «.ресурсы.минералы». */
const tail = (path: string) => (path.includes(".") ? path.slice(path.indexOf(".")) : path);

/**
 * Редактор вычисляемых полей типа.
 *
 * Поле — это путь, подпись и выражение от атрибутов. Путь такой же dot-path,
 * как в атрибутах, поэтому поля складываются в дерево и доступны в шаблоне
 * как `{{ выч.бюджет.деньги }}`. Результат считается на данных предпросмотра
 * и показывается прямо в строке: формула проверяется до того, как её увидит игрок.
 */
export function ComputedEditor({
  fields,
  onChange,
  values,
  paths,
  onInsert,
}: {
  fields: ComputedField[];
  onChange: (fields: ComputedField[]) => void;
  values?: ComputedValue[];
  /** Пути атрибутов из структуры типа — подсказка, кликом вставляется в формулу. */
  paths: string[];
  /** Вставить `{{ выч.путь }}` в страницу описания. */
  onInsert?: (snippet: string) => void;
}) {
  // Куда дописывать путь по клику на подсказку — последняя формула в фокусе.
  const [active, setActive] = useState(0);
  const byPath = new Map((values ?? []).map((v) => [v.path, v]));

  function patch(index: number, part: Partial<ComputedField>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...part } : f)));
  }
  function remove(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  function appendPath(path: string) {
    const field = fields[active];
    if (!field) return;
    const expr = field.expr.trim();
    patch(active, { expr: expr ? `${expr} ${path}` : path });
  }

  return (
    <div className="stack">
      <div className="row spread">
        <label style={{ margin: 0 }}>
          Вычисляемые поля{fields.length > 0 ? ` (${fields.length})` : ""}
        </label>
        <button
          className="ghost"
          onClick={() => onChange([...fields, { path: "", label: "", expr: "" }])}
        >
          + поле
        </button>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Формула считается от атрибутов сущности: <code>казна.прирост - казна.расход</code>,{" "}
        <code>длина(духи)</code>, <code>сумма(гигаструктуры, "мощь")</code>. Путь с точками
        собирается в дерево — в шаблоне это <code>{"{{ выч.бюджет.деньги }}"}</code>, а вся
        ветка сразу — <code>{"{{ выч.бюджет | поля }}"}</code>. Одна формула может ссылаться
        на другую.
      </p>

      {group(fields).map((section, gi) => (
        <div className="stack" key={gi} style={{ gap: 6 }}>
          {section.root && (
            <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
              {section.root}
            </span>
          )}
          {section.items.map((field) => {
            const index = fields.indexOf(field);
            const value = byPath.get(field.path);
            return (
              <div className="page-block" key={index} style={{ padding: 10 }}>
                <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                  <div style={{ flex: "1 1 200px" }}>
                    <input
                      value={field.path}
                      placeholder="бюджет.деньги"
                      title="Путь поля в дереве формул"
                      onChange={(e) => patch(index, { path: e.target.value })}
                    />
                  </div>
                  <div style={{ flex: "1 1 160px" }}>
                    <input
                      value={field.label}
                      placeholder="Подпись"
                      title="Подпись для дашборда и фильтра «поля»"
                      onChange={(e) => patch(index, { label: e.target.value })}
                    />
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    {onInsert && (
                      <button
                        className="ghost"
                        title="Вставить в описание"
                        disabled={!field.path}
                        onClick={() => onInsert(`{{ выч.${field.path} }}`)}
                      >
                        ↧
                      </button>
                    )}
                    <button
                      className="ghost"
                      title="Выше"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="ghost"
                      title="Ниже"
                      disabled={index === fields.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button className="ghost danger" title="Удалить" onClick={() => remove(index)}>
                      ✕
                    </button>
                  </div>
                </div>
                <div className="row" style={{ gap: 8, alignItems: "flex-start", marginTop: 6 }}>
                  <textarea
                    value={field.expr}
                    placeholder="казна.прирост - казна.расход"
                    onFocus={() => setActive(index)}
                    onChange={(e) => patch(index, { expr: e.target.value })}
                    style={{ flex: 1, minHeight: 46, fontFamily: "ui-monospace, monospace" }}
                  />
                  <div style={{ flex: "0 0 170px", textAlign: "right", paddingTop: 6 }}>
                    {value?.error ? (
                      <span className="error" style={{ fontSize: 13 }}>
                        ⚠ {value.error}
                      </span>
                    ) : (
                      <span style={{ fontFamily: "ui-monospace, monospace" }}>
                        {value?.text || "—"}
                      </span>
                    )}
                  </div>
                </div>
                {section.root && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {tail(field.path)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {fields.length > 0 && paths.length > 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          Пути:{" "}
          {paths.map((path) => (
            <button
              key={path}
              className="ghost"
              style={{ padding: "0 4px", fontSize: 13 }}
              title="Дописать в формулу"
              onClick={() => appendPath(path)}
            >
              {path}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}

/** Значения формул только для чтения — на экране сущности. */
export function ComputedValues({ values }: { values?: ComputedValue[] }) {
  if (!values || values.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {group(values).map((section, gi) => (
        <div key={gi}>
          {section.root && (
            <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
              {section.root}
            </div>
          )}
          {section.items.map((value) => (
            <div
              className="row spread"
              key={value.path}
              style={{ paddingLeft: section.root ? 12 : 0 }}
            >
              <span>{value.label || value.path}</span>
              {value.error ? (
                <span className="error" style={{ fontSize: 13 }}>
                  ⚠ {value.error}
                </span>
              ) : (
                <span style={{ fontFamily: "ui-monospace, monospace" }}>{value.text || "—"}</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
