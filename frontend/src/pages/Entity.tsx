import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import { PingBell } from "../components/PingBell";
import { JsonEditor } from "../components/JsonEditor";
import { PagesEditor, PagesPreview } from "../components/PagesEditor";
import type { Entity, EntityPingCount, EntityType, TemplatePages } from "../types";
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

/** Загруженный файл лежит на backend — в дашборде его отдаёт /api. */
function pictureSrc(value: string): string {
  return value.startsWith("/") ? `/api${value}` : value;
}

/** Картинка сущности: ссылка или загруженный файл. */
function PictureField({
  projectId,
  value,
  onChange,
}: {
  projectId: number;
  value: string;
  onChange: (v: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const att = await api.uploadAttachment(projectId, file);
      onChange(att.url);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="row spread">
        <label style={{ margin: 0 }}>Картинка сущности</label>
        <div className="row" style={{ gap: 6 }}>
          <button className="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Загрузка…" : "Загрузить файл"}
          </button>
          {value && (
            <button className="ghost danger" onClick={() => onChange("")}>
              Убрать
            </button>
          )}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Аватарка сущности в карточке и в сообщениях, отправленных от её лица.
        Загруженный файл Discord увидит, только если у backend задан PUBLIC_BASE_URL;
        иначе надёжнее вставить внешнюю ссылку.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => upload(e.target.files)}
      />
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        {value && (
          <img
            src={pictureSrc(value)}
            alt=""
            style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover" }}
          />
        )}
        <input
          value={value}
          placeholder="https://… или загрузите файл"
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}

export function EntityPage() {
  const { projectId, entityId } = useParams();
  const pid = Number(projectId);
  const eid = Number(entityId);

  const entity = useAsync<Entity>(() => api.getEntity(pid, eid), [pid, eid]);
  const types = useAsync<EntityType[]>(() => api.listTypes(pid), [pid]);
  // Список сущностей проекта нужен для выбора второй стороны связи.
  const allEntities = useAsync<Entity[]>(() => api.listEntities(pid), [pid]);
  const pings = useAsync<EntityPingCount[]>(
    () => api.entityPingCounts(pid).catch(() => []),
    [pid],
  );
  const navigate = useNavigate();
  const pingCount = pings.data?.find((p) => p.entity_id === eid)?.unread ?? 0;

  const [label, setLabel] = useState("");
  const [picture, setPicture] = useState("");
  const [typeId, setTypeId] = useState<number | null>(null);
  const [rows, setRows] = useState<AttrRow[]>([]);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TemplatePages | null>(null);
  const [custom, setCustom] = useState(false);
  const [customPages, setCustomPages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!entity.data) return;
    setLabel(entity.data.label);
    setPicture(entity.data.picture);
    setTypeId(entity.data.type_id);
    setRows(flatten(entity.data.attributes));
    setJsonText(JSON.stringify(entity.data.attributes, null, 2));
    setCustom(entity.data.use_custom_description);
    setCustomPages(entity.data.description_pages ?? []);
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

  const type = useMemo(
    () => types.data?.find((t) => t.id === typeId) ?? null,
    [types.data, typeId],
  );

  // Что реально увидят в Discord: особое описание замещает страницы типа.
  const pages = useMemo(() => {
    if (custom) return customPages;
    if (!type) return [];
    const fromType = type.description_pages ?? [];
    return fromType.length > 0 ? fromType : [type.attributes_template || ""];
  }, [custom, customPages, type]);

  // Живой предпросмотр embed.
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        setPreview(await api.previewPages(pid, { pages, attributes, label }));
      } catch (e) {
        setPreview({ pages: [], limit: 2000, error: String(e) });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [pid, pages, attributes, label]);

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
      await api.updateEntity(pid, eid, {
        label,
        picture,
        type_id: typeId,
        attributes,
        use_custom_description: custom,
        description_pages: customPages,
      });
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

      <header className="page-header">
        {picture && <img className="entity-picture" src={pictureSrc(picture)} alt="" />}
        <div className="page-header-text">
          <h1>
            {label || "Сущность"}
            <PingBell count={pingCount} />
          </h1>
          <p className="muted">
            {type?.label ?? "без типа"}
            {entity.data?.members.length
              ? ` · ${entity.data.members.length} ${
                  entity.data.members.length === 1 ? "игрок" : "игроков"
                }`
              : ""}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="ghost"
            onClick={() => navigate(`/projects/${pid}/posts/new?entity=${eid}`)}
          >
            Написать верд
          </button>
          <button className="primary" disabled={saving} onClick={save}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </header>
      {msg && <div className={msg === "Сохранено" ? "muted" : "error"}>{msg}</div>}

      <div className="entity-layout">
        <div className="stack">
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Основное</h3>
            <div>
              <label>Название</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div>
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
            <PictureField projectId={pid} value={picture} onChange={setPicture} />
          </section>

          {/* --- особое описание вместо шаблона типа --- */}
          <section className="card">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>Особое описание</h3>
              <label className="row" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={custom}
                  style={{ width: "auto", marginRight: 8 }}
                  onChange={(e) => {
                    // Включили впервые — начинаем со страниц типа, чтобы было что править.
                    if (e.target.checked && customPages.length === 0) setCustomPages(pages);
                    setCustom(e.target.checked);
                  }}
                />
                включить
              </label>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              {custom
                ? "Эти страницы полностью замещают описание, которое даёт тип."
                : `Сейчас описание берётся из типа${type ? ` «${type.label}»` : ""}. Включите, чтобы задать своё.`}
            </p>
            {custom && (
              <PagesEditor
                pages={customPages}
                onChange={setCustomPages}
                rendered={preview?.pages}
                limit={preview?.limit ?? 2000}
                hint={
                  <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                    Атрибуты подставляются так же, как в типе: <code>{"{{ население }}"}</code>.
                    Каждая страница — отдельный эмбед.
                  </p>
                }
              />
            )}
          </section>

          {/* --- атрибуты --- */}
          <section className="card">
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
                  Tab — отступ, Shift+Tab — снять, Escape затем Tab — выйти из поля.
                </p>
                <JsonEditor
                  value={jsonText}
                  onChange={(v) => {
                    setJsonText(v);
                    try {
                      JSON.parse(v || "{}");
                      setJsonError(null);
                    } catch (err) {
                      setJsonError(String(err));
                    }
                  }}
                />
                {jsonError && <div className="error">{jsonError}</div>}
              </>
            )}
          </section>

          {/* --- игроки, связи и каналы: сохраняются сразу, отдельно от полей выше --- */}
          <MembersSection projectId={pid} entityId={eid} onChanged={() => entity.reload()} />
          <RelationsSection projectId={pid} entityId={eid} entities={allEntities.data ?? []} />
          <ChannelsSection projectId={pid} entityId={eid} />
        </div>

        {/* --- предпросмотр --- */}
        <aside className="entity-aside">
          <label>Предпросмотр embed (как в Discord /me-info)</label>
          <PagesPreview pages={preview?.pages} error={preview?.error} />
        </aside>
      </div>
    </div>
  );
}
