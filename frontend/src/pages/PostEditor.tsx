import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAsync, useChanges, useDebounced } from "../hooks";
import { DiscordPreview } from "../components/DiscordPreview";
import { Modal } from "../components/Modal";
import { Section } from "../components/Section";
import { Hint } from "../components/Hint";
import { SaveBar } from "../components/SaveBar";
import { useConfirm, useToast } from "../components/Feedback";
import type {
  Attachment,
  Channel,
  DiscordChannel,
  EditMode,
  EditPreview,
  Entity,
  EntityEdit,
  EntityEditOp,
  Post,
  PostTemplate,
  TemplateField,
} from "../types";

/** ISO из API → значение для <input type="datetime-local"> в местном времени. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** Местное время из инпута → ISO с зоной, чтобы бот отправил верд вовремя. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const DATE_FMT = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "long",
  timeStyle: "short",
});

const MODE_LABEL: Record<EditMode, string> = {
  set: "=  записать",
  expr: "ƒ  вычислить",
  delete: "✕  удалить",
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Пути атрибутов сущности для автодополнения: до листа, списки — целиком. */
function attrPaths(value: unknown, prefix = ""): string[] {
  if (!isPlainObject(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, item]) =>
    attrPaths(item, prefix ? `${prefix}.${key}` : key),
  );
}

/**
 * Значение режима «записать» приходит из поля строкой. Числа, булевы и списки
 * разбираем как JSON, чтобы они легли в атрибуты нужным типом — одинаково и
 * при сохранении, и в предпросмотре.
 */
function normalizeEdits(edits: EntityEdit[]): EntityEdit[] {
  return edits.map((e) => ({
    ...e,
    ops: e.ops.map((op) => {
      if (op.mode !== "set") return op;
      const raw = String(op.value ?? "");
      try {
        return { ...op, value: JSON.parse(raw) };
      } catch {
        return { ...op, value: raw };
      }
    }),
  }));
}

type Tab = "message" | "edits" | "publish";

const TAB_LABEL: Record<Tab, string> = {
  message: "Сообщение",
  edits: "Правки",
  publish: "Публикация",
};

