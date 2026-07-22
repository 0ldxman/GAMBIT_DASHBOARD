import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import { DiscordPreview } from "../components/DiscordPreview";
import { Modal } from "../components/Modal";
import type {
  Attachment,
  Channel,
  DiscordChannel,
  EditMode,
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

/** Отдельная страница создания/редактирования верда. */
export function PostEditorPage() {
  const { projectId, postId } = useParams();
  const pid = Number(projectId);
  const isNew = postId === "new";
  const navigate = useNavigate();
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
  const [msg, setMsg] = useState<string | null>(null);
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
    setMsg(`Применён шаблон «${tpl.name}»`);
  }

  async function removeTemplate() {
    const tpl = templates.data?.find((t) => t.id === appliedTemplate);
    if (!tpl || !confirm(`Удалить шаблон «${tpl.name}»? Верды это не затронет.`)) return;
    await api.deletePostTemplate(pid, tpl.id);
    setAppliedTemplate(null);
    templates.reload();
  }

  useEffect(() => {
    if (isNew) {
      // Сущность уже выбрана — сразу заводим для неё пустой блок правок.
      if (presetEntityId) setEdits([{ entity_id: presetEntityId, ops: [] }]);
      setLoaded(true);
      return;
    }
    const p = existing.data;
    if (!p || loaded) return;
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
    setLoaded(true);
  }, [existing.data, isNew, loaded]);

  const published = existing.data?.status === "published";

  async function save(): Promise<number | null> {
    if (targetChannelId && !/^\d+$/.test(targetChannelId)) {
      setMsg("Discord channel_id должен состоять только из цифр");
      return null;
    }
    setSaving(true);
    setMsg(null);
    // В режиме "записать" значение из поля — строка; числа/булевы/списки
    // разбираем как JSON, чтобы они легли в атрибуты нужным типом.
    const normalized: EntityEdit[] = edits.map((e) => ({
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
      entity_edits: normalized,
    };
    try {
      if (isNew) {
        const created = await api.createPost(pid, payload);
        navigate(`/projects/${pid}/posts/${created.id}`, { replace: true });
        setMsg("Черновик создан");
        return created.id;
      }
      await api.updatePost(pid, Number(postId), payload);
      setMsg("Сохранено");
      return Number(postId);
    } catch (e) {
      setMsg(String(e));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    const id = await save();
    if (id == null) return;
    if (!confirm("Опубликовать верд? Правки применятся к сущностям, сообщение уйдёт в Discord.")) return;
    try {
      await api.publishPost(pid, id);
      navigate(`/projects/${pid}`);
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function schedule() {
    const iso = fromLocalInput(scheduledAt);
    if (!iso) {
      setMsg("Укажите дату и время публикации");
      return;
    }
    if (new Date(iso).getTime() < Date.now()) {
      setMsg("Время публикации уже прошло");
      return;
    }
    const id = await save();
    if (id == null) return;
    try {
      await api.schedulePost(pid, id, iso);
      navigate(`/projects/${pid}`);
    } catch (e) {
      setMsg(String(e));
    }
  }

  if (!isNew && existing.loading) return <p className="muted">Загрузка…</p>;
  if (existing.error) return <p className="error">{existing.error}</p>;

  return (
    <div>
      <div className="crumbs">
        <Link to="/">Проекты</Link> / <Link to={`/projects/${pid}`}>Проект</Link> /{" "}
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
        <div className="row" style={{ gap: 8 }}>
          <button className="ghost" onClick={() => navigate(`/projects/${pid}`)}>
            Назад
          </button>
          <button className="ghost" disabled={saving || published} onClick={save}>
            {saving ? "Сохранение…" : "Сохранить черновик"}
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
      {msg && (
        <div className={/Сохранено|создан|Применён|Шаблон/.test(msg) ? "muted" : "error"}>{msg}</div>
      )}

      <div className="row" style={{ gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* ---------- левая колонка: редактор ---------- */}
        <div className="stack" style={{ flex: "1 1 520px", minWidth: 340 }}>
          <section className="card">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>Шаблон</h3>
              <button className="ghost" disabled={published} onClick={() => setSavingTemplate(true)}>
                Сохранить как шаблон
              </button>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Шаблон подставляет только те поля, которые в нём отмечены — остальное
              в верде остаётся как есть.
            </p>
            <div className="row" style={{ gap: 8 }}>
              <select
                value={appliedTemplate ?? ""}
                style={{ flex: 1 }}
                disabled={published || (templates.data ?? []).length === 0}
                onChange={(e) => {
                  const tpl = templates.data?.find((t) => t.id === Number(e.target.value));
                  if (tpl) applyTemplate(tpl);
                  else setAppliedTemplate(null);
                }}
              >
                <option value="">
                  {(templates.data ?? []).length === 0
                    ? "— шаблонов пока нет —"
                    : "— применить шаблон —"}
                </option>
                {templates.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {appliedTemplate !== null && (
                <button className="ghost danger" onClick={removeTemplate}>
                  Удалить шаблон
                </button>
              )}
            </div>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Основное</h3>
            <div>
              <label>Название верда (только для дашборда)</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label>Канал публикации</label>
              <ChannelPicker
                value={targetChannelId}
                registered={channels.data ?? []}
                guild={guildChannels.data ?? []}
                onChange={setTargetChannelId}
              />
            </div>
            <div>
              <label>Время публикации</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                {scheduledAt && (
                  <button className="ghost" onClick={() => setScheduledAt("")}>
                    Очистить
                  </button>
                )}
              </div>
              <p className="muted" style={{ fontSize: 13 }}>
                {scheduledAt
                  ? "Верд уйдёт в канал в указанное время — время местное."
                  : "Пусто — публикуется сразу по кнопке."}
              </p>
            </div>
          </section>

          {/* --- отправитель: идентичность вебхука --- */}
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Отправитель</h3>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              От чьего имени приходит само сообщение в Discord — имя и аватарка вебхука.
            </p>
            <div className="row" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label>Имя</label>
                <input
                  value={authorName}
                  placeholder="напр. Совет Безопасности"
                  onChange={(e) => setAuthorName(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label>Аватарка (URL)</label>
                <input
                  value={authorAvatar}
                  onChange={(e) => setAuthorAvatar(e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* --- текст сообщения --- */}
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Текст сообщения</h3>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Обычный текст над эмбедом. Может быть и без эмбеда, и вместе с ним.
            </p>
            <textarea
              value={content}
              style={{ minHeight: 120 }}
              placeholder="Что увидят в канале…"
              onChange={(e) => setContent(e.target.value)}
            />
          </section>

          {/* --- эмбед --- */}
          <section className="card">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>Эмбед</h3>
              <label className="row" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={useEmbed}
                  style={{ width: "auto", marginRight: 8 }}
                  onChange={(e) => setUseEmbed(e.target.checked)}
                />
                включить
              </label>
            </div>
            {useEmbed && (
              <div className="stack" style={{ marginTop: 12 }}>
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  Автор эмбеда не связан с отправителем: пусто — строки автора не будет,
                  без иконки — имя выведется без картинки.
                </p>
                <div className="row" style={{ gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label>Автор эмбеда</label>
                    <input
                      value={embedAuthorName}
                      placeholder="не выводится, если пусто"
                      onChange={(e) => setEmbedAuthorName(e.target.value)}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label>Иконка автора (URL)</label>
                    <input
                      value={embedAuthorIcon}
                      placeholder="необязательно"
                      onChange={(e) => setEmbedAuthorIcon(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label>Заголовок эмбеда</label>
                  <input value={embedTitle} onChange={(e) => setEmbedTitle(e.target.value)} />
                </div>
                <div>
                  <label>Описание эмбеда</label>
                  <textarea
                    value={embedDescription}
                    style={{ minHeight: 120 }}
                    onChange={(e) => setEmbedDescription(e.target.value)}
                  />
                </div>
                <div className="row" style={{ gap: 12 }}>
                  <div style={{ flex: 2 }}>
                    <label>Картинка эмбеда (URL)</label>
                    <input value={embedImage} onChange={(e) => setEmbedImage(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label>Цвет</label>
                    <div className="row" style={{ gap: 6 }}>
                      <input
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(embedColor) ? embedColor : "#5865F2"}
                        style={{ width: 44, padding: 2 }}
                        onChange={(e) => setEmbedColor(e.target.value)}
                      />
                      <input value={embedColor} onChange={(e) => setEmbedColor(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <AttachmentsSection
            projectId={pid}
            attachments={attachments}
            onChange={setAttachments}
          />

          <EditsSection
            entities={entities.data ?? []}
            edits={edits}
            onChange={setEdits}
          />
        </div>

        {/* ---------- правая колонка: предпросмотр ---------- */}
        <div style={{ flex: "1 1 380px", minWidth: 320, position: "sticky", top: 16 }}>
          <label>Предпросмотр</label>
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
        </div>
      </div>

      {savingTemplate && (
        <SaveTemplateModal
          projectId={pid}
          values={templateValues}
          onClose={() => setSavingTemplate(false)}
          onSaved={(name) => {
            setSavingTemplate(false);
            setMsg(`Шаблон «${name}» сохранён`);
            templates.reload();
          }}
        />
      )}
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
  const [err, setErr] = useState<string | null>(null);

  function toggle(key: string) {
    setPicked(picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key]);
  }

  async function save() {
    setBusy(true);
    setErr(null);
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
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Сохранить верд как шаблон" onClose={onClose}>
      <div className="stack">
        <div>
          <label>Название шаблона</label>
          <input
            value={name}
            autoFocus
            placeholder="напр. Сводка МИДа"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <label style={{ marginBottom: 0 }}>Что сохранить</label>
        {fields.loading && <p className="muted">Загрузка…</p>}
        {fields.data?.map((f) => (
          <label className="row" key={f.key} style={{ margin: 0, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={picked.includes(f.key)}
              style={{ width: "auto", marginRight: 8 }}
              onChange={() => toggle(f.key)}
            />
            {f.label}
          </label>
        ))}

        {err && <div className="error">{err}</div>}
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
    <div className="stack" style={{ gap: 6 }}>
      <select value={inList ? value : "__manual__"} onChange={(e) => onChange(e.target.value === "__manual__" ? value : e.target.value)}>
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
  const [err, setErr] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const uploaded: Attachment[] = [];
      for (const file of Array.from(files)) {
        uploaded.push(await api.uploadAttachment(projectId, file));
      }
      onChange([...attachments, ...uploaded]);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="card">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>Вложения</h3>
        <button className="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "Загрузка…" : "+ файл"}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => upload(e.target.files)}
      />
      {err && <div className="error">{err}</div>}
      {attachments.length === 0 && <p className="muted">Вложений нет.</p>}
      {attachments.map((a) => (
        <div className="row spread" key={a.url} style={{ marginTop: 8 }}>
          <span>
            📎 {a.filename}{" "}
            <span className="muted" style={{ fontSize: 13 }}>
              {(a.size / 1024).toFixed(1)} КБ
            </span>
          </span>
          <button
            className="ghost danger"
            onClick={() => onChange(attachments.filter((x) => x.url !== a.url))}
          >
            ✕
          </button>
        </div>
      ))}
    </section>
  );
}

/** Правки сущностей: операции над атрибутами, включая вычисления. */
function EditsSection({
  entities,
  edits,
  onChange,
}: {
  entities: Entity[];
  edits: EntityEdit[];
  onChange: (e: EntityEdit[]) => void;
}) {
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
    <section className="card">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>Правки сущностей</h3>
        <button className="ghost" onClick={addEdit} disabled={entities.length === 0}>
          + сущность
        </button>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Применяются при публикации. В режиме «вычислить» можно писать формулы по атрибутам:{" "}
        <code>ВС.людские_ресурсы - 10</code>, <code>политика.поддержка + 100</code>,{" "}
        <code>min(экономика.ВВП * 1.05, 5000)</code>. Доступны вычисляемые поля типа
        (<code>казна + выч.бюджет.итого</code>) и списки: <code>длина(духи)</code>,{" "}
        <code>сумма(гигаструктуры, "мощь")</code>.
      </p>
      {entities.length === 0 && <p className="muted">Сначала создайте сущности.</p>}

      {edits.map((edit, i) => (
        <div
          key={i}
          className="stack"
          style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginTop: 10 }}
        >
          <div className="row" style={{ gap: 8 }}>
            <select
              value={edit.entity_id}
              style={{ flex: 1 }}
              onChange={(e) => patchEdit(i, { entity_id: Number(e.target.value) })}
            >
              {entities.map((en) => (
                <option key={en.id} value={en.id}>
                  {en.label}
                </option>
              ))}
            </select>
            <button className="ghost" onClick={() => addOp(i)}>
              + правка
            </button>
            <button
              className="ghost danger"
              onClick={() => onChange(edits.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          </div>

          {edit.ops.length === 0 && <p className="muted">Операций нет.</p>}
          {edit.ops.map((op, j) => (
            <div className="row" key={j} style={{ gap: 6 }}>
              <input
                placeholder="путь.через.точку"
                value={op.path}
                style={{ flex: 2 }}
                onChange={(e) => patchOp(i, j, { path: e.target.value })}
              />
              <select
                value={op.mode}
                style={{ width: 130 }}
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
                  placeholder={op.mode === "expr" ? "ВС.танки - 10" : "значение"}
                  value={String(op.value ?? "")}
                  style={{
                    flex: 2,
                    fontFamily: op.mode === "expr" ? "ui-monospace, monospace" : undefined,
                  }}
                  onChange={(e) => patchOp(i, j, { value: e.target.value })}
                />
              )}
              <button
                className="ghost danger"
                onClick={() =>
                  patchEdit(i, { ops: edit.ops.filter((_, idx) => idx !== j) })
                }
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
