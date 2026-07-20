import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import type { Entity, EntityType, TemplatePreview } from "../types";

interface AttrRow {
  key: string;
  value: string;
}

function attrsToRows(attrs: Record<string, unknown>): AttrRow[] {
  return Object.entries(attrs).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

function rowsToAttrs(rows: AttrRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, value } of rows) {
    if (!key.trim()) continue;
    // число/булево/массив — как JSON, иначе строка.
    try {
      out[key] = JSON.parse(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function EntityPage() {
  const { projectId, entityId } = useParams();
  const pid = Number(projectId);
  const eid = Number(entityId);

  const entity = useAsync<Entity>(() => api.getEntity(pid, eid), [pid, eid]);
  const types = useAsync<EntityType[]>(() => api.listTypes(pid), [pid]);

  const [label, setLabel] = useState("");
  const [picture, setPicture] = useState("");
  const [typeId, setTypeId] = useState<number | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [rows, setRows] = useState<AttrRow[]>([]);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Инициализация формы из загруженной сущности.
  useEffect(() => {
    if (!entity.data) return;
    setLabel(entity.data.label);
    setPicture(entity.data.picture);
    setTypeId(entity.data.type_id);
    setPlayerId(entity.data.assignment?.player_id?.toString() ?? "");
    setRows(attrsToRows(entity.data.attributes));
  }, [entity.data]);

  const template = useMemo(
    () => types.data?.find((t) => t.id === typeId)?.attributes_template ?? "",
    [types.data, typeId],
  );

  // Живой предпросмотр embed.
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const res = await api.previewTemplate(pid, {
          template,
          attributes: rowsToAttrs(rows),
          label,
        });
        setPreview(res);
      } catch (e) {
        setPreview({ rendered: "", error: String(e) });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [pid, template, rows, label]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await api.updateEntity(pid, eid, {
        label,
        picture,
        type_id: typeId,
        attributes: rowsToAttrs(rows),
      });
      const pid_num = playerId.trim() === "" ? null : Number(playerId);
      await api.assignPlayer(pid, eid, Number.isNaN(pid_num as number) ? null : pid_num);
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
        {/* Левая колонка — поля */}
        <div style={{ flex: "1 1 420px", minWidth: 320 }}>
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
              <label>Игрок (Discord ID)</label>
              <input
                value={playerId}
                placeholder="пусто = не закреплён"
                onChange={(e) => setPlayerId(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label>Картинка (URL)</label>
            <input value={picture} onChange={(e) => setPicture(e.target.value)} />
          </div>

          <div className="section">
            <div className="row spread">
              <label style={{ margin: 0 }}>Атрибуты</label>
              <button className="ghost" onClick={() => setRows([...rows, { key: "", value: "" }])}>
                + атрибут
              </button>
            </div>
            {rows.map((r, i) => (
              <div className="kv-row" key={i} style={{ marginTop: 8 }}>
                <input
                  placeholder="ключ"
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
          </div>
        </div>

        {/* Правая колонка — предпросмотр embed */}
        <div style={{ flex: "1 1 320px", minWidth: 280 }}>
          <label>Предпросмотр embed (как в Discord /me-info)</label>
          {!template && <p className="muted">У типа нет шаблона.</p>}
          {preview?.error ? (
            <div className="error">{preview.error}</div>
          ) : (
            <div className="embed-preview">{preview?.rendered || " "}</div>
          )}
        </div>
      </div>
    </div>
  );
}
