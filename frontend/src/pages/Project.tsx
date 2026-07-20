import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import type { AppNotification, DiscordRole, Project } from "../types";
import { EntitiesTab } from "./project/EntitiesTab";
import { EntityTypesTab } from "./project/EntityTypesTab";
import { ChannelsTab } from "./project/ChannelsTab";
import { PostsTab } from "./project/PostsTab";
import { FormsTab } from "./project/FormsTab";
import { RegistrationsTab } from "./project/RegistrationsTab";
import { NotificationsTab } from "./project/NotificationsTab";

type Tab =
  | "posts"
  | "entities"
  | "types"
  | "channels"
  | "forms"
  | "registrations"
  | "notifications";

export function ProjectPage() {
  const { projectId } = useParams();
  const pid = Number(projectId);
  const project = useAsync<Project>(() => api.getProject(pid), [pid]);
  const [tab, setTab] = useState<Tab>("posts");

  // Непрочитанные уведомления — для бейджа и периодического опроса.
  const [unread, setUnread] = useState<AppNotification[]>([]);
  const refreshUnread = () =>
    api
      .listNotifications(pid, true)
      .then(setUnread)
      .catch(() => {});
  useEffect(() => {
    refreshUnread();
    const t = setInterval(refreshUnread, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "posts", label: "Верды" },
    { key: "entities", label: "Сущности" },
    { key: "types", label: "Типы" },
    { key: "channels", label: "Каналы" },
    { key: "forms", label: "Формы" },
    { key: "registrations", label: "Заявки" },
    { key: "notifications", label: "Уведомления", badge: unread.length || undefined },
  ];

  return (
    <div>
      <div className="crumbs">
        <Link to="/">Проекты</Link> / {project.data?.label ?? "…"}
      </div>
      <div className="row spread">
        <h1>{project.data?.label ?? "Проект"}</h1>
        {project.data && (
          <GuildSetting
            project={project.data}
            onSaved={() => project.reload()}
          />
        )}
      </div>
      {project.data?.desc && <p className="muted">{project.data.desc}</p>}

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.badge ? <span className="badge scheduled" style={{ marginLeft: 6 }}>{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {tab === "posts" && <PostsTab projectId={pid} />}
      {tab === "entities" && <EntitiesTab projectId={pid} />}
      {tab === "types" && <EntityTypesTab projectId={pid} />}
      {tab === "channels" && <ChannelsTab projectId={pid} />}
      {tab === "forms" && <FormsTab projectId={pid} />}
      {tab === "registrations" && <RegistrationsTab projectId={pid} />}
      {tab === "notifications" && (
        <NotificationsTab projectId={pid} onChange={refreshUnread} />
      )}
    </div>
  );
}

/** Настройки проекта: сервер и роли доступа к приватным каналам. */
function GuildSetting({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [guild, setGuild] = useState(project.guild_id ?? "");
  const [masterRole, setMasterRole] = useState(project.master_role_id ?? "");
  const [playerRole, setPlayerRole] = useState(project.player_role_id ?? "");
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // Роли подгружаем только когда открыли настройки — и только если сервер задан.
  useEffect(() => {
    if (!editing || !project.guild_id) return;
    api
      .listDiscordRoles(project.id)
      .then(setRoles)
      .catch(() => setRoles([]));
  }, [editing, project.id, project.guild_id]);

  async function save() {
    if (guild && !/^\d+$/.test(guild)) {
      setErr("guild_id — только цифры");
      return;
    }
    try {
      await api.updateProject(project.id, {
        guild_id: guild || null,
        master_role_id: masterRole || null,
        player_role_id: playerRole || null,
      });
      setEditing(false);
      setErr(null);
      onSaved();
    } catch (e) {
      setErr(String(e));
    }
  }

  if (!editing) {
    return (
      <button className="ghost" onClick={() => setEditing(true)}>
        ⚙ Сервер: {project.guild_id ?? "не задан"}
      </button>
    );
  }

  const roleSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 200 }}>
      <option value="">— не выбрана —</option>
      {roles.map((r) => (
        <option key={r.role_id} value={r.role_id}>
          {r.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="card" style={{ minWidth: 320 }}>
      <div>
        <label>Discord server (guild) ID</label>
        <input value={guild} placeholder="guild_id" onChange={(e) => setGuild(e.target.value)} />
      </div>
      <div>
        <label>Роль мастеров</label>
        {project.guild_id ? (
          roleSelect(masterRole, setMasterRole)
        ) : (
          <span className="muted">укажите сервер, чтобы выбрать роли</span>
        )}
      </div>
      <div>
        <label>Роль игроков проекта</label>
        {project.guild_id && roleSelect(playerRole, setPlayerRole)}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Этим ролям всегда открыт доступ к приватным каналам, которые создаёт дашборд.
      </p>
      {err && <div className="error">{err}</div>}
      <div className="row spread">
        <button className="ghost" onClick={() => setEditing(false)}>
          Отмена
        </button>
        <button className="primary" onClick={save}>
          Сохранить
        </button>
      </div>
    </div>
  );
}
