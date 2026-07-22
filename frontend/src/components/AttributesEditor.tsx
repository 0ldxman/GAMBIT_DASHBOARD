import { useEffect, useMemo, useState } from "react";
import { JsonEditor } from "./JsonEditor";
import { ALL_LEVELS, DepthPicker, GroupBox, groupByPath, pathTail } from "./grouping";
import type { PathGroup } from "./grouping";
import { useLocalNumber } from "../hooks";

interface AttrRow {
  key: string;
  value: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Вложенный объект → строки с dot-path ключами: {ВС:{танки:1}} → "ВС.танки". */
export function flatten(obj: Record<string, unknown>, prefix = ""): AttrRow[] {
  const rows: AttrRow[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      rows.push(...flatten(value, path));
    } else {
      rows.push({
        key: path,
        value: typeof value === "string" ? value : JSON.stringify(value),
      });
    }
  }
  return rows;
}

/** Пути до листьев: подсказка для формул и автодополнение путей в правках.
 *  Список — лист целиком: внутрь него формулы и правки не ходят. */
export function attrPaths(value: unknown, prefix = ""): string[] {
  if (!isPlainObject(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, item]) =>
    attrPaths(item, prefix ? `${prefix}.${key}` : key),
  );
}

/** Строки с dot-path ключами → вложенный объект. */
export function unflatten(rows: AttrRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, value } of rows) {
    const path = key.trim();
    if (!path) continue;
    // Числа/булевы/массивы разбираем как JSON, остальное — строка.
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value;
    }
    const parts = path.split(".");
    let node = out;
    for (const part of parts.slice(0, -1)) {
      if (!isPlainObject(node[part])) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = parsed;
  }
  return out;
}

/** Строка вместе со своим местом в общем списке — индекс нужен для правки. */
interface Placed {
  row: AttrRow;
  index: number;
}

/** Значение строки — список? Тогда правим его построчно, а не JSON-ом. */
function asList(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Список → текст: одна строка на элемент, объекты компактным JSON. */
function listToText(items: unknown[]): string {
  return items
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    .join("\n");
}

/** Текст → значение строки: пустые строки отбрасываются, числа и объекты
 *  разбираются как JSON — то же правило, что и для обычного значения. */
function textToList(text: string): string {
  const items = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return line;
      }
    });
  return JSON.stringify(items);
}

/**
 * Атрибуты строками, сгруппированными по корню пути.
 *
 * У страны их бывает под сорок, и плоский список одинаковых строк читать
 * невозможно. Дерево в атрибутах уже есть (`ВС.танки`, `ресурсы.нефть`) —
 * редактор просто показывает его как дерево: группу можно свернуть, внутри
 * группы кнопка добавления сразу подставляет её префикс. Списки правятся по
 * строке на элемент, режим JSON остаётся для глубокой вложенности.
 *
 * Используется дважды: на сущности — её собственные атрибуты, в типе —
 * заготовка, с которой создаются новые сущности.
 */
