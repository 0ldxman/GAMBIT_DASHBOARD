import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import type { AppNotification, Project } from "../types";
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

function GuildSetting({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.guild_id?.toString() ?? "");
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (value && !/^\d+$/.test(value)) {
      setErr("Только число");
      return;
    }
    try {
      await api.updateProject(project.id, { guild_id: value || null });
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
        Discord server: {project.guild_id ?? "не задан"}
      </button>
    );
  }
  return (
    <div className="row" style={{ gap: 6 }}>
      <input
        value={value}
        placeholder="guild_id"
        style={{ width: 200 }}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="primary" onClick={save}>
        ОК
      </button>
      <button className="ghost" onClick={() => setEditing(false)}>
        ✕
      </button>
      {err && <span className="error">{err}</span>}
    </div>
  );
}
