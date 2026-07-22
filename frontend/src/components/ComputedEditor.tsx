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

/** Готовое значение или ошибка — одинаково в редакторе и в списке. */
function Value({ value }: { value?: ComputedValue }) {
  if (value?.error) {
    return (
      <span className="error" title={value.error}>
        ⚠ {value.error}
      </span>
    );
  }
  return <span className="calc-value">{value?.text || "—"}</span>;
}

/**
 * Редактор вычисляемых полей.
 *
 * Поле — это путь, подпись и выражение от атрибутов. Путь такой же dot-path,
 * как в атрибутах, поэтому поля складываются в дерево и доступны в шаблоне
 * как `{{ выч.бюджет.деньги }}`. Результат считается на данных предпросмотра
 * и показывается прямо в строке: формула проверяется до того, как её увидит игрок.
 *
 * На экране сущности сюда же приходят формулы её типа (`inherited`). Они
 * только для чтения, но любую можно переопределить — тогда её копия уезжает
 * в собственные формулы сущности и дальше правится как своя.
 */
export function ComputedEditor({
  fields,
  onChange,
  inherited = [],
  inheritedFrom = "",
  values,
  paths,
  onInsert,
}: {
  /** Собственные формулы: их и правит этот редактор. */
  fields: ComputedField[];
  onChange: (fields: ComputedField[]) => void;
  /** Формулы типа — только для чтения (на экране сущности). */
  inherited?: ComputedField[];
  /** Название типа, из которого пришли inherited. */
  inheritedFrom?: string;
  values?: ComputedValue[];
  /** Пути атрибутов — подсказка, кликом дописывается в формулу. */
  paths: string[];
  /** Вставить `{{ выч.путь }}` в страницу описания. */
  onInsert?: (snippet: string) => void;
}) {
  // Куда дописывать путь по клику на подсказку — последняя формула в фокусе.
  const [active, setActive] = useState(0);
  const byPath = new Map((values ?? []).map((v) => [v.path, v]));
  const ownPaths = new Set(fields.map((f) => f.path));
  // Типовые формулы, которые сущность НЕ переопределила: остальные показываются
  // ниже, среди собственных, чтобы не двоить одну и ту же строку.
  const untouched = inherited.filter((f) => !ownPaths.has(f.path));

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

  function row(field: ComputedField, index: number) {
    const overrides = inherited.some((f) => f.path === field.path);
    return (
      <div className="page-block" key={index}>
        <div className="row top" style={{ gap: "var(--s2)" }}>
          <input
            className="grow mono"
            value={field.path}
            placeholder="бюджет.деньги"
            title="Путь поля в дереве формул"
            onChange={(e) => patch(index, { path: e.target.value })}
          />
          <input
            className="grow"
            value={field.label}
            placeholder="Подпись"
            title="Подпись для дашборда и фильтра «поля»"
            onChange={(e) => patch(index, { label: e.target.value })}
          />
          <div className="row" style={{ gap: 0 }}>
            {onInsert && (
              <button
                className="icon"
                title="Вставить в описание"
                disabled={!field.path}
                onClick={() => onInsert(`{{ выч.${field.path} }}`)}
              >
                ↧
              </button>
            )}
            <button className="icon" title="Выше" disabled={index === 0} onClick={() => move(index, -1)}>
              ↑
            </button>
            <button
              className="icon"
              title="Ниже"
              disabled={index === fields.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button
              className="icon danger"
              title={overrides ? "Вернуть формулу типа" : "Удалить"}
              onClick={() => remove(index)}
            >
              ✕
            </button>
          </div>
        </div>
        <div className="row top" style={{ gap: "var(--s2)" }}>
          <textarea
            className="grow mono"
            value={field.expr}
            placeholder="казна.прирост - казна.расход"
            onFocus={() => setActive(index)}
            onChange={(e) => patch(index, { expr: e.target.value })}
            style={{ minHeight: 46 }}
          />
          <div style={{ flex: "0 0 170px", textAlign: "right", paddingTop: 6 }}>
            <Value value={byPath.get(field.path)} />
          </div>
        </div>
        <div className="row" style={{ gap: "var(--s2)" }}>
          {overrides && (
            <span className="calc-badge" title={`Вместо формулы типа «${inheritedFrom}»`}>
              ⟲ вместо типовой
            </span>
          )}
          {field.path.includes(".") && (
            <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
              {tail(field.path)}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="stack tight">
      {untouched.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: "var(--fs-cap)" }}>
            Из типа{inheritedFrom ? ` «${inheritedFrom}»` : ""} — правятся в типе
          </div>
          <div className="stack tight calc-from-type">
            {group(untouched).map((section, gi) => (
              <div key={gi}>
                {section.root && <div className="attr-key">{section.root}</div>}
                {section.items.map((field) => (
                  <div className="calc-row" key={field.path}>
                    <span>
                      {field.label || field.path}{" "}
                      <button
                        className="hint-toggle"
                        title="Задать этой сущности свою формулу вместо типовой"
                        onClick={() => onChange([...fields, { ...field }])}
                      >
                        переопределить
                      </button>
                    </span>
                    <Value value={byPath.get(field.path)} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {inherited.length > 0 && (
        <div className="muted" style={{ fontSize: "var(--fs-cap)", marginTop: "var(--s2)" }}>
          Свои формулы
        </div>
      )}
      {fields.length === 0 && inherited.length > 0 && (
        <p className="hint" style={{ margin: 0 }}>
          Своих формул нет — считаются только типовые.
        </p>
      )}

      {group(fields).map((section, gi) => (
        <div className="stack tight" key={gi}>
          {section.root && <div className="attr-key">{section.root}</div>}
          {section.items.map((field) => row(field, fields.indexOf(field)))}
        </div>
      ))}

      <div className="row">
        <button
          className="ghost small"
          onClick={() => onChange([...fields, { path: "", label: "", expr: "" }])}
        >
          + формула
        </button>
      </div>

      {fields.length > 0 && paths.length > 0 && (
        <p className="hint" style={{ marginTop: "var(--s2)" }}>
          Пути:{" "}
          {paths.map((path) => (
            <button
              key={path}
              className="hint-toggle"
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

/** Значения формул только для чтения — компактным списком. */
export function ComputedValues({ values }: { values?: ComputedValue[] }) {
  if (!values || values.length === 0) return null;
  return (
    <div className="stack tight" style={{ gap: 0 }}>
      {group(values).map((section, gi) => (
        <div key={gi}>
          {section.root && <div className="attr-key">{section.root}</div>}
          {section.items.map((value) => (
            <div className="calc-row" key={value.path}>
              <span>
                {value.label || value.path}
                {value.source === "override" && (
                  <span className="calc-badge" style={{ marginLeft: 6 }}>
                    ⟲
                  </span>
                )}
                {value.source === "entity" && (
                  <span className="calc-badge" style={{ marginLeft: 6 }}>
                    своя
                  </span>
                )}
              </span>
              <Value value={value} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
