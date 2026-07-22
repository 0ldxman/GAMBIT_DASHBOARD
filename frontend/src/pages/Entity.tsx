import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAsync, useChanges } from "../hooks";
import { PingBell } from "../components/PingBell";
import { AttributesEditor, attrPaths } from "../components/AttributesEditor";
import { PagesEditor, pageColors, pageTexts, toPages } from "../components/PagesEditor";
import type { Page } from "../components/PagesEditor";
import { buildSuggestions } from "../components/suggestions";
import { ComputedEditor } from "../components/ComputedEditor";
import { EntityCard } from "../components/EntityCard";
import { Section } from "../components/Section";
import { Hint } from "../components/Hint";
import { SaveBar } from "../components/SaveBar";
import { useWideLayout } from "../components/Layout";
import { useToast } from "../components/Feedback";
import type {
  ComputedField,
  Entity,
  EntityPingCount,
  EntityType,
  Project,
  Relation,
  TemplatePages,
} from "../types";
import { MembersSection } from "./entity/MembersSection";
import { RelationsSection } from "./entity/RelationsSection";
import { ChannelsSection } from "./entity/ChannelsSection";

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
  const toast = useToast();

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const att = await api.uploadAttachment(projectId, file);
      onChange(att.url);
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="field">
      <label>Картинка сущности</label>
      <Hint id="entity-picture">
        Аватарка сущности в карточке и в сообщениях, отправленных от её лица. Загруженный файл
        Discord увидит, только если у backend задан <code>PUBLIC_BASE_URL</code>; иначе надёжнее
        вставить внешнюю ссылку.
      </Hint>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => upload(e.target.files)}
      />
      <div className="row">
        {value && (
          <img
            src={pictureSrc(value)}
            alt=""
            style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }}
          />
        )}
        <input
          className="grow"
          value={value}
          placeholder="https://… или загрузите файл"
          onChange={(e) => onChange(e.target.value)}
        />
        <button className="ghost small" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "Загрузка…" : "Файл"}
        </button>
        {value && (
          <button className="ghost small danger" onClick={() => onChange("")}>
            Убрать
          </button>
        )}
      </div>
    </div>
  );
}

type Tab = "data" | "look" | "access";

const TAB_LABEL: Record<Tab, string> = {
  data: "Данные",
  look: "Оформление",
  access: "Доступ",
};

