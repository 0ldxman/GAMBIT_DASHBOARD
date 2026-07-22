import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import { JsonEditor } from "../components/JsonEditor";
import { PagesEditor, PagesPreview } from "../components/PagesEditor";
import type { EntityType, TemplatePages } from "../types";

const SAMPLE_HINT = `{
  "столица": "Москва",
  "население": 146000000,
  "ВС": {
    "людские_ресурсы": 900000,
    "танки": 2100
  }
}`;

const DEFAULT_TEMPLATE = `**{{ label }}**
Столица: {{ столица }}
Население: {{ население }}

**Вооружённые силы**
Личный состав: {{ ВС.людские_ресурсы }}
Танки: {{ ВС.танки }}`;

/** Полноценная страница создания и редактирования типа сущности. */
export function EntityTypeEditorPage() {
  const { projectId, typeId } = useParams();
  const pid = Number(projectId);
  const isNew = typeId === "new";
  const navigate = useNavigate();

  const types = useAsync<EntityType[]>(() => api.listTypes(pid), [pid]);
  const existing = isNew ? null : types.data?.find((t) => t.id === Number(typeId)) ?? null;

  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [pages, setPages] = useState<string[]>([DEFAULT_TEMPLATE]);
  // Структура атрибутов: и заготовка для новых сущностей, и данные предпросмотра.
  const [sample, setSample] = useState(SAMPLE_HINT);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TemplatePages | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Заполняем форму, когда тип подгрузился; правки пользователя не затираем.
  useEffect(() => {
    if (loaded || !existing) return;
    setLabel(existing.label);
    setSlug(existing.slug);
    // У типов, созданных до появления страниц, описание лежит одной строкой.
    const saved = existing.description_pages ?? [];
    setPages(saved.length > 0 ? saved : [existing.attributes_template || ""]);
    // У типов, созданных до появления структуры, она пустая — показываем подсказку.
    const schema = existing.attributes_schema ?? {};
    setSample(Object.keys(schema).length > 0 ? JSON.stringify(schema, null, 2) : SAMPLE_HINT);
    setLoaded(true);
  }, [existing, loaded]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      let attrs: Record<string, unknown> = {};
      try {
        attrs = sample.trim() ? JSON.parse(sample) : {};
      } catch {
        setPreview({ pages: [], limit: 2000, error: "Некорректный JSON атрибутов" });
        return;
      }
      try {
        setPreview(
          await api.previewPages(pid, { pages, attributes: attrs, label: label || "Пример" }),
        );
      } catch (e) {
        setPreview({ pages: [], limit: 2000, error: String(e) });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [pages, sample, label, pid]);

  async function save() {
    let schema: Record<string, unknown>;
    try {
      const parsed = sample.trim() ? JSON.parse(sample) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("ожидается объект");
      }
      schema = parsed;
    } catch (e) {
      setErr(`Структура атрибутов — некорректный JSON: ${String(e)}`);
      return;
    }
    setBusy(true);
    setErr(null);
    const payload = {
      label,
      slug,
      description_pages: pages,
      attributes_schema: schema,
    };
    try {
      if (existing) {
        await api.updateType(pid, existing.id, payload);
      } else {
        await api.createType(pid, payload);
      }
      navigate(`/projects/${pid}?tab=types`);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  if (!isNew && types.loading) return <p className="muted">Загрузка…</p>;
  if (!isNew && !existing && types.data) return <p className="error">Тип не найден</p>;

  return (
    <div>
      <div className="crumbs">
        <Link to="/">Серверы</Link> /{" "}
        <Link to={`/projects/${pid}?tab=types`}>Типы сущностей</Link> /{" "}
        {isNew ? "новый тип" : existing?.label}
      </div>

      <div className="row spread">
        <h1>{isNew ? "Новый тип" : label || "Тип сущности"}</h1>
        <button className="primary" disabled={busy || !label || !slug} onClick={save}>
          {busy ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="row" style={{ gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 460px", minWidth: 320 }}>
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label>Название</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label>slug</label>
              <input
                value={slug}
                placeholder="country"
                onChange={(e) => setSlug(e.target.value)}
              />
            </div>
          </div>

          <div className="section">
            <PagesEditor
              pages={pages}
              onChange={setPages}
              rendered={preview?.pages}
              limit={preview?.limit ?? 2000}
              hint={
                <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                  Jinja2 с кириллицей: <code>{"{{ население }}"}</code>. Вложенность через
                  точку: <code>{"{{ ВС.людские_ресурсы }}"}</code>. Отсутствующий атрибут
                  просто останется пустым. Каждая страница уходит в Discord отдельным
                  эмбедом — так статы длиннее лимита всё-таки помещаются.
                </p>
              }
            />
          </div>

          <div className="section">
            <label>Структура атрибутов (JSON)</label>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Новая сущность этого типа создаётся сразу с этими полями и значениями —
              их останется только заполнить. Здесь же берутся данные для предпросмотра
              справа.
            </p>
            <JsonEditor
              value={sample}
              minHeight={200}
              onChange={(v) => {
                setSample(v);
                try {
                  JSON.parse(v || "{}");
                  setSampleError(null);
                } catch (e) {
                  setSampleError(String(e));
                }
              }}
            />
            {sampleError && <div className="error">{sampleError}</div>}
          </div>
        </div>

        <div style={{ flex: "1 1 320px", minWidth: 280, position: "sticky", top: 16 }}>
          <label>Предпросмотр (как в Discord /me-info)</label>
          <PagesPreview pages={preview?.pages} error={preview?.error} />
        </div>
      </div>
    </div>
  );
}