/** Отдельная страница создания/редактирования верда. */
export function PostEditorPage() {
  const { projectId, postId } = useParams();
  const pid = Number(projectId);
  const isNew = postId === "new";
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  // ?entity=<id> — верд открыт кнопкой «Написать верд» с экрана сущности.
  const [searchParams] = useSearchParams();
  const presetEntityId = Number(searchParams.get("entity")) || null;

  const existing = useAsync<Post | null>(
    () => (isNew ? Promise.resolve(null) : api.getPost(pid, Number(postId))),
    [pid, postId],
  );
  const channels = useAsync<Channel[]>(() => api.listChannels(pid), [pid]);
  const entities = useAsync<Entity[]>(() => api.listEntities(pid), [pid]);
  const guildChannels = useAsync<DiscordChannel[]>(
    () => api.listDiscordChannels(pid).catch(() => []),
    [pid],
  );
  const templates = useAsync<PostTemplate[]>(() => api.listPostTemplates(pid), [pid]);

  // --- поля верда ---
  const [tab, setTab] = useState<Tab>("message");
  const [title, setTitle] = useState("");
  const [targetChannelId, setTargetChannelId] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [authorAvatar, setAuthorAvatar] = useState("");
  const [content, setContent] = useState("");
  const [useEmbed, setUseEmbed] = useState(false);
  const [embedTitle, setEmbedTitle] = useState("");
  const [embedDescription, setEmbedDescription] = useState("");
  const [embedAuthorName, setEmbedAuthorName] = useState("");
  const [embedAuthorIcon, setEmbedAuthorIcon] = useState("");
  const [embedImage, setEmbedImage] = useState("");
  const [embedColor, setEmbedColor] = useState("#5865F2");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [edits, setEdits] = useState<EntityEdit[]>([]);
  // Пусто — публикуем сразу; иначе бот отправит верд в это время.
  const [scheduledAt, setScheduledAt] = useState("");

  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [appliedTemplate, setAppliedTemplate] = useState<number | null>(null);

  // Поля, которыми оперируют шаблоны: имена совпадают с полями верда на backend.
  const templateValues: Record<string, unknown> = {
    target_channel_id: targetChannelId,
    author_name: authorName,
    author_avatar_url: authorAvatar,
    content,
    use_embed: useEmbed,
    embed_author_name: embedAuthorName,
    embed_author_icon_url: embedAuthorIcon,
    embed_title: embedTitle,
    embed_description: embedDescription,
    embed_image_url: embedImage,
    embed_color: embedColor,
  };

  /** Применить шаблон: трогаем только те поля, что он в себе несёт. */
  function applyTemplate(tpl: PostTemplate) {
    const setters: Record<string, (v: unknown) => void> = {
      target_channel_id: (v) => setTargetChannelId(String(v ?? "")),
      author_name: (v) => setAuthorName(String(v ?? "")),
      author_avatar_url: (v) => setAuthorAvatar(String(v ?? "")),
      content: (v) => setContent(String(v ?? "")),
      use_embed: (v) => setUseEmbed(Boolean(v)),
      embed_author_name: (v) => setEmbedAuthorName(String(v ?? "")),
      embed_author_icon_url: (v) => setEmbedAuthorIcon(String(v ?? "")),
      embed_title: (v) => setEmbedTitle(String(v ?? "")),
      embed_description: (v) => setEmbedDescription(String(v ?? "")),
      embed_image_url: (v) => setEmbedImage(String(v ?? "")),
      embed_color: (v) => setEmbedColor(String(v ?? "") || "#5865F2"),
    };
    for (const key of tpl.fields) setters[key]?.(tpl.data[key]);
    setAppliedTemplate(tpl.id);
    toast.ok(`Применён шаблон «${tpl.name}»`);
  }

  async function removeTemplate() {
    const tpl = templates.data?.find((t) => t.id === appliedTemplate);
    if (!tpl) return;
    const ok = await confirm({
      title: `Удалить шаблон «${tpl.name}»?`,
      body: "Уже написанные верды это не затронет.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    await api.deletePostTemplate(pid, tpl.id);
    setAppliedTemplate(null);
    templates.reload();
    toast.ok("Шаблон удалён");
  }

  function fillFrom(p: Post) {
    setTitle(p.title);
    setTargetChannelId(p.target_channel_id ?? "");
    setAuthorName(p.author_name);
    setAuthorAvatar(p.author_avatar_url);
    setContent(p.content);
    setUseEmbed(p.use_embed);
    setEmbedTitle(p.embed_title);
    setEmbedDescription(p.embed_description);
    setEmbedAuthorName(p.embed_author_name);
    setEmbedAuthorIcon(p.embed_author_icon_url);
    setEmbedImage(p.embed_image_url);
    setEmbedColor(p.embed_color || "#5865F2");
    setAttachments(p.attachments ?? []);
    setScheduledAt(toLocalInput(p.scheduled_at));
    // Старые верды могли храниться в формате attributes — показываем как set-операции.
    setEdits(
      (p.entity_edits ?? []).map((e) => ({
        entity_id: e.entity_id,
        ops:
          e.ops && e.ops.length > 0
            ? e.ops
            : Object.entries(e.attributes ?? {}).map(([path, value]) => ({
                path,
                mode: "set" as EditMode,
                value,
              })),
      })),
    );
  }

  useEffect(() => {
    if (isNew) {
      // Сущность уже выбрана — сразу заводим для неё пустой блок правок.
      if (presetEntityId) {
        setEdits([{ entity_id: presetEntityId, ops: [] }]);
        setTab("edits");
      }
      setLoaded(true);
      return;
    }
    const p = existing.data;
    if (!p || loaded) return;
    fillFrom(p);
    setLoaded(true);
  }, [existing.data, isNew, loaded, presetEntityId]);

  const published = existing.data?.status === "published";

  const changed = useChanges(
    {
      title,
      target_channel_id: targetChannelId,
      content,
      author_name: authorName,
      author_avatar_url: authorAvatar,
      use_embed: useEmbed,
      embed_title: embedTitle,
      embed_description: embedDescription,
      embed_author_name: embedAuthorName,
      embed_author_icon_url: embedAuthorIcon,
      embed_image_url: embedImage,
      embed_color: embedColor,
      attachments,
      entity_edits: normalizeEdits(edits),
    },
    existing.data
      ? { ...existing.data, target_channel_id: existing.data.target_channel_id ?? "" }
      : null,
    {
      title: "название",
      target_channel_id: "канал",
      content: "текст",
      author_name: "отправитель",
      author_avatar_url: "отправитель",
      use_embed: "эмбед",
      embed_title: "эмбед",
      embed_description: "эмбед",
      embed_author_name: "эмбед",
      embed_author_icon_url: "эмбед",
      embed_image_url: "эмбед",
      embed_color: "эмбед",
      attachments: "вложения",
      entity_edits: "правки",
    },
  );
  // У нового верда сравнивать не с чем: он «грязный», пока не сохранён.
  const dirty = !published && (isNew ? true : changed.length > 0);

  async function save(): Promise<number | null> {
    if (targetChannelId && !/^\d+$/.test(targetChannelId)) {
      setTab("publish");
      toast.err("Discord channel_id должен состоять только из цифр");
      return null;
    }
    setSaving(true);
    const payload = {
      title,
      target_channel_id: targetChannelId || null,
      content,
      author_name: authorName,
      author_avatar_url: authorAvatar,
      use_embed: useEmbed,
      embed_title: embedTitle,
      embed_description: embedDescription,
      embed_author_name: embedAuthorName,
      embed_author_icon_url: embedAuthorIcon,
      embed_image_url: embedImage,
      embed_color: embedColor,
      scheduled_at: fromLocalInput(scheduledAt),
      attachments,
      entity_edits: normalizeEdits(edits),
    };
    try {
      if (isNew) {
        const created = await api.createPost(pid, payload);
        navigate(`/projects/${pid}/posts/${created.id}`, { replace: true });
        toast.ok("Черновик создан");
        return created.id;
      }
      await api.updatePost(pid, Number(postId), payload);
      toast.ok("Сохранено");
      existing.reload();
      return Number(postId);
    } catch (e) {
      toast.err(e);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    const opsCount = edits.reduce((n, e) => n + e.ops.length, 0);
    const ok = await confirm({
      title: "Опубликовать верд?",
      body: (
        <div className="stack tight">
          <div>Сообщение уйдёт в Discord — отозвать его из дашборда нельзя.</div>
          {opsCount > 0 && (
            <div className="error">
              {opsCount} {opsCount === 1 ? "правка изменит" : "правок изменят"} атрибуты сущностей.
              Проверьте вкладку «Правки».
            </div>
          )}
        </div>
      ),
      confirmLabel: "Опубликовать",
      danger: true,
    });
    if (!ok) return;
    const id = await save();
    if (id == null) return;
    try {
      await api.publishPost(pid, id);
      toast.ok("Верд опубликован");
      navigate(`/projects/${pid}`);
    } catch (e) {
      toast.err(e);
    }
  }

  async function schedule() {
    const iso = fromLocalInput(scheduledAt);
    if (!iso) {
      setTab("publish");
      toast.err("Укажите дату и время публикации");
      return;
    }
    if (new Date(iso).getTime() < Date.now()) {
      setTab("publish");
      toast.err("Время публикации уже прошло");
      return;
    }
    const id = await save();
    if (id == null) return;
    try {
      await api.schedulePost(pid, id, iso);
      toast.ok(`Верд уйдёт ${DATE_FMT.format(new Date(iso))}`);
      navigate(`/projects/${pid}`);
    } catch (e) {
      toast.err(e);
    }
  }

  const editCount = edits.reduce((n, e) => n + e.ops.length, 0);

  if (!isNew && existing.loading) return <p className="muted">Загрузка…</p>;
  if (existing.error) return <p className="error">{existing.error}</p>;

  return (
    <div>
      <div className="crumbs">
        <Link to="/">Серверы</Link> / <Link to={`/projects/${pid}`}>Проект</Link> /{" "}
        {isNew ? "новый верд" : title || "верд"}
      </div>

      <header className="page-header">
        <div className="page-header-text">
          <h1>{isNew ? "Новый верд" : title || "Верд"}</h1>
          <p className="muted">
            <StatusBadge status={existing.data?.status ?? "draft"} />
            {existing.data?.published_at && (
              <> Опубликован {DATE_FMT.format(new Date(existing.data.published_at))}</>
            )}
            {!existing.data?.published_at && existing.data?.scheduled_at && (
              <> Запланирован на {DATE_FMT.format(new Date(existing.data.scheduled_at))}</>
            )}
          </p>
        </div>
        <div className="row">
          <button className="ghost" onClick={() => navigate(`/projects/${pid}`)}>
            Назад
          </button>
          {scheduledAt ? (
            <button className="primary" disabled={saving || published} onClick={schedule}>
              Запланировать
            </button>
          ) : (
            <button className="primary" disabled={saving || published} onClick={publish}>
              Опубликовать сейчас
            </button>
          )}
        </div>
      </header>
      {published && (
        <p className="error">Верд уже опубликован — редактирование недоступно.</p>
      )}

      <div className="row spread" style={{ marginBottom: "var(--s4)" }}>
        <div className="subtabs">
          {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
            <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
              {TAB_LABEL[key]}
              {key === "edits" && editCount > 0 && (
                <span className="calc-badge" style={{ marginLeft: 6 }}>
                  {editCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <TemplatePicker
          templates={templates.data ?? []}
          applied={appliedTemplate}
          disabled={published}
          onApply={applyTemplate}
          onForget={() => setAppliedTemplate(null)}
          onDelete={removeTemplate}
          onSave={() => setSavingTemplate(true)}
        />
      </div>

      <div className="entity-layout">
        <div className="stack">
          {tab === "message" && (
            <>
              <div className="field">
                <label>Текст сообщения</label>
                <textarea
                  value={content}
                  style={{ minHeight: 160 }}
                  placeholder="Что увидят в канале…"
                  onChange={(e) => setContent(e.target.value)}
                />
              </div>

              <Section
                id="post-author"
                title="Отправитель"
                defaultOpen={false}
                summary={authorName || "имя бота по умолчанию"}
              >
                <Hint id="post-author">
                  От чьего имени приходит само сообщение в Discord — имя и аватарка вебхука. С
                  автором эмбеда это не связано.
                </Hint>
                <div className="fields two">
                  <div className="field">
                    <label>Имя</label>
                    <input
                      value={authorName}
                      placeholder="напр. Совет Безопасности"
                      onChange={(e) => setAuthorName(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Аватарка (URL)</label>
                    <input
                      value={authorAvatar}
                      onChange={(e) => setAuthorAvatar(e.target.value)}
                    />
                  </div>
                </div>
              </Section>

              <Section
                id="post-embed"
                title="Эмбед"
                defaultOpen={useEmbed}
                summary={useEmbed ? embedTitle || "без заголовка" : "выключен"}
                actions={
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={useEmbed}
                      onChange={(e) => setUseEmbed(e.target.checked)}
                    />
                    включить
                  </label>
                }
              >
                {!useEmbed && (
                  <p className="hint">
                    Эмбед — врезка под сообщением: заголовок, описание, картинка и цветная полоса.
                  </p>
                )}
                {useEmbed && (
                  <div className="stack tight">
                    <div className="fields two">
                      <div className="field">
                        <label>Автор эмбеда</label>
                        <input
                          value={embedAuthorName}
                          placeholder="не выводится, если пусто"
                          onChange={(e) => setEmbedAuthorName(e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label>Иконка автора (URL)</label>
                        <input
                          value={embedAuthorIcon}
                          placeholder="необязательно"
                          onChange={(e) => setEmbedAuthorIcon(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="field">
                      <label>Заголовок эмбеда</label>
                      <input value={embedTitle} onChange={(e) => setEmbedTitle(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Описание эмбеда</label>
                      <textarea
                        value={embedDescription}
                        style={{ minHeight: 120 }}
                        onChange={(e) => setEmbedDescription(e.target.value)}
                      />
                    </div>
                    <div className="row top">
                      <div className="field grow">
                        <label>Картинка эмбеда (URL)</label>
                        <input value={embedImage} onChange={(e) => setEmbedImage(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>Цвет</label>
                        <div className="row">
                          <input
                            type="color"
                            value={/^#[0-9a-fA-F]{6}$/.test(embedColor) ? embedColor : "#5865F2"}
                            style={{ width: 44, padding: 2 }}
                            onChange={(e) => setEmbedColor(e.target.value)}
                          />
                          <input
                            className="mono"
                            style={{ width: 96 }}
                            value={embedColor}
                            onChange={(e) => setEmbedColor(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </Section>

              <AttachmentsSection
                projectId={pid}
                attachments={attachments}
                onChange={setAttachments}
              />
            </>
          )}

          {tab === "edits" && (
            <EditsSection
              projectId={pid}
              entities={entities.data ?? []}
              edits={edits}
              onChange={setEdits}
            />
          )}

          {tab === "publish" && (
            <>
              <div className="field">
                <label>Название верда (только для дашборда)</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="field">
                <label>Канал публикации</label>
                <ChannelPicker
                  value={targetChannelId}
                  registered={channels.data ?? []}
                  guild={guildChannels.data ?? []}
                  onChange={setTargetChannelId}
                />
              </div>
              <div className="field">
                <label>Время публикации</label>
                <div className="row">
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                  {scheduledAt && (
                    <button className="ghost small" onClick={() => setScheduledAt("")}>
                      Очистить
                    </button>
                  )}
                </div>
                <p className="hint" style={{ marginTop: "var(--s1)" }}>
                  {scheduledAt
                    ? "Верд уйдёт в канал в указанное время — время местное."
                    : "Пусто — публикуется сразу по кнопке «Опубликовать»."}
                </p>
              </div>
            </>
          )}
        </div>

        <aside className="entity-aside">
          <h2 className="section-title">Предпросмотр</h2>
          <DiscordPreview
            authorName={authorName}
            authorAvatar={authorAvatar}
            content={content}
            useEmbed={useEmbed}
            embedTitle={embedTitle}
            embedDescription={embedDescription}
            embedAuthorName={embedAuthorName}
            embedAuthorIcon={embedAuthorIcon}
            embedImage={embedImage}
            embedColor={embedColor}
            attachments={attachments}
          />
        </aside>
      </div>

      <SaveBar
        dirty={dirty}
        changed={isNew ? ["черновик ещё не сохранён"] : changed}
        saving={saving}
        onSave={save}
        onReset={() => existing.data && fillFrom(existing.data)}
      />

      {savingTemplate && (
        <SaveTemplateModal
          projectId={pid}
          values={templateValues}
          onClose={() => setSavingTemplate(false)}
          onSaved={(name) => {
            setSavingTemplate(false);
            toast.ok(`Шаблон «${name}» сохранён`);
            templates.reload();
          }}
        />
      )}
    </div>
  );
}

/** Шаблон верда: выпадашка в шапке, а не карточка на весь экран. */
function TemplatePicker({
  templates,
  applied,
  disabled,
  onApply,
  onForget,
  onDelete,
  onSave,
}: {
  templates: PostTemplate[];
  applied: number | null;
  disabled: boolean;
  onApply: (tpl: PostTemplate) => void;
  onForget: () => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  return (
    <div className="row">
      <select
        value={applied ?? ""}
        style={{ width: "auto" }}
        disabled={disabled || templates.length === 0}
        onChange={(e) => {
          const tpl = templates.find((t) => t.id === Number(e.target.value));
          if (tpl) onApply(tpl);
          else onForget();
        }}
      >
        <option value="">
          {templates.length === 0 ? "— шаблонов нет —" : "— применить шаблон —"}
        </option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {applied !== null && (
        <button className="icon danger" title="Удалить шаблон" onClick={onDelete}>
          ✕
        </button>
      )}
      <button className="ghost small" disabled={disabled} onClick={onSave}>
        Сохранить как шаблон
      </button>
    </div>
  );
}

/** Что именно шаблон запоминает — мастер отмечает сам. */
function SaveTemplateModal({
  projectId,
  values,
  onClose,
  onSaved,
}: {
  projectId: number;
  values: Record<string, unknown>;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const fields = useAsync<TemplateField[]>(() => api.templateFields(projectId), [projectId]);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function toggle(key: string) {
    setPicked(picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key]);
  }

  async function save() {
    setBusy(true);
    try {
      await api.createPostTemplate(projectId, {
        name: name.trim(),
        fields: picked,
        // Значения берём из формы, а не из сохранённого верда: шаблон должен
        // повторять то, что мастер видит на экране прямо сейчас.
        data: Object.fromEntries(picked.map((k) => [k, values[k]])),
      });
      onSaved(name.trim());
    } catch (e) {
      toast.err(e);
      setBusy(false);
    }
  }

  return (
    <Modal title="Сохранить верд как шаблон" onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label>Название шаблона</label>
          <input
            value={name}
            autoFocus
            placeholder="напр. Сводка МИДа"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label>Что сохранить</label>
          {fields.loading && <p className="muted">Загрузка…</p>}
          <div className="stack tight">
            {fields.data?.map((f) => (
              <label className="check" key={f.key}>
                <input
                  type="checkbox"
                  checked={picked.includes(f.key)}
                  onChange={() => toggle(f.key)}
                />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        <div className="row spread">
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="primary"
            disabled={busy || !name.trim() || picked.length === 0}
            onClick={save}
          >
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    status === "published" ? "Опубликован" : status === "scheduled" ? "Запланирован" : "Черновик";
  return <span className={`badge ${status}`}>{label}</span>;
}

/** Выбор канала: из привязанных, из каналов сервера или вручную. */
function ChannelPicker({
  value,
  registered,
  guild,
  onChange,
}: {
  value: string;
  registered: Channel[];
  guild: DiscordChannel[];
  onChange: (v: string) => void;
}) {
  const known = useMemo(() => {
    const map = new Map<string, string>();
    guild.forEach((c) => map.set(c.channel_id, `#${c.name}`));
    registered.forEach((c) => map.set(c.channel_id, c.label ? `#${c.label}` : c.channel_id));
    return map;
  }, [registered, guild]);

  const inList = value === "" || known.has(value);

  return (
    <div className="stack tight">
      <select
        value={inList ? value : "__manual__"}
        onChange={(e) => onChange(e.target.value === "__manual__" ? value : e.target.value)}
      >
        <option value="">— не выбран —</option>
        {registered.length > 0 && (
          <optgroup label="Привязанные к проекту">
            {registered.map((c) => (
              <option key={`r${c.id}`} value={c.channel_id}>
                #{c.label || c.channel_id}
              </option>
            ))}
          </optgroup>
        )}
        {guild.length > 0 && (
          <optgroup label="Каналы сервера">
            {guild
              .filter((c) => c.type === "text" || c.type === "news")
              .map((c) => (
                <option key={`g${c.channel_id}`} value={c.channel_id}>
                  {c.parent_name ? `${c.parent_name} / ` : ""}#{c.name}
                </option>
              ))}
          </optgroup>
        )}
        <option value="__manual__">— ввести ID вручную —</option>
      </select>
      <input
        className="mono"
        value={value}
        placeholder="Discord channel_id"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Вложения: загрузка файлов на backend. */
function AttachmentsSection({
  projectId,
  attachments,
  onChange,
}: {
  projectId: number;
  attachments: Attachment[];
  onChange: (a: Attachment[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const uploaded: Attachment[] = [];
      for (const file of Array.from(files)) {
        uploaded.push(await api.uploadAttachment(projectId, file));
      }
      onChange([...attachments, ...uploaded]);
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Section
      id="post-attachments"
      title="Вложения"
      defaultOpen={attachments.length > 0}
      summary={attachments.length > 0 ? `${attachments.length} файл(ов)` : "нет"}
      actions={
        <button className="ghost small" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "Загрузка…" : "+ файл"}
        </button>
      }
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => upload(e.target.files)}
      />
      {attachments.length === 0 && <p className="muted">Вложений нет.</p>}
      <div className="stack tight">
        {attachments.map((a) => (
          <div className="row spread" key={a.url}>
            <span>
              📎 {a.filename} <span className="muted">{(a.size / 1024).toFixed(1)} КБ</span>
            </span>
            <button
              className="icon danger"
              title="Убрать"
              onClick={() => onChange(attachments.filter((x) => x.url !== a.url))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

/**
 * Правки сущностей: операции над атрибутами, включая вычисления.
 *
 * Самый опасный экран дашборда — публикация применяет правки необратимо.
 * Поэтому пути подсказываются из реальных атрибутов выбранной сущности, а
 * рядом с каждой операцией сервер считает «было → станет» на копии данных.
 */
function EditsSection({
  projectId,
  entities,
  edits,
  onChange,
}: {
  projectId: number;
  entities: Entity[];
  edits: EntityEdit[];
  onChange: (e: EntityEdit[]) => void;
}) {
  const [preview, setPreview] = useState<EditPreview[]>([]);
  // Правки летят на сервер не на каждое нажатие клавиши.
  const settled = useDebounced(JSON.stringify(normalizeEdits(edits)), 400);

  useEffect(() => {
    const payload: EntityEdit[] = JSON.parse(settled);
    if (payload.every((e) => e.ops.length === 0)) {
      setPreview([]);
      return;
    }
    let cancelled = false;
    api
      .previewEdits(projectId, payload)
      .then((rows) => {
        if (!cancelled) setPreview(rows);
      })
      .catch(() => {
        // Предпросмотр — вспомогательный: молчим, ошибку покажет публикация.
        if (!cancelled) setPreview([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, settled]);

  function addEdit() {
    if (entities.length === 0) return;
    onChange([...edits, { entity_id: entities[0].id, ops: [] }]);
  }
  function patchEdit(i: number, patch: Partial<EntityEdit>) {
    onChange(edits.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function addOp(i: number) {
    patchEdit(i, { ops: [...edits[i].ops, { path: "", mode: "set", value: "" }] });
  }
  function patchOp(i: number, j: number, patch: Partial<EntityEditOp>) {
    patchEdit(i, {
      ops: edits[i].ops.map((o, idx) => (idx === j ? { ...o, ...patch } : o)),
    });
  }

  return (
    <div className="stack">
      <Hint id="post-edits">
        Применяются при публикации. В режиме «вычислить» можно писать формулы по атрибутам:{" "}
        <code>ВС.людские_ресурсы - 10</code>, <code>min(экономика.ВВП * 1.05, 5000)</code>.
        Доступны вычисляемые поля (<code>казна + выч.бюджет.итого</code>) и списки:{" "}
        <code>длина(духи)</code>, <code>сумма(гигаструктуры, "мощь")</code>.
      </Hint>

      {entities.length === 0 && <p className="muted">Сначала создайте сущности.</p>}

      {edits.map((edit, i) => {
        const entity = entities.find((e) => e.id === edit.entity_id);
        const paths = attrPaths(entity?.attributes ?? {});
        const rows = preview.find((p) => p.entity_id === edit.entity_id)?.rows ?? [];
        return (
          <section className="card" key={i}>
            <div className="row spread">
              <select
                className="grow"
                value={edit.entity_id}
                onChange={(e) => patchEdit(i, { entity_id: Number(e.target.value) })}
              >
                {entities.map((en) => (
                  <option key={en.id} value={en.id}>
                    {en.label}
                  </option>
                ))}
              </select>
              <div className="row">
                <button className="ghost small" onClick={() => addOp(i)}>
                  + правка
                </button>
                <button
                  className="icon danger"
                  title="Убрать сущность из верда"
                  onClick={() => onChange(edits.filter((_, idx) => idx !== i))}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Пути реальных атрибутов этой сущности — чтобы не набирать по памяти. */}
            <datalist id={`paths-${i}`}>
              {paths.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>

            {edit.ops.length === 0 && <p className="muted">Операций нет.</p>}
            <div className="stack tight" style={{ marginTop: "var(--s2)" }}>
              {edit.ops.map((op, j) => {
                const row = rows.find((r) => r.path === op.path.trim());
                return (
                  <div key={j}>
                    <div className="row">
                      <input
                        className="mono grow"
                        list={`paths-${i}`}
                        placeholder="путь.через.точку"
                        value={op.path}
                        onChange={(e) => patchOp(i, j, { path: e.target.value })}
                      />
                      <select
                        value={op.mode}
                        style={{ width: 140 }}
                        onChange={(e) => patchOp(i, j, { mode: e.target.value as EditMode })}
                      >
                        {(Object.keys(MODE_LABEL) as EditMode[]).map((m) => (
                          <option key={m} value={m}>
                            {MODE_LABEL[m]}
                          </option>
                        ))}
                      </select>
                      {op.mode !== "delete" && (
                        <input
                          className={op.mode === "expr" ? "mono grow" : "grow"}
                          placeholder={op.mode === "expr" ? "ВС.танки - 10" : "значение"}
                          value={String(op.value ?? "")}
                          onChange={(e) => patchOp(i, j, { value: e.target.value })}
                        />
                      )}
                      <button
                        className="icon danger"
                        title="Удалить правку"
                        onClick={() =>
                          patchEdit(i, { ops: edit.ops.filter((_, idx) => idx !== j) })
                        }
                      >
                        ✕
                      </button>
                    </div>
                    {row && (
                      <div className="hint" style={{ margin: "2px 0 0" }}>
                        {row.error ? (
                          <span className="error">⚠ {row.error}</span>
                        ) : (
                          <>
                            было <span className="calc-value">{row.before}</span> →{" "}
                            <span className={row.changed ? "calc-value" : "muted"}>{row.after}</span>
                            {!row.changed && " (без изменений)"}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="row">
        <button className="ghost" onClick={addEdit} disabled={entities.length === 0}>
          + сущность
        </button>
      </div>
    </div>
  );
}
