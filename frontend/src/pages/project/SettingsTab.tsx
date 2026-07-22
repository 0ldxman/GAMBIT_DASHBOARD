import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { CategoryPicker } from "../../components/CategoryPicker";
import { Section } from "../../components/Section";
import { Hint } from "../../components/Hint";
import { useConfirm, useToast } from "../../components/Feedback";
import type {
  AccessLevel,
  DiscordChannel,
  DiscordRole,
  Project,
  ProjectRole,
} from "../../types";

const LEVELS: { value: AccessLevel; label: string; hint: string }[] = [
  { value: "admin", label: "Админ", hint: "полный доступ, видит все каналы проекта" },
  { value: "moderator", label: "Модератор", hint: "помощник мастера, тоже видит все каналы" },
  { value: "player", label: "Игрок", hint: "каналы получает только через свои сущности" },
];

export function SettingsTab({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: () => void;
}) {
  const pid = project.id;
  const guildId = project.guild_id;

  const categories = useAsync<string[]>(() => api.listCategories(pid), [pid]);
  const channels = useAsync<DiscordChannel[]>(
    () => (guildId ? api.listGuildChannels(guildId) : Promise.resolve([])),
    [guildId],
  );

  const [label, setLabel] = useState(project.label);
  const [type, setType] = useState(project.type);
  const [desc, setDesc] = useState(project.desc);
  const [authors, setAuthors] = useState(project.authors);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (categories.data) setCategoryIds(categories.data);
  }, [categories.data]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await api.updateProject(pid, {
        label,
        type,
        desc,
        authors,
        category_ids: categoryIds,
      });
      setMsg("Сохранено");
      onSaved();
      categories.reload();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <Section id="settings-main" title="Основное" summary={label}>
        <div>
          <label>Название</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Тип / жанр</label>
            <input value={type} onChange={(e) => setType(e.target.value)} />
          </div>
        </div>
        <div>
          <label>Описание</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div>
          <label>Авторы проекта</label>
          <textarea
            value={authors}
            placeholder="Кто ведёт игру — выводится в /about"
            style={{ minHeight: 70 }}
            onChange={(e) => setAuthors(e.target.value)}
          />
        </div>

        <label style={{ marginTop: 16 }}>Категории проекта</label>
        <Hint id="settings-categories">
          Всё внутри выбранных категорий принадлежит проекту. Снятие категории не удаляет
          каналы в Discord — проект просто перестаёт ими владеть.
        </Hint>
        <CategoryPicker
          channels={channels.data ?? []}
          selected={categoryIds}
          onChange={setCategoryIds}
          loading={channels.loading || categories.loading}
          error={channels.error}
        />

        <div className="row spread" style={{ marginTop: 16 }}>
          <span className={msg === "Сохранено" ? "muted" : "error"}>{msg}</span>
          <button className="primary" disabled={saving || !label} onClick={save}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </Section>

      <MediaSection project={project} onSaved={onSaved} />
      <RolesSection projectId={pid} guildId={guildId} />
    </div>
  );
}

/** Одно вложение в эмбед /about: картинка, гифка или видео. */
function MediaSection({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const url = project.media_url;
  const isImage = project.media_content_type.startsWith("image/");
  const isVideo = project.media_content_type.startsWith("video/");

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const att = await api.uploadAttachment(project.id, file);
      await api.updateProject(project.id, {
        media_url: att.url,
        media_filename: att.filename,
        media_content_type: att.content_type,
      });
      onSaved();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function clear() {
    setBusy(true);
    setErr(null);
    try {
      // Пустые строки снимают вложение; сам файл на диске остаётся.
      await api.updateProject(project.id, {
        media_url: "",
        media_filename: "",
        media_content_type: "",
      });
      onSaved();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      id="settings-media"
      title="Вложение карточки"
      defaultOpen={Boolean(url)}
      summary={url ? "есть" : "нет"}
      actions={
        <>
          <button className="ghost small" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Загрузка…" : url ? "Заменить" : "+ файл"}
          </button>
          {url && (
            <button className="ghost small danger" disabled={busy} onClick={clear}>
              Убрать
            </button>
          )}
        </>
      }
    >
      <Hint id="settings-media">
        Показывается в эмбеде команды <code>/about</code>. Картинка и гифка выводятся внутри
        эмбеда; видео Discord внутрь эмбеда не пускает — оно придёт плеером под сообщением.
      </Hint>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: "none" }}
        onChange={(e) => upload(e.target.files)}
      />

      {!url && <p className="muted">Вложения нет.</p>}
      {url && (
        <div className="stack" style={{ gap: 8 }}>
          {isImage && (
            <img
              src={`/api${url}`}
              alt=""
              style={{ maxWidth: 420, maxHeight: 260, borderRadius: 8 }}
            />
          )}
          {isVideo && (
            <video
              src={`/api${url}`}
              controls
              style={{ maxWidth: 420, maxHeight: 260, borderRadius: 8 }}
            />
          )}
          <span className="muted" style={{ fontSize: 13 }}>
            📎 {project.media_filename} · {project.media_content_type}
          </span>
        </div>
      )}
      {err && <div className="error">{err}</div>}
    </Section>
  );
}

