import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import { JsonEditor } from "../components/JsonEditor";
import { PagesEditor } from "../components/PagesEditor";
import { ComputedEditor } from "../components/ComputedEditor";
import { EntityCard } from "../components/EntityCard";
import { Hint } from "../components/Hint";
import { useToast } from "../components/Feedback";
import type { ComputedField, EntityType, TemplatePages } from "../types";

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

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Пути атрибутов для подсказки в формулах: до листа, списки — целиком. */
function attrPaths(value: unknown, prefix = ""): string[] {
  if (!isPlainObject(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, item]) =>
    attrPaths(item, prefix ? `${prefix}.${key}` : key),
  );
}

type Tab = "pages" | "computed" | "schema";

const TAB_LABEL: Record<Tab, string> = {
  pages: "Описание",
  computed: "Формулы",
  schema: "Атрибуты",
};

/** Полноценная страница создания и редактирования типа сущности. */
export function EntityTypeEditorPage() {
  const { projectId, typeId } = useParams();
  const pid = Number(projectId);
  const isNew = typeId === "new";
  const navigate = useNavigate();
  const toast = useToast();

  const types = useAsync<EntityType[]>(() => api.listTypes(pid), [pid]);
  const existing = isNew ? null : types.data?.find((t) => t.id === Number(typeId)) ?? null;

  const [tab, setTab] = useState<Tab>("pages");
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [pages, setPages] = useState<string[]>([DEFAULT_TEMPLATE]);
  const [computed, setComputed] = useState<ComputedField[]>([]);
  // Через него редактор формул вставляет {{ выч.путь }} в страницу описания.
  const insertRef = useRef<((text: string) => void) | null>(null);
  // Структура атрибутов: и заготовка для новых сущностей, и данные предпросмотра.
  const [sample, setSample] = useState(SAMPLE_HINT);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TemplatePages | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Разобранная структура атрибутов — из неё берутся подсказки путей для формул.
  const parsedSample = useMemo(() => {
    try {
      return sample.trim() ? JSON.parse(sample) : {};
    } catch {
      return {};
    }
  }, [sample]);
  const [busy, setBusy] = useState(false);

  // Заполняем форму, когда тип подгрузился; правки пользователя не затираем.
  useEffect(() => {
    if (loaded || !existing) return;
    setLabel(existing.label);
    setSlug(existing.slug);
    // У типов, созданных до появления страниц, описание лежит одной строкой.
    const saved = existing.description_pages ?? [];
    setPages(saved.length > 0 ? saved : [existing.attributes_template || ""]);
    setComputed(existing.computed ?? []);
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
        setPreview({
          pages: [],
          limit: 2000,
          error: "Некорректный JSON атрибутов",
          computed: [],
        });
        return;
      }
      try {
        setPreview(
          await api.previewPages(pid, {
            pages,
            attributes: attrs,
            label: label || "Пример",
            computed,
          }),
        );
      } catch (e) {
        setPreview({ pages: [], limit: 2000, error: String(e), computed: [] });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [pages, sample, label, computed, pid]);

  async function save() {
    let schema: Record<string, unknown>;
    try {
      const parsed = sample.trim() ? JSON.parse(sample) : {};
      if (!isPlainObject(parsed)) throw new Error("ожидается объект");
      schema = parsed;
    } catch (e) {
      setTab("schema");
      toast.err(`Структура атрибутов — некорректный JSON: ${String(e)}`);
      return;
    }
    setBusy(true);
    const payload = {
      label,
      slug,
      description_pages: pages,
      attributes_schema: schema,
      computed,
    };
    try {
      if (existing) {
        await api.updateType(pid, existing.id, payload);
      } else {
        await api.createType(pid, payload);
      }
      toast.ok(`Тип «${label}» сохранён`);
      navigate(`/projects/${pid}?tab=types`);
    } catch (e) {
      toast.err(e);
      setBusy(false);
    }
  }

  const calcErrors = (preview?.computed ?? []).filter((v) => v.error).length;

  if (!isNew && types.loading) return <p className="muted">Загрузка…</p>;
  if (!isNew && !existing && types.data) return <p className="error">Тип не найден</p>;

  return (
    <div>
      <div className="crumbs">
        <Link to="/">Серверы</Link> /{" "}
        <Link to={`/projects/${pid}?tab=types`}>Типы сущностей</Link> /{" "}
        {isNew ? "новый тип" : existing?.label}
      </div>

      <header className="page-header">
        <div className="page-header-text">
          <h1>{isNew ? "Новый тип" : label || "Тип сущности"}</h1>
          <p className="muted">
            Общий вид карточки и правила расчёта для всех сущностей этого типа.
          </p>
        </div>
        <button className="primary" disabled={busy || !label || !slug} onClick={save}>
          {busy ? "Сохранение…" : "Сохранить"}
        </button>
      </header>

      <div className="entity-layout">
        <div className="stack">
          <div className="fields two">
            <div className="field">
              <label>Название</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="field">
              <label>slug</label>
              <input value={slug} placeholder="country" onChange={(e) => setSlug(e.target.value)} />
            </div>
          </div>

          <div className="subtabs">
            {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
              <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
                {TAB_LABEL[key]}
                {key === "computed" && computed.length > 0 && (
                  <span className="calc-badge" style={{ marginLeft: 6 }}>
                    {calcErrors > 0 ? `⚠ ${calcErrors}` : computed.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === "pages" && (
            <PagesEditor
              pages={pages}
              onChange={setPages}
              insertRef={insertRef}
              rendered={preview?.pages}
              limit={preview?.limit ?? 2000}
              hint={
                <Hint id="type-pages">
                  Jinja2 с кириллицей: <code>{"{{ население }}"}</code>. Вложенность через точку:{" "}
                  <code>{"{{ ВС.людские_ресурсы }}"}</code>. Отсутствующий атрибут просто останется
                  пустым. Страницы игрок листает в Discord кнопками — так статы длиннее лимита
                  эмбеда всё-таки помещаются.
                </Hint>
              }
            />
          )}

          {tab === "computed" && (
            <div className="stack tight">
              <Hint id="type-computed">
                Формула считается от атрибутов сущности:{" "}
                <code>казна.прирост - казна.расход</code>, <code>длина(духи)</code>,{" "}
                <code>сумма(гигаструктуры, "мощь")</code>. Путь с точками собирается в дерево — в
                шаблоне это <code>{"{{ выч.бюджет.деньги }}"}</code>, а вся ветка сразу —{" "}
                <code>{"{{ выч.бюджет | поля }}"}</code>. Одна формула может ссылаться на другую, а
                отдельная сущность — переопределить любую из них у себя.
              </Hint>
              <ComputedEditor
                fields={computed}
                onChange={setComputed}
                values={preview?.computed}
                paths={attrPaths(parsedSample)}
                onInsert={(text) => {
                  insertRef.current?.(text);
                  toast.ok("Вставлено в описание");
                }}
              />
            </div>
          )}

          {tab === "schema" && (
            <div className="stack tight">
              <Hint id="type-schema">
                Новая сущность этого типа создаётся сразу с этими полями и значениями — их
                останется только заполнить. Отсюда же берутся данные для предпросмотра справа и
                подсказки путей в формулах.
              </Hint>
              <JsonEditor
                value={sample}
                minHeight={280}
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
          )}
        </div>

        <aside className="entity-aside">
          <h2 className="section-title">Карточка игрока (/me-info)</h2>
          <EntityCard
            label={label || "Пример"}
            picture=""
            pages={preview?.pages}
            error={preview?.error}
            limit={preview?.limit ?? 2000}
          />
        </aside>
      </div>
    </div>
  );
}