export function EntityPage() {
  const { projectId, entityId } = useParams();
  const pid = Number(projectId);
  const eid = Number(entityId);

  const entity = useAsync<Entity>(() => api.getEntity(pid, eid), [pid, eid]);
  const project = useAsync<Project>(() => api.getProject(pid), [pid]);
  const types = useAsync<EntityType[]>(() => api.listTypes(pid), [pid]);
  // Список сущностей проекта нужен для выбора второй стороны связи.
  const allEntities = useAsync<Entity[]>(() => api.listEntities(pid), [pid]);
  // Типы связей этой сущности — из них собираются пункты меню вставки.
  const relations = useAsync<Relation[]>(
    () => api.listRelations(pid, eid).catch(() => []),
    [pid, eid],
  );
  const pings = useAsync<EntityPingCount[]>(
    () => api.entityPingCounts(pid).catch(() => []),
    [pid],
  );
  const navigate = useNavigate();
  const toast = useToast();
  useWideLayout();
  const pingCount = pings.data?.find((p) => p.entity_id === eid)?.unread ?? 0;

  const [tab, setTab] = useState<Tab>("data");
  const [label, setLabel] = useState("");
  const [picture, setPicture] = useState("");
  const [typeId, setTypeId] = useState<number | null>(null);
  const [attributes, setAttributes] = useState<Record<string, unknown>>({});
  // Растёт при загрузке и сбросе — по нему редактор атрибутов пересобирает строки.
  const [attrVersion, setAttrVersion] = useState(0);
  const [attrError, setAttrError] = useState<string | null>(null);
  const [computed, setComputed] = useState<ComputedField[]>([]);
  const [preview, setPreview] = useState<TemplatePages | null>(null);
  const [custom, setCustom] = useState(false);
  const [customPages, setCustomPages] = useState<Page[]>([]);
  const [saving, setSaving] = useState(false);

  function fillFrom(data: Entity) {
    setLabel(data.label);
    setPicture(data.picture);
    setTypeId(data.type_id);
    setAttributes(data.attributes);
    setComputed(data.computed ?? []);
    setCustom(data.use_custom_description);
    setCustomPages(toPages(data.description_pages ?? [], data.page_colors ?? []));
    setAttrVersion((v) => v + 1);
  }

  useEffect(() => {
    if (entity.data) fillFrom(entity.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.data]);

  const type = useMemo(
    () => types.data?.find((t) => t.id === typeId) ?? null,
    [types.data, typeId],
  );
  const relationTypes = useMemo(
    () => [...new Set((relations.data ?? []).map((r) => r.relation_type))],
    [relations.data],
  );

  // Что реально увидят в Discord: особое описание замещает страницы типа.
  const pages = useMemo<Page[]>(() => {
    if (custom) return customPages;
    if (!type) return [];
    const fromType = type.description_pages ?? [];
    const texts = fromType.length > 0 ? fromType : [type.attributes_template || ""];
    return toPages(texts, type.page_colors ?? []);
  }, [custom, customPages, type]);

  // Живой предпросмотр: страницы и значения формул на текущих, ещё не
  // сохранённых атрибутах.
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        setPreview(
          await api.previewPages(pid, {
            pages: pageTexts(pages),
            page_colors: pageColors(pages),
            attributes,
            label,
            // Игроки и связи берутся у настоящей сущности, а не с примера.
            entity_id: eid,
            computed: type?.computed ?? [],
            computed_own: computed,
          }),
        );
      } catch (e) {
        setPreview({ pages: [], limit: 2000, error: String(e), computed: [] });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [pid, eid, pages, attributes, label, type, computed]);

  const changed = useChanges(
    {
      label,
      picture,
      type_id: typeId,
      attributes,
      use_custom_description: custom,
      description_pages: pageTexts(customPages),
      page_colors: pageColors(customPages),
      computed,
    },
    entity.data,
    {
      label: "название",
      picture: "картинка",
      type_id: "тип",
      attributes: "атрибуты",
      use_custom_description: "описание",
      description_pages: "описание",
      page_colors: "описание",
      computed: "формулы",
    },
  );

  async function save() {
    if (attrError) {
      // Иначе сохранились бы прежние атрибуты, а мастер бы решил, что
      // вставленный в режиме JSON текст принят.
      setTab("data");
      toast.err(`Атрибуты не разобраны: ${attrError}`);
      return;
    }
    setSaving(true);
    try {
      await api.updateEntity(pid, eid, {
        label,
        picture,
        type_id: typeId,
        attributes,
        use_custom_description: custom,
        description_pages: pageTexts(customPages),
        page_colors: pageColors(customPages),
        computed,
      });
      toast.ok("Сохранено");
      entity.reload();
    } catch (e) {
      toast.err(e);
    } finally {
      setSaving(false);
    }
  }

  const calcErrors = (preview?.computed ?? []).filter((v) => v.error).length;
  const ownCount = computed.length;
  const typeCount = type?.computed?.length ?? 0;

  if (entity.loading) return <p className="muted">Загрузка…</p>;
  if (entity.error) return <p className="error">{entity.error}</p>;

  return (
    <div>
      <div className="crumbs">
        <Link to="/">Серверы</Link>
        {project.data?.guild_id && (
          <>
            {" / "}
            <Link to={`/servers/${project.data.guild_id}`}>сервер</Link>
          </>
        )}
        {" / "}
        <Link to={`/projects/${pid}?tab=entities`}>{project.data?.label ?? "Проект"}</Link>
        {" / "}
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
        <button
          className="ghost"
          onClick={() => navigate(`/projects/${pid}/posts/new?entity=${eid}`)}
        >
          Написать верд
        </button>
      </header>

      <div className="subtabs" style={{ marginBottom: "var(--s4)" }}>
        {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>

      <div className="entity-layout">
        <div className="stack">
          {tab === "data" && (
            <>
              <Section
                id="entity-main"
                title="Основное"
                defaultOpen={false}
                summary={`${type?.label ?? "без типа"}${picture ? " · с картинкой" : ""}`}
              >
                <div className="fields two">
                  <div className="field">
                    <label>Название</label>
                    <input value={label} onChange={(e) => setLabel(e.target.value)} />
                  </div>
                  <div className="field">
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
                </div>
                <PictureField projectId={pid} value={picture} onChange={setPicture} />
              </Section>

              <Section
                id="entity-attrs"
                title="Атрибуты"
                summary={`${Object.keys(attributes).length} верхнего уровня`}
              >
                <Hint id="entity-attrs">
                  Вложенность — через точку: <code>ВС.людские_ресурсы</code>. В шаблоне это{" "}
                  <code>{"{{ ВС.людские_ресурсы }}"}</code>. Значение разбирается как JSON, если
                  получается: <code>1200</code> станет числом. Кнопка <code>☰</code> превращает
                  атрибут в список — тогда он правится по строке на элемент (объект списка
                  пишется одной строкой JSON). Атрибуты сами складываются в дерево по пути:{" "}
                  <code>РЕС.пища.запас</code> и <code>РЕС.пища.расход</code> лягут в «РЕС» →
                  «пища». Переключатель <b>группы</b> ограничивает вложенность одним или двумя
                  уровнями, если дерево не нужно.
                </Hint>
                <AttributesEditor
                  initial={entity.data?.attributes ?? {}}
                  version={attrVersion}
                  onChange={setAttributes}
                  onError={setAttrError}
                />
              </Section>

              <Section
                id="entity-computed"
                title="Вычисляемые"
                warn={calcErrors > 0}
                summary={
                  calcErrors > 0
                    ? `${calcErrors} с ошибкой`
                    : `${typeCount + ownCount} ${ownCount > 0 ? `(своих ${ownCount})` : "из типа"}`
                }
              >
                <Hint id="entity-computed">
                  Формулы считаются по атрибутам выше — прямо сейчас, до сохранения. Типовые
                  правятся в типе сущности, но любую можно переопределить здесь, а можно завести
                  свою: <code>сумма(корабли, "тоннаж")</code>. В шаблоне доступны как{" "}
                  <code>{"{{ выч.бюджет.деньги }}"}</code>.
                </Hint>
                <ComputedEditor
                  fields={computed}
                  onChange={setComputed}
                  inherited={type?.computed ?? []}
                  inheritedFrom={type?.label ?? ""}
                  values={preview?.computed}
                  paths={attrPaths(attributes)}
                />
              </Section>
            </>
          )}

          {tab === "look" && (
            <Section
              id="entity-desc"
              title="Особое описание"
              summary={custom ? `${customPages.length} стр.` : "берётся из типа"}
              actions={
                <label className="check">
                  <input
                    type="checkbox"
                    checked={custom}
                    onChange={(e) => {
                      // Включили впервые — начинаем со страниц типа, чтобы было что править.
                      if (e.target.checked && customPages.length === 0) setCustomPages(pages);
                      setCustom(e.target.checked);
                    }}
                  />
                  включить
                </label>
              }
            >
              <p className="hint">
                {custom
                  ? "Эти страницы полностью замещают описание, которое даёт тип. Формулы при этом остаются общими — и типовые, и свои."
                  : `Сейчас описание берётся из типа${type ? ` «${type.label}»` : ""}. Включите галочку, чтобы задать своё.`}
              </p>
              {custom && (
                <PagesEditor
                  pages={customPages}
                  onChange={setCustomPages}
                  scope="entity"
                  rendered={preview?.pages}
                  limit={preview?.limit ?? 2000}
                  suggestions={buildSuggestions({
                    attributes,
                    // В меню видны и типовые формулы, и собственные.
                    computed: [...(type?.computed ?? []), ...computed],
                    values: preview?.computed,
                    relationTypes,
                  })}
                  hint={
                    <Hint id="entity-pages">
                      Атрибуты подставляются так же, как в типе: <code>{"{{ население }}"}</code>.
                      Страницы игрок листает в Discord кнопками.
                    </Hint>
                  }
                />
              )}
            </Section>
          )}

          {/* Игроки, связи и каналы сохраняются сразу, отдельно от полей выше. */}
          {tab === "access" && (
            <>
              <MembersSection projectId={pid} entityId={eid} onChanged={() => entity.reload()} />
              <RelationsSection projectId={pid} entityId={eid} entities={allEntities.data ?? []} />
              <ChannelsSection projectId={pid} entityId={eid} />
            </>
          )}
        </div>

        <aside className="entity-aside stack">
          <div>
            <h2 className="section-title">Карточка игрока (/me-info)</h2>
            <EntityCard
              label={label}
              picture={picture ? pictureSrc(picture) : ""}
              pages={preview?.pages}
              error={preview?.error}
              limit={preview?.limit ?? 2000}
            />
          </div>
        </aside>
      </div>

      <SaveBar
        dirty={changed.length > 0}
        changed={changed}
        saving={saving}
        onSave={save}
        onReset={() => entity.data && fillFrom(entity.data)}
      />
    </div>
  );
}
