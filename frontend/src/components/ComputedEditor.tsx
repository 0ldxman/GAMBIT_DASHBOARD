import { useEffect, useMemo, useState } from "react";
import { ALL_LEVELS, DepthPicker, GroupBox, groupByPath, pathTail } from "./grouping";
import type { PathGroup } from "./grouping";
import { useDebounced, useLocalNumber } from "../hooks";
import type { ComputedField, ComputedValue, ExprEval, ExprEvalRef } from "../types";

/** Формула вместе со своим местом в списке — индекс нужен для правки. */
interface Placed {
  field: ComputedField;
  index: number;
}

/** Есть ли что группировать: без вложенных путей переключатель не нужен. */
const hasNesting = (paths: string[]) => paths.some((path) => path.includes("."));

/** Готовое значение или ошибка — одинаково в редакторе и в списке. */
function Value({ value, refs }: { value?: ComputedValue; refs?: ExprEvalRef[] }) {
  if (value?.error) {
    return (
      <span className="error" title={value.error}>
        ⚠ {value.error}
      </span>
    );
  }
  return (
    <span
      className="calc-value"
      title={refs?.length ? refs.map((r) => `${r.path} = ${r.text}`).join("\n") : undefined}
    >
      {value?.text || "—"}
    </span>
  );
}

/**
 * Значения путей, на которые ссылается формула.
 *
 * Само число формулы приходит из предпросмотра страниц, а вот ЧТО в неё вошло —
 * нет. Куратору, который не программирует, ошибка «не число» непонятна, пока не
 * видно, чему равен каждый вход.
 */
