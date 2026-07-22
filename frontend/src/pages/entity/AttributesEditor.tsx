import { useEffect, useMemo, useState } from "react";
import { JsonEditor } from "../../components/JsonEditor";
import { useLocalFlag } from "../../hooks";

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

/** Ключ без корня: «ВС.танки» → «танки». Корень уже написан в шапке группы. */
const leaf = (path: string) => (path.includes(".") ? path.slice(path.indexOf(".") + 1) : path);

/**
 * Атрибуты сущности: строки, сгруппированные по корню пути.
 *
 * У страны их бывает под сорок, и плоский список одинаковых строк читать
 * невозможно. Дерево в атрибутах уже есть (`ВС.танки`, `ресурсы.нефть`) —
 * редактор просто показывает его как дерево: группу можно свернуть, внутри
 * группы кнопка добавления сразу подставляет её префикс.
 *
 * Режим JSON остаётся для глубокой вложенности и списков.
 */
export function AttributesEditor({
  initial,
  version,
  onChange,
}: {
  /** Атрибуты, пришедшие с сервера. */
  initial: Record<string, unknown>;
  /** Меняется при загрузке и сбросе — по нему редактор пересобирает строки. */
  version: number;
  onChange: (attributes: Record<string, unknown>) => void;
}) {
  const [rows, setRows] = useState<AttrRow[]>(() => flatten(initial));
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(initial, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Пересобираемся только по внешнему сигналу: иначе набор ключа перетасовывал
  // бы строки на каждом нажатии клавиши.
  useEffect(() => {
    setRows(flatten(initial));
    setJsonText(JSON.stringify(initial, null, 2));
    setJsonError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  function patchRows(next: AttrRow[]) {
    setRows(next);
    onChange(unflatten(next));
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

  // Группы по корню пути, в порядке появления. Поиск фильтрует строки, а не
  // группы: пустая группа просто не показывается.
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map<string, { row: AttrRow; index: number }[]>();
    rows.forEach((row, index) => {
      if (needle && !row.key.toLowerCase().includes(needle)) return;
      const root = row.key.includes(".") ? row.key.split(".")[0] : "";
      const list = map.get(root);
      if (list) list.push({ row, index });
      else map.set(root, [{ row, index }]);
    });
    return [...map.entries()];
  }, [rows, query]);

  const addRow = (prefix: string) => patchRows([...rows, { key: prefix, value: "" }]);

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
          {rows.length > 0 && groups.length === 0 && (
            <p className="muted">Ничего не найдено по «{query}».</p>
          )}
          {groups.map(([root, items]) => (
            <AttrGroup
              key={root || "__root__"}
              root={root}
              count={items.length}
              onAdd={() => addRow(root ? `${root}.` : "")}
            >
              {items.map(({ row, index }) => (
                <div className="attr-row" key={index}>
                  <input
                    className="mono"
                    value={root ? leaf(row.key) : row.key}
                    placeholder={root ? "поле" : "ключ или путь.через.точку"}
                    onChange={(e) =>
                      patchRows(
                        rows.map((x, i) =>
                          i === index
                            ? { ...x, key: root ? `${root}.${e.target.value}` : e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                  <input
                    value={row.value}
                    placeholder="значение"
                    onChange={(e) =>
                      patchRows(rows.map((x, i) => (i === index ? { ...x, value: e.target.value } : x)))
                    }
                  />
                  <button
                    className="icon danger"
                    title="Удалить атрибут"
                    onClick={() => patchRows(rows.filter((_, i) => i !== index))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </AttrGroup>
          ))}
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

/** Группа атрибутов с общим корнем; сворачивается и помнит своё состояние. */
function AttrGroup({
  root,
  count,
  onAdd,
  children,
}: {
  root: string;
  count: number;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useLocalFlag(`attrs:${root}`, true);
  // Верхнеуровневые атрибуты без общего корня группой не оборачиваем.
  if (!root) return <div className="attr-group-body">{children}</div>;

  return (
    <div className="attr-group">
      <button className="attr-group-head" onClick={() => setOpen(!open)}>
        <span className="sec-caret">{open ? "▾" : "▸"}</span>
        <span>{root}</span>
        <span className="muted" style={{ marginLeft: "auto", fontWeight: 400 }}>
          {count}
        </span>
      </button>
      {open && (
        <div className="attr-group-body">
          {children}
          <div>
            <button className="ghost small" onClick={onAdd}>
              + поле в «{root}»
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
