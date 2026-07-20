import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import type { Entity, EntityType, TemplatePreview } from "../types";
import { MembersSection } from "./entity/MembersSection";
import { RelationsSection } from "./entity/RelationsSection";
import { ChannelsSection } from "./entity/ChannelsSection";

interface AttrRow {
  key: string;
  value: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Вложенный объект → строки с dot-path ключами: {ВС:{танки:1}} → "ВС.танки". */
function flatten(obj: Record<string, unknown>, prefix = ""): AttrRow[] {
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
function unflatten(rows: AttrRow[]): Record<string, unknown> {
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

export function EntityPage() {
  const { projectId, entityId } = useParams();
  const pid = Number(projectId);
  const eid = Number(entityId);

  const entity = useAsync<Entity>(() => api.getEntity(pid, eid), [pid, eid]);
  const types = useAsync<EntityType[]>(() => api.listTypes(pid), [pid]);
  // Список сущностей проекта нужен для выбора второй стороны связи.
  const allEntities = useAsync<Entity[]>(() => api.listEntities(pid), [pid]);

  const [label, setLabel] = useState("");
  const [picture, setPicture] = useState("");
  const [typeId, setTypeId] = useState<number | null>(null);
  const [rows, setRows] = useState<AttrRow[]>([]);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!entity.data) return;
    setLabel(entity.data.label);
    setPicture(entity.data.picture);
    setTypeId(entity.data.type_id);
    setRows(flatten(entity.data.attributes));
    setJsonText(JSON.stringify(entity.data.attributes, null, 2));
  }, [entity.data]);

  // Текущие атрибуты — из активного режима редактирования.
  const attributes = useMemo<Record<string, unknown>>(() => {
    if (!jsonMode) return unflatten(rows);
    try {
      const parsed = JSON.parse(jsonText || "{}");
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }, [jsonMode, rows, jsonText]);

  const template = useMemo(
    () => types.data?.find((t) => t.id === typeId)?.attributes_template ?? "",
    [types.data, typeId],
  );

  // Живой предпросмотр embed.
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const res = await api.previewTemplate(pid, { template, attributes, label });
        setPreview(res);
      } catch (e) {
        setPreview({ rendered: "", error: String(e) });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [pid, template, attributes, label]);

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

  async function save() {
    if (jsonMode) {
      try {
        const parsed = JSON.parse(jsonText || "{}");
        if (!isPlainObject(parsed)) throw new Error("Ожидается объект");
      } catch (e) {
        setMsg(`Некорректный JSON: ${String(e)}`);
        return;
      }
    }
    setSaving(true);
    setMsg(null);
    try {
      await api.updateEntity(pid, eid, { label, picture, type_id: typeId, attributes });
      setMsg("Сохранено");
      entity.reload();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (entity.loading) return <p className="muted">Загрузка…</p>;
  if (entity.error) return <p className="error">{entity.error}</p>;

  return (
    <div>
      <div className="crumbs">
        <Link to="/">Проекты</Link> / <Link to={`/projects/${pid}`}>Проект</Link> /{" "}
        {entity.data?.label}
      </div>

      <div className="row spread">
        <h1>{label || "Сущность"}</h1>
        <button className="primary" disabled={saving} onClick={save}>
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
      {msg && <div className={msg === "Сохранено" ? "muted" : "error"}>{msg}</div>}

      <div className="row" style={{ gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 460px", minWidth: 320 }}>
          <div>
            <label>Название</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label>Тип</label>
              <select
                value={typeId ?? ""}
                onChange={(e) => setTypeId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— без типа —</option>
                {types.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Картинка (URL)</label>
              <input value={picture} onChange={(e) => setPicture(e.target.value)} />
            </div>
          </div>

          {/* --- атрибуты --- */}
          <div className="section">
            <div className="row spread">
              <label style={{ margin: 0 }}>Атрибуты</label>
              <div className="row" style={{ gap: 6 }}>
                <button className="ghost" onClick={() => switchMode(!jsonMode)}>
                  {jsonMode ? "← Поля" : "JSON →"}
                </button>
                {!jsonMode && (
                  <button className="ghost" onClick={() => setRows([...rows, { key: "", value: "" }])}>
                    + атрибут
                  </button>
                )}
              </div>
            </div>

            {!jsonMode && (
              <>
                <p className="muted" style={{ fontSize: 13 }}>
                  Вложенность — через точку: <code>ВС.людские_ресурсы</code>. В шаблоне:{" "}
                  <code>{"{{ ВС.людские_ресурсы }}"}</code>
                </p>
                {rows.map((r, i) => (
                  <div className="kv-row" key={i} style={{ marginTop: 8 }}>
                    <input
                      placeholder="ключ или путь.через.точку"
                      value={r.key}
                      onChange={(e) =>
                        setRows(rows.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)))
                      }
                    />
                    <input
                      placeholder="значение"
                      value={r.value}
                      onChange={(e) =>
                        setRows(rows.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))
                      }
                    />
                    <button
                      className="ghost danger"
                      onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {rows.length === 0 && <p className="muted">Атрибутов нет.</p>}
              </>
            )}

            {jsonMode && (
              <>
                <p className="muted" style={{ fontSize: 13 }}>
                  Полный JSON атрибутов — удобно для глубокой вложенности и списков.
                </p>
                <textarea
                  value={jsonText}
                  style={{ minHeight: 260 }}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    try {
                      JSON.parse(e.target.value || "{}");
                      setJsonError(null);
                    } catch (err) {
                      setJsonError(String(err));
                    }
                  }}
                />
                {jsonError && <div className="error">{jsonError}</div>}
              </>
            )}
          </div>
        </div>

        {/* --- предпросмотр --- */}
        <div style={{ flex: "1 1 320px", minWidth: 280, position: "sticky", top: 16 }}>
          <label>Предпросмотр embed (как в Discord /me-info)</label>
          {!template && <p className="muted">У типа нет шаблона.</p>}
          {preview?.error ? (
            <div className="error">{preview.error}</div>
          ) : (
            <div className="embed-preview">{preview?.rendered || " "}</div>
          )}
        </div>
      </div>

      {/* --- игроки, связи и каналы: сохраняются сразу, отдельно от полей выше --- */}
      <div className="stack" style={{ marginTop: 24 }}>
        <MembersSection projectId={pid} entityId={eid} onChanged={() => entity.reload()} />
        <RelationsSection projectId={pid} entityId={eid} entities={allEntities.data ?? []} />
        <ChannelsSection projectId={pid} entityId={eid} />
      </div>
    </div>
  );
}
