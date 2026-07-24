import { useEffect, useMemo, useState } from "react";
import { ALL_LEVELS, DepthPicker, GroupBox, groupByPath, pathTail } from "./grouping";
import type { PathGroup } from "./grouping";
import { useDebounced, useLocalNumber } from "../hooks";
import type { ExprEval, TurnRule } from "../types";

/** Правило вместе со своим местом в списке — индекс нужен для правки. */
interface Placed {
  rule: TurnRule;
  index: number;
}

const hasNesting = (paths: string[]) => paths.some((path) => path.includes("."));

/**
 * Заготовки правил: типовые случаи набираются одной кнопкой.
 *
 * Куратору не нужно помнить синтаксис — он правит подставленные пути под свои
 * атрибуты. Именно эти три схемы покрывают почти всю экономику хода.
 */
const PRESETS: { name: string; title: string; rule: TurnRule }[] = [
  {
    name: "накопление",
    title: "Запас пополняется приростом и тратится расходом",
    rule: {
      path: "ресурс.запас",
      label: "Запас",
      expr: "ресурс.запас + ресурс.прирост - ресурс.расход",
    },
  },
  {
    name: "процентный рост",
    title: "Значение растёт на процент за ход",
    rule: {
      path: "экономика.ВВП",
      label: "ВВП",
      expr: "экономика.ВВП * (1 + экономика.рост / 100)",
    },
  },
  {
    name: "не ниже нуля",
    title: "Списание, которое не уводит запас в минус",
    rule: {
      path: "ресурс.запас",
      label: "Запас",
      expr: "в_пределах(ресурс.запас - выч.расход, 0, 999999999)",
    },
  },
];