export function AttributesEditor({
  initial,
  version,
  onChange,
  onError,
  scope = "entity",
}: {
  /** Атрибуты, пришедшие с сервера. */
  initial: Record<string, unknown>;
  /** Меняется при загрузке и сбросе — по нему редактор пересобирает строки. */
  version: number;
  onChange: (attributes: Record<string, unknown>) => void;
  /**
   * Битый JSON в режиме «JSON»: значение не применилось, и сохранять нельзя —
   * иначе вставка чужой структуры молча запишет то, что было до неё.
   */
  onError?: (message: string | null) => void;
  /** Разделяет память свёрнутых групп: у типа и у сущности она своя. */
  scope?: string;
}) {
  const [rows, setRows] = useState<AttrRow[]>(() => flatten(initial));
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(initial, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // На сколько уровней пути делить группы. По умолчанию на все: «РЕС.пища.запас»
  // и «РЕС.пища.расход» читаются деревом, а не списком одинаковых строк.
  const [depth, setDepth] = useLocalNumber(`attrs:${scope}:depth`, ALL_LEVELS);
  // Черновой текст списков по индексу строки. Без него перевод строки в конце
  // съедался бы пересборкой значения из JSON прямо во время набора.
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  // Пересобираемся только по внешнему сигналу: иначе набор ключа перетасовывал
  // бы строки на каждом нажатии клавиши.
  useEffect(() => {
    setRows(flatten(initial));
    setJsonText(JSON.stringify(initial, null, 2));
    setJsonError(null);
    setDrafts({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // Ошибку разбора отдаём наверх — по ней экран блокирует сохранение. Уходя
  // (например, переключили вкладку), снимаем её: невидимая ошибка не должна
  // навсегда запретить сохранять.
  useEffect(() => {
    onError?.(jsonError);
    return () => onError?.(null);
  }, [jsonError, onError]);

  function patchRows(next: AttrRow[]) {
    // Строк стало больше или меньше — индексы поехали, и черновики начали бы
    // показываться в чужих строках.
    if (next.length !== rows.length) setDrafts({});
    setRows(next);
    onChange(unflatten(next));
  }

  /** Правка списка: черновик хранится как есть, в атрибуты уходит JSON. */
  function patchList(index: number, text: string) {
    setDrafts({ ...drafts, [index]: text });
    patchRows(rows.map((x, i) => (i === index ? { ...x, value: textToList(text) } : x)));
  }

  /** Превратить значение в список и обратно — иначе новый список заводится
   *  только вручную набранными скобками. Ничего не теряется: при обратном
   *  превращении элементы склеиваются в строку через запятую. */
  function toggleList(index: number) {
    const row = rows[index];
    const items = asList(row.value);
    const next =
      items === null
        ? JSON.stringify(row.value.trim() ? [row.value] : [])
        : listToText(items).split("\n").join(", ");
    // Черновик снимаем совсем: пустая строка перекрыла бы новое значение.
    const rest = { ...drafts };
    delete rest[index];
    setDrafts(rest);
    patchRows(rows.map((x, i) => (i === index ? { ...x, value: next } : x)));
  }

  function patchJson(text: string) {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text || "{}");
      if (!isPlainObject(parsed)) throw new Error("ожидается объект");
      setJsonError(null);
      onChange(parsed);
    } catch (e) {
      setJsonError(String(e));
    }
  }

  function switchMode(toJson: boolean) {
    if (toJson) {
      setJsonText(JSON.stringify(unflatten(rows), null, 2));
      setJsonError(null);
    } else {
      try {
        const parsed = JSON.parse(jsonText || "{}");
        if (!isPlainObject(parsed)) throw new Error("Ожидается объект");
        setRows(flatten(parsed));
        setJsonError(null);
      } catch (e) {
        setJsonError(`Некорректный JSON: ${String(e)}`);
        return;
      }
    }
    setJsonMode(toJson);
  }

  // Группы по пути, в порядке появления. Поиск фильтрует строки, а не группы:
  // пустая группа просто не показывается.
  const tree = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible: Placed[] = [];
    rows.forEach((row, index) => {
      if (needle && !row.key.toLowerCase().includes(needle)) return;
      visible.push({ row, index });
    });
    return groupByPath(visible, (item) => item.row.key, depth);
  }, [rows, query, depth]);

  const addRow = (prefix: string) => patchRows([...rows, { key: prefix, value: "" }]);

  /** Одна строка атрибута. `prefix` — путь группы, в шапке он уже написан. */
  function renderRow({ row, index }: Placed, prefix: string) {
    const list = asList(row.value);
    return (
      <div className="attr-row" key={index}>
        <input
          className="mono"
          value={pathTail(row.key, prefix)}
          placeholder={prefix ? "поле" : "ключ или путь.через.точку"}
          onChange={(e) =>
            patchRows(
              rows.map((x, i) =>
                i === index
                  ? { ...x, key: prefix ? `${prefix}.${e.target.value}` : e.target.value }
                  : x,
              ),
            )
          }
        />
        {list ? (
          <textarea
            // Одна строка — один элемент: JSON с кавычками мастеру набирать не
            // нужно, объекты пишутся строкой на объект.
            value={drafts[index] ?? listToText(list)}
            placeholder="по одному элементу на строку"
            style={{ minHeight: 68 }}
            onChange={(e) => patchList(index, e.target.value)}
          />
        ) : (
          <input
            value={row.value}
            placeholder="значение"
            onChange={(e) =>
              patchRows(rows.map((x, i) => (i === index ? { ...x, value: e.target.value } : x)))
            }
          />
        )}
        <div className="row" style={{ gap: 0 }}>
          <button
            className={list ? "icon accent" : "icon"}
            title={list ? "Сделать обычным значением" : "Сделать списком"}
            onClick={() => toggleList(index)}
          >
            ☰
          </button>
          <button
            className="icon danger"
            title="Удалить атрибут"
            onClick={() => patchRows(rows.filter((_, i) => i !== index))}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  /** Группа со своими строками и подгруппами — рисуется на любую глубину. */
  function renderGroup(node: PathGroup<Placed>) {
    return (
      <GroupBox
        key={node.prefix}
        prefix={node.prefix}
        name={node.name}
        flagKey={`attrs:${scope}`}
        count={node.count}
        onAdd={() => addRow(`${node.prefix}.`)}
      >
        {node.items.map((item) => renderRow(item, node.prefix))}
        {node.groups.map(renderGroup)}
      </GroupBox>
    );
  }

  return (
    <div className="stack tight">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        {!jsonMode && (
          <input
            className="search"
            value={query}
            placeholder="поиск по атрибутам…"
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <span className="spacer" style={{ flex: 1 }} />
        <DepthPicker depth={depth} onChange={setDepth} show={!jsonMode} />
        <div className="subtabs">
          <button className={jsonMode ? "" : "active"} onClick={() => switchMode(false)}>
            Поля
          </button>
          <button className={jsonMode ? "active" : ""} onClick={() => switchMode(true)}>
            JSON
          </button>
        </div>
      </div>

      {jsonMode ? (
        <>
          <JsonEditor value={jsonText} onChange={patchJson} />
          {jsonError && <div className="error">{jsonError}</div>}
        </>
      ) : (
        <>
          {rows.length === 0 && <p className="muted">Атрибутов нет.</p>}
          {rows.length > 0 && tree.items.length === 0 && tree.groups.length === 0 && (
            <p className="muted">Ничего не найдено по «{query}».</p>
          )}
          {/* Верхнеуровневые атрибуты без общего корня группой не оборачиваем. */}
          {tree.items.length > 0 && (
            <div className="attr-group-body">{tree.items.map((item) => renderRow(item, ""))}</div>
          )}
          {tree.groups.map(renderGroup)}
          <div className="row">
            <button className="ghost small" onClick={() => addRow("")}>
              + атрибут
            </button>
          </div>
        </>
      )}
    </div>
  );
}
