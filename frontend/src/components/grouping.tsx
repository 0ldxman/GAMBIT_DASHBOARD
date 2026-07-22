import { useLocalFlag } from "../hooks";

/**
 * Группировка по dot-path — общая для атрибутов и формул.
 *
 * И там и там путь один и тот же (`РЕС.пища.запас`, `бюджет.ресурсы.минералы`),
 * и читать плоский список одинаковых строк одинаково тяжело. Поэтому дерево
 * строится одним кодом, и переключатель глубины у обоих редакторов один и тот же.
 */

/** Группа путей: свои элементы и подгруппы уровнем ниже. */
export interface PathGroup<T> {
  /** Полный префикс: «РЕС» или «РЕС.пища». */
  prefix: string;
  /** Последний сегмент — им подписана шапка. */
  name: string;
  items: T[];
  groups: PathGroup<T>[];
  /** Сколько элементов внутри со всеми подгруппами. */
  count: number;
}

/** Глубина «сколько есть»: путей длиннее вряд ли кто-то заведёт. */
export const ALL_LEVELS = 9;

/** Варианты глубины для переключателя: обычно нужна вся вложенность. */
const DEPTH_OPTIONS: { label: string; value: number }[] = [
  { label: "1", value: 1 },
  { label: "2", value: 2 },
  { label: "всё", value: ALL_LEVELS },
];

/** Хвост пути без префикса группы: «РЕС.пища.запас» в «РЕС.пища» — «запас». */
export const pathTail = (path: string, prefix: string) =>
  prefix && path.startsWith(`${prefix}.`) ? path.slice(prefix.length + 1) : path;

/**
 * Разложить элементы по уровням пути до глубины `depth`.
 *
 * `РЕС.пища.запас` при полной вложенности попадает в «РЕС» → «пища», при
 * глубине 1 — в «РЕС» строкой «пища.запас». Элемент, чей путь на этом уровне
 * заканчивается, остаётся собственной строкой группы и никуда не уезжает.
 *
 * Группа из одного элемента не заводится: коробка вокруг единственного поля
 * («ВС» → «танки») только добавляет рамок, поэтому такое поле остаётся строкой
 * родителя с остатком пути в имени.
 */
export function groupByPath<T>(
  items: T[],
  pathOf: (item: T) => string,
  depth: number,
  level = 0,
): { items: T[]; groups: PathGroup<T>[] } {
  const loose: T[] = [];
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const parts = pathOf(item).split(".");
    if (level >= depth || parts.length <= level + 1) {
      loose.push(item);
      continue;
    }
    const prefix = parts.slice(0, level + 1).join(".");
    const bucket = buckets.get(prefix);
    if (bucket) bucket.push(item);
    else buckets.set(prefix, [item]);
  }

  const groups: PathGroup<T>[] = [];
  for (const [prefix, bucket] of buckets) {
    if (bucket.length < 2) {
      loose.push(...bucket);
      continue;
    }
    const inner = groupByPath(bucket, pathOf, depth, level + 1);
    groups.push({
      prefix,
      name: prefix.slice(prefix.lastIndexOf(".") + 1),
      items: inner.items,
      groups: inner.groups,
      count: bucket.length,
    });
  }
  return { items: loose, groups };
}

/** Переключатель глубины дерева. Прячется, когда вложенных путей нет. */
export function DepthPicker({
  depth,
  onChange,
  show = true,
}: {
  depth: number;
  onChange: (depth: number) => void;
  show?: boolean;
}) {
  if (!show) return null;
  return (
    <div className="row" style={{ gap: 4 }} title="На сколько уровней пути делить группы">
      <span className="muted" style={{ fontSize: "var(--fs-cap)" }}>
        группы
      </span>
      <div className="subtabs">
        {DEPTH_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={depth === option.value ? "active" : ""}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Группа с общим путём; сворачивается и помнит своё состояние. */
export function GroupBox({
  prefix,
  name,
  count,
  flagKey,
  addLabel,
  onAdd,
  children,
}: {
  prefix: string;
  name: string;
  count: number;
  /** Начало ключа памяти: у типа, у сущности и у формул она своя. */
  flagKey: string;
  /** Подпись кнопки добавления внутрь группы («поле», «формула»). */
  addLabel?: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useLocalFlag(`${flagKey}:${prefix}`, true);

  return (
    <div className="attr-group">
      <button className="attr-group-head" onClick={() => setOpen(!open)} title={prefix}>
        <span className="sec-caret">{open ? "▾" : "▸"}</span>
        <span>{name}</span>
        <span className="muted" style={{ marginLeft: "auto", fontWeight: 400 }}>
          {count}
        </span>
      </button>
      {open && (
        <div className="attr-group-body">
          {children}
          {onAdd && (
            <div>
              <button className="ghost small" onClick={onAdd}>
                + {addLabel ?? "поле"} в «{prefix}»
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