function useExprRefs(expr: string, evalExpr?: (expr: string) => Promise<ExprEval>) {
  const debounced = useDebounced(expr, 500);
  const [refs, setRefs] = useState<ExprEvalRef[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!evalExpr || !debounced.trim()) {
      setRefs([]);
      return;
    }
    evalExpr(debounced)
      .then((r) => !cancelled && setRefs(r.refs))
      .catch(() => !cancelled && setRefs([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, !!evalExpr]);

  return refs;
}

/** Поле выражения с результатом и значениями входов под ним. */
function ExprRow({
  expr,
  value,
  evalExpr,
  onChange,
  onFocus,
}: {
  expr: string;
  value?: ComputedValue;
  evalExpr?: (expr: string) => Promise<ExprEval>;
  onChange: (expr: string) => void;
  onFocus: () => void;
}) {
  const refs = useExprRefs(expr, evalExpr);
  return (
    <>
      <div className="row top" style={{ gap: "var(--s2)" }}>
        <textarea
          className="grow mono"
          value={expr}
          placeholder="казна.прирост - казна.расход"
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
          style={{ minHeight: 46 }}
        />
        <div style={{ flex: "0 0 170px", textAlign: "right", paddingTop: 6 }}>
          <Value value={value} refs={refs} />
        </div>
      </div>
      {refs.length > 0 && (
        <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
          {refs.map((r) => `${r.path} = ${r.text}`).join(" · ")}
        </span>
      )}
    </>
  );
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
  evalExpr,
  scope = "entity",
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
  /** Значения входов формулы; нет сущности (редактор типа) — нет и предпросмотра. */
  evalExpr?: (expr: string) => Promise<ExprEval>;
  /** Разделяет память свёрнутых групп и глубины: у типа и у сущности она своя. */
  scope?: string;
}) {
  // Куда дописывать путь по клику на подсказку — последняя формула в фокусе.
  const [active, setActive] = useState(0);
  // Дерево путей — как у атрибутов: «бюджет.ресурсы.минералы» ложится
  // в «бюджет» → «ресурсы».
  const [depth, setDepth] = useLocalNumber(`calc:${scope}:depth`, ALL_LEVELS);
  const byPath = new Map((values ?? []).map((v) => [v.path, v]));
  const ownPaths = new Set(fields.map((f) => f.path));
  // Типовые формулы, которые сущность НЕ переопределила: остальные показываются
  // ниже, среди собственных, чтобы не двоить одну и ту же строку.
  const untouched = inherited.filter((f) => !ownPaths.has(f.path));

  const ownTree = useMemo(
    () =>
      groupByPath(
        fields.map((field, index) => ({ field, index })),
        (item) => item.field.path,
        depth,
      ),
    [fields, depth],
  );
  const typeTree = useMemo(
    () => groupByPath(untouched, (field) => field.path, depth),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inherited, fields, depth],
  );

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

  /** Одна формула. `prefix` — путь группы, в шапке он уже написан. */
  function row({ field, index }: Placed, prefix: string) {
    const overrides = inherited.some((f) => f.path === field.path);
    return (
      <div className="page-block" key={index}>
        <div className="row top" style={{ gap: "var(--s2)" }}>
          <input
            className="grow mono"
            value={pathTail(field.path, prefix)}
            placeholder={prefix ? "деньги" : "бюджет.деньги"}
            title={field.path || "Путь поля в дереве формул"}
            onChange={(e) =>
              patch(index, {
                path: prefix ? `${prefix}.${e.target.value}` : e.target.value,
              })
            }
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
        <ExprRow
          expr={field.expr}
          value={byPath.get(field.path)}
          evalExpr={evalExpr}
          onFocus={() => setActive(index)}
          onChange={(expr) => patch(index, { expr })}
        />
        <div className="row" style={{ gap: "var(--s2)" }}>
          {overrides && (
            <span className="calc-badge" title={`Вместо формулы типа «${inheritedFrom}»`}>
              ⟲ вместо типовой
            </span>
          )}
          {field.path.includes(".") && (
            <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
              выч.{field.path}
            </span>
          )}
        </div>
      </div>
    );
  }

  /** Группа формул со своими строками и подгруппами — на любую глубину. */
  function renderOwnGroup(node: PathGroup<Placed>) {
    return (
      <GroupBox
        key={node.prefix}
        prefix={node.prefix}
        name={node.name}
        flagKey={`calc:${scope}`}
        count={node.count}
        addLabel="формула"
        onAdd={() =>
          onChange([...fields, { path: `${node.prefix}.`, label: "", expr: "" }])
        }
      >
        {node.items.map((item) => row(item, node.prefix))}
        {node.groups.map(renderOwnGroup)}
      </GroupBox>
    );
  }

  /** Типовая формула: править её можно только в типе, зато переопределить — тут. */
  function typeRow(field: ComputedField, prefix: string) {
    return (
      <div className="calc-row" key={field.path}>
        <span title={field.path}>
          {field.label || pathTail(field.path, prefix)}{" "}
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
    );
  }

  function renderTypeGroup(node: PathGroup<ComputedField>) {
    return (
      <GroupBox
        key={node.prefix}
        prefix={node.prefix}
        name={node.name}
        flagKey={`calc:${scope}:type`}
        count={node.count}
      >
        {node.items.map((field) => typeRow(field, node.prefix))}
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
          show={hasNesting([...fields, ...inherited].map((f) => f.path))}
        />
      </div>

      {untouched.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: "var(--fs-cap)" }}>
            Из типа{inheritedFrom ? ` «${inheritedFrom}»` : ""} — правятся в типе
          </div>
          <div className="stack tight calc-from-type">
            {typeTree.items.map((field) => typeRow(field, ""))}
            {typeTree.groups.map(renderTypeGroup)}
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

      {ownTree.items.map((item) => row(item, ""))}
      {ownTree.groups.map(renderOwnGroup)}

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

/** Значения формул только для чтения — компактным деревом. */
export function ComputedValues({ values }: { values?: ComputedValue[] }) {
  if (!values || values.length === 0) return null;

  function valueRow(value: ComputedValue, prefix: string) {
    return (
      <div className="calc-row" key={value.path}>
        <span title={value.path}>
          {value.label || pathTail(value.path, prefix)}
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
    );
  }

  // Здесь только смотрят, поэтому не коробки со сворачиванием, а подписи с
  // отступом: список значений должен оставаться коротким.
  function renderGroup(node: PathGroup<ComputedValue>) {
    return (
      <div key={node.prefix}>
        <div className="attr-key" title={node.prefix}>
          {node.name}
        </div>
        <div style={{ paddingLeft: "var(--s3)" }}>
          {node.items.map((value) => valueRow(value, node.prefix))}
          {node.groups.map(renderGroup)}
        </div>
      </div>
    );
  }

  const tree = groupByPath(values, (value) => value.path, ALL_LEVELS);
  return (
    <div className="stack tight" style={{ gap: 0 }}>
      {tree.items.map((value) => valueRow(value, ""))}
      {tree.groups.map(renderGroup)}
    </div>
  );
}
