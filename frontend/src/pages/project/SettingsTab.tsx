import { useEffect, useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { CategoryPicker } from "../../components/CategoryPicker";
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
      await api.updateProject(pid, { label, type, desc, category_ids: categoryIds });
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
      <section className="card">
        <h3 style={{ marginTop: 0 }}>Основное</h3>
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

        <label style={{ marginTop: 16 }}>Категории проекта</label>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Всё внутри выбранных категорий принадлежит проекту. Снятие категории не удаляет
          каналы в Discord — проект просто перестаёт ими владеть.
        </p>
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
      </section>

      <RolesSection projectId={pid} guildId={guildId} />
    </div>
  );
}

/** Роли сервера, наделённые правами в проекте. Сохраняются сразу, без общей кнопки. */
function RolesSection({ projectId, guildId }: { projectId: number; guildId: string | null }) {
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
    if (!confirm(`Убрать роль «${r.name}» из проекта?`)) return;
    await api.deleteProjectRole(projectId, r.id);
    roles.reload();
  }

  return (
    <section className="card">
      <h3 style={{ marginTop: 0 }}>Роли</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Ролям уровня админ и модератор приватные каналы проекта открыты всегда. Игрокам —
        нет: доступ к каналу они получают через свои сущности, иначе любой игрок видел бы
        приватные каналы чужих стран.
      </p>

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
    </section>
  );
}