/** Роли сервера, наделённые правами в проекте. Сохраняются сразу, без общей кнопки. */
function RolesSection({ projectId, guildId }: { projectId: number; guildId: string | null }) {
  const confirm = useConfirm();
  const toast = useToast();
  const roles = useAsync<ProjectRole[]>(() => api.listProjectRoles(projectId), [projectId]);
  const guildRoles = useAsync<DiscordRole[]>(
    () => (guildId ? api.listGuildRoles(guildId) : Promise.resolve([])),
    [guildId],
  );

  const [roleId, setRoleId] = useState("");
  const [level, setLevel] = useState<AccessLevel>("player");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const added = new Set((roles.data ?? []).map((r) => r.role_id));

  async function add() {
    const picked = guildRoles.data?.find((r) => r.role_id === roleId);
    if (!picked) return;
    setBusy(true);
    setErr(null);
    try {
      await api.addProjectRole(projectId, {
        role_id: picked.role_id,
        name: picked.name,
        access_level: level,
      });
      setRoleId("");
      roles.reload();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeLevel(r: ProjectRole, value: AccessLevel) {
    await api.updateProjectRole(projectId, r.id, { access_level: value });
    roles.reload();
  }

  async function remove(r: ProjectRole) {
    const ok = await confirm({
      title: `Убрать роль «${r.name}» из проекта?`,
      body: "Права, которые она давала внутри проекта, пропадут. Сама роль на сервере останется.",
      confirmLabel: "Убрать",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteProjectRole(projectId, r.id);
      toast.ok("Роль убрана");
      roles.reload();
    } catch (e) {
      toast.err(e);
    }
  }

  return (
    <Section
      id="settings-roles"
      title="Роли"
      summary={`${roles.data?.length ?? 0} в проекте`}
    >
      <Hint id="settings-roles">
        Ролям уровня админ и модератор приватные каналы проекта открыты всегда. Игрокам — нет:
        доступ к каналу они получают через свои сущности, иначе любой игрок видел бы приватные
        каналы чужих стран.
      </Hint>

      {roles.loading && <p className="muted">Загрузка…</p>}
      {roles.error && <p className="error">{roles.error}</p>}
      {roles.data?.length === 0 && <p className="muted">Ролей нет.</p>}

      {roles.data?.map((r) => (
        <div className="row spread" key={r.id} style={{ marginTop: 8 }}>
          <span>
            @{r.name || r.role_id} <span className="muted mono">{r.role_id}</span>
          </span>
          <div className="row" style={{ gap: 6 }}>
            <select
              value={r.access_level}
              style={{ width: 160 }}
              onChange={(e) => changeLevel(r, e.target.value as AccessLevel)}
            >
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            <button className="ghost danger" onClick={() => remove(r)}>
              ✕
            </button>
          </div>
        </div>
      ))}

      {!guildId && (
        <p className="muted" style={{ marginTop: 16 }}>
          У проекта не выбран сервер — роли выбрать не из чего.
        </p>
      )}

      {guildId && (
        <>
          <label style={{ marginTop: 16 }}>Добавить роль</label>
          <div className="row" style={{ gap: 8 }}>
            <select value={roleId} style={{ flex: 1 }} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">— выберите роль сервера —</option>
              {(guildRoles.data ?? []).map((r) => (
                <option key={r.role_id} value={r.role_id} disabled={added.has(r.role_id)}>
                  @{r.name}
                  {added.has(r.role_id) ? " — уже добавлена" : ""}
                </option>
              ))}
            </select>
            <select
              value={level}
              style={{ width: 160 }}
              onChange={(e) => setLevel(e.target.value as AccessLevel)}
            >
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            <button className="primary" onClick={add} disabled={busy || !roleId}>
              Добавить
            </button>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            {LEVELS.find((l) => l.value === level)?.hint}
          </p>
          {guildRoles.error && <div className="error">{guildRoles.error}</div>}
        </>
      )}
      {err && <div className="error">{err}</div>}
    </Section>
  );
}
