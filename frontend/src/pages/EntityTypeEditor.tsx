import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import { AttributesEditor, attrPaths } from "../components/AttributesEditor";
import { PagesEditor, pageColors, pageTexts, toPages } from "../components/PagesEditor";
import type { Page } from "../components/PagesEditor";
import { buildSuggestions } from "../components/suggestions";
import { ComputedEditor } from "../components/ComputedEditor";
import { EntityCard } from "../components/EntityCard";
import { Hint } from "../components/Hint";
import { useWideLayout } from "../components/Layout";
import { useToast } from "../components/Feedback";
import type { ComputedField, EntityType, TemplatePages } from "../types";

/** Заготовка для нового типа: показывает и вложенность, и списки. */
const SAMPLE_SCHEMA: Record<string, unknown> = {
  столица: "Москва",
  население: 146000000,
  ВС: { людские_ресурсы: 900000, танки: 2100 },
  духи: [],
  гигаструктуры: [],
};

const DEFAULT_PAGE: Page[] = [{ text: `**{{ label }}**
Столица: {{ столица }}
Население: {{ население }}

**Вооружённые силы**
Личный состав: {{ ВС.людские_ресурсы }}
Танки: {{ ВС.танки }}`, color: "" }];

/** Типы связей для меню вставки: у типа нет своих связей, показываем частые. */
const RELATION_HINTS = ["союзник", "война", "состав"];

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
  useWideLayout();

  const types = useAsync<EntityType[]>(() => api.listTypes(pid), [pid]);
  const existing = isNew ? null : types.data?.find((t) => t.id === Number(typeId)) ?? null;

  const [tab, setTab] = useState<Tab>("pages");
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [pages, setPages] = useState<Page[]>(DEFAULT_PAGE);
  const [computed, setComputed] = useState<ComputedField[]>([]);
  // Через него редактор формул вставляет {{ выч.путь }} в страницу описания.
  const insertRef = useRef<((text: string) => void) | null>(null);
  // Структура атрибутов: и заготовка для новых сущностей, и данные предпросмотра.
  const [schema, setSchema] = useState<Record<string, unknown>>(SAMPLE_SCHEMA);
  // Растёт при загрузке типа — по нему редактор атрибутов пересобирает строки.
  const [schemaVersion, setSchemaVersion] = useState(0);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TemplatePages | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  // Заполняем форму, когда тип подгрузился; правки пользователя не затираем.
  useEffect(() => {
    if (loaded || !existing) return;
    setLabel(existing.label);
    setSlug(existing.slug);
    // У типов, созданных до появления страниц, описание лежит одной строкой.
    const saved = existing.description_pages ?? [];
    setPages(
      toPages(
        saved.length > 0 ? saved : [existing.attributes_template || ""],
        existing.page_colors ?? [],
      ),
    );
    setComputed(existing.computed ?? []);
    // У типов, созданных до появления структуры, она пустая — показываем заготовку.
    const savedSchema = existing.attributes_schema ?? {};
    setSchema(Object.keys(savedSchema).length > 0 ? savedSchema : SAMPLE_SCHEMA);
    setSchemaVersion((v) => v + 1);
    setLoaded(true);
  }, [existing, loaded]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        setPreview(
          await api.previewPages(pid, {
            pages: pageTexts(pages),
            page_colors: pageColors(pages),
            attributes: schema,
            label: label || "Пример",
            computed,
          }),
        );
      } catch (e) {
        setPreview({ pages: [], limit: 2000, error: String(e), computed: [] });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [pages, schema, label, computed, pid]);

  async function save() {
    if (schemaError) {
      // Иначе сохранился бы предыдущий вариант структуры, а мастер бы решил,
      // что вставленный JSON принят.
      setTab("schema");
      toast.err(`Атрибуты не разобраны: ${schemaError}`);
      return;
    }
    setBusy(true);
    const payload = {
      label,
      slug,
      description_pages: pageTexts(pages),
      page_colors: pageColors(pages),
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
              scope="type"
              insertRef={insertRef}
              rendered={preview?.pages}
              limit={preview?.limit ?? 2000}
              suggestions={buildSuggestions({
                attributes: schema,
                computed,
                values: preview?.computed,
                relationTypes: RELATION_HINTS,
              })}
              hint={
                <Hint id="type-pages">
                  Jinja2 с кириллицей: <code>{"{{ население }}"}</code>. Вложенность через точку:{" "}
                  <code>{"{{ ВС.людские_ресурсы }}"}</code>. Отсутствующий атрибут просто останется
                  пустым. Атрибут-список сам печатается через запятую, а иначе:{" "}
                  <code>{"{{ духи | список }}"}</code>,{" "}
                  <code>{"{{ духи | нумерованный }}"}</code>,{" "}
                  <code>{'{{ союзники | через_запятую(пусто="нет") }}'}</code>,{" "}
                  <code>{"{{ духи | сколько }}"}</code>, а для списка объектов —{" "}
                  <code>{'{{ гигаструктуры | строки("{название} — {мощь}") }}'}</code>. Страницы
                  игрок листает в Discord кнопками. Правая кнопка мыши в поле — вставить
                  атрибут, формулу или особую переменную (игроки, связи); цвет полосы
                  эмбеда задаётся для каждой страницы отдельно. Особые переменные в
                  предпросмотре показаны на примере — у типа своих игроков и связей нет.
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
                paths={attrPaths(schema)}
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
                подсказки путей в формулах. Вложенность — через точку (<code>ВС.танки</code>),
                кнопка <code>☰</code> делает атрибут списком, переключатель <b>группы</b>{" "}
                разбивает список по 1–3 уровням пути (<code>ЭКН.энергия.запас</code> при
                глубине 2 — «ЭКН» → «энергия»), а режим <b>JSON</b> показывает всю структуру
                целиком — им удобно переносить заготовку между типами.
              </Hint>
              <AttributesEditor
                initial={schema}
                version={schemaVersion}
                scope="type"
                onChange={setSchema}
                onError={setSchemaError}
              />
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