/** Живой результат выражения: считается на сервере, на данных этой сущности. */
function RuleValue({
  expr,
  evalExpr,
}: {
  expr: string;
  evalExpr: (expr: string) => Promise<ExprEval>;
}) {
  // Считаем не на каждую букву: выражение набирают посимвольно, а запрос
  // ходит в БД за связями.
  const debounced = useDebounced(expr, 500);
  const [result, setResult] = useState<ExprEval | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!debounced.trim()) {
      setResult(null);
      return;
    }
    evalExpr(debounced)
      .then((r) => !cancelled && setResult(r))
      .catch(() => !cancelled && setResult(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  if (!result) return <span className="muted">—</span>;
  if (result.error) {
    return (
      <span className="error" title={result.error}>
        ⚠ {result.error}
      </span>
    );
  }
  return (
    <span
      className="calc-value"
      title={
        result.refs.length
          ? result.refs.map((r) => `${r.path} = ${r.text}`).join("\n")
          : "Значение на текущих данных сущности"
      }
    >
      станет {result.value}
    </span>
  );
}

/**
 * Редактор автоизменений в конце хода.
 *
 * Правило — это «атрибут ← выражение»: путь говорит, КУДА записать, выражение —
 * ЧТО. В отличие от формулы (она считается на лету и ничего не трогает) правило
 * один раз меняет атрибут при завершении хода.
 *
 * Правила типа приходят на экран сущности как `inherited` — только для чтения,
 * но любое можно переопределить, и копия уедет в собственные правила сущности.
 */
export function TurnRulesEditor({
  rules,
  onChange,
  inherited = [],
  inheritedFrom = "",
  paths,
  evalExpr,
  scope = "entity",
}: {
  rules: TurnRule[];
  onChange: (rules: TurnRule[]) => void;
  /** Правила типа — только для чтения (на экране сущности). */
  inherited?: TurnRule[];
  inheritedFrom?: string;
  /** Пути атрибутов — подсказка, кликом дописывается в выражение. */
  paths: string[];
  /** Живой предпросмотр; нет сущности (редактор типа) — нет и предпросмотра. */
  evalExpr?: (expr: string) => Promise<ExprEval>;
  scope?: string;
}) {
  const [active, setActive] = useState(0);
  const [depth, setDepth] = useLocalNumber(`turn:${scope}:depth`, ALL_LEVELS);
  const ownPaths = new Set(rules.map((r) => r.path));
  const untouched = inherited.filter((r) => !ownPaths.has(r.path));

  const ownTree = useMemo(
    () =>
      groupByPath(
        rules.map((rule, index) => ({ rule, index })),
        (item) => item.rule.path,
        depth,
      ),
    [rules, depth],
  );
  const typeTree = useMemo(
    () => groupByPath(untouched, (rule) => rule.path, depth),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inherited, rules, depth],
  );

  function patch(index: number, part: Partial<TurnRule>) {
    onChange(rules.map((r, i) => (i === index ? { ...r, ...part } : r)));
  }
  function remove(index: number) {
    onChange(rules.filter((_, i) => i !== index));
  }
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  function appendPath(path: string) {
    const rule = rules[active];
    if (!rule) return;
    const expr = rule.expr.trim();
    patch(active, { expr: expr ? `${expr} ${path}` : path });
  }

  function row({ rule, index }: Placed, prefix: string) {
    const overrides = inherited.some((r) => r.path === rule.path);
    return (
      <div className="page-block" key={index}>
        <div className="row top" style={{ gap: "var(--s2)" }}>
          <input
            className="grow mono"
            value={pathTail(rule.path, prefix)}
            placeholder={prefix ? "запас" : "экономика.деньги.запас"}
            title={rule.path || "Какой атрибут изменится в конце хода"}
            onChange={(e) =>
              patch(index, {
                path: prefix ? `${prefix}.${e.target.value}` : e.target.value,
              })
            }
          />
          <input
            className="grow"
            value={rule.label}
            placeholder="Подпись"
            title="Подпись для предпросмотра хода"
            onChange={(e) => patch(index, { label: e.target.value })}
          />
          <div className="row" style={{ gap: 0 }}>
            <button className="icon" title="Выше" disabled={index === 0} onClick={() => move(index, -1)}>
              ↑
            </button>
            <button
              className="icon"
              title="Ниже"
              disabled={index === rules.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button
              className="icon danger"
              title={overrides ? "Вернуть правило типа" : "Удалить"}
              onClick={() => remove(index)}
            >
              ✕
            </button>
          </div>
        </div>
        <div className="row top" style={{ gap: "var(--s2)" }}>
          <span className="muted mono" style={{ paddingTop: 10 }}>
            ←
          </span>
          <textarea
            className="grow mono"
            value={rule.expr}
            placeholder="экономика.деньги.запас - выч.деньги"
            onFocus={() => setActive(index)}
            onChange={(e) => patch(index, { expr: e.target.value })}
            style={{ minHeight: 46 }}
          />
          <div style={{ flex: "0 0 190px", textAlign: "right", paddingTop: 6 }}>
            {evalExpr ? (
              <RuleValue expr={rule.expr} evalExpr={evalExpr} />
            ) : (
              <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                предпросмотр — у сущности
              </span>
            )}
          </div>
        </div>
        {overrides && (
          <div className="row" style={{ gap: "var(--s2)" }}>
            <span className="calc-badge" title={`Вместо правила типа «${inheritedFrom}»`}>
              ⟲ вместо типового
            </span>
          </div>
        )}
      </div>
    );
  }

  function renderOwnGroup(node: PathGroup<Placed>) {
    return (
      <GroupBox
        key={node.prefix}
        prefix={node.prefix}
        name={node.name}
        flagKey={`turn:${scope}`}
        count={node.count}
        addLabel="правило"
        onAdd={() => onChange([...rules, { path: `${node.prefix}.`, label: "", expr: "" }])}
      >
        {node.items.map((item) => row(item, node.prefix))}
        {node.groups.map(renderOwnGroup)}
      </GroupBox>
    );
  }

  function typeRow(rule: TurnRule, prefix: string) {
    return (
      <div className="calc-row" key={rule.path}>
        <span title={`${rule.path} ← ${rule.expr}`}>
          {rule.label || pathTail(rule.path, prefix)}{" "}
          <button
            className="hint-toggle"
            title="Задать этой сущности своё правило вместо типового"
            onClick={() => onChange([...rules, { ...rule }])}
          >
            переопределить
          </button>
        </span>
        <span className="muted mono" style={{ fontSize: "var(--fs-micro)" }}>
          {rule.expr}
        </span>
      </div>
    );
  }

  function renderTypeGroup(node: PathGroup<TurnRule>) {
    return (
      <GroupBox
        key={node.prefix}
        prefix={node.prefix}
        name={node.name}
        flagKey={`turn:${scope}:type`}
        count={node.count}
      >
        {node.items.map((rule) => typeRow(rule, node.prefix))}
        {node.groups.map(renderTypeGroup)}
      </GroupBox>
    );
  }

  return (
    <div className="stack tight">
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <DepthPicker
          depth={depth}
          onChange={setDepth}
          show={hasNesting([...rules, ...inherited].map((r) => r.path))}
        />
      </div>

      {untouched.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: "var(--fs-cap)" }}>
            Из типа{inheritedFrom ? ` «${inheritedFrom}»` : ""} — правятся в типе
          </div>
          <div className="stack tight calc-from-type">
            {typeTree.items.map((rule) => typeRow(rule, ""))}
            {typeTree.groups.map(renderTypeGroup)}
          </div>
        </>
      )}

      {inherited.length > 0 && (
        <div className="muted" style={{ fontSize: "var(--fs-cap)", marginTop: "var(--s2)" }}>
          Свои правила
        </div>
      )}

      {ownTree.items.map((item) => row(item, ""))}
      {ownTree.groups.map(renderOwnGroup)}

      <div className="row" style={{ flexWrap: "wrap", gap: "var(--s2)" }}>
        <button
          className="ghost small"
          onClick={() => onChange([...rules, { path: "", label: "", expr: "" }])}
        >
          + правило
        </button>
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            className="hint-toggle"
            title={`${preset.title}: ${preset.rule.path} ← ${preset.rule.expr}`}
            onClick={() => onChange([...rules, { ...preset.rule }])}
          >
            + {preset.name}
          </button>
        ))}
      </div>

      {rules.length > 0 && paths.length > 0 && (
        <p className="hint" style={{ marginTop: "var(--s2)" }}>
          Пути:{" "}
          {paths.map((path) => (
            <button
              key={path}
              className="hint-toggle"
              title="Дописать в выражение"
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
