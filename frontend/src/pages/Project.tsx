import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import type { AppNotification, DiscordGuild, Project } from "../types";
import { EntitiesTab } from "./project/EntitiesTab";
import { EntityTypesTab } from "./project/EntityTypesTab";
import { ChannelsTab } from "./project/ChannelsTab";
import { PostsTab } from "./project/PostsTab";
import { FormsTab } from "./project/FormsTab";
import { RegistrationsTab } from "./project/RegistrationsTab";
import { NotificationsTab } from "./project/NotificationsTab";
import { SettingsTab } from "./project/SettingsTab";

const TABS = [
  "posts",
  "entities",
  "types",
  "channels",
  "forms",
  "registrations",
  "notifications",
  "settings",
] as const;

type Tab = (typeof TABS)[number];

const LABELS: Record<Tab, string> = {
  posts: "Верды",
  entities: "Сущности",
  types: "Типы",
  channels: "Каналы",
  forms: "Формы",
  registrations: "Заявки",
  notifications: "Уведомления",
  settings: "Настройки",
};

export function ProjectPage() {
  const { projectId } = useParams();
  const pid = Number(projectId);
  const project = useAsync<Project>(() => api.getProject(pid), [pid]);
  const guilds = useAsync<DiscordGuild[]>(() => api.listGuilds().catch(() => []), []);

  // Вкладка живёт в URL: ссылки с других экранов открывают нужный раздел.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : "posts";
  const setTab = (t: Tab) => setSearchParams(t === "posts" ? {} : { tab: t });

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

  const guild = guilds.data?.find((g) => g.guild_id === project.data?.guild_id);

  return (
    <div>
      <div className="crumbs">
        <Link to="/">Серверы</Link> /{" "}
        {project.data?.guild_id && (
          <>
            <Link to={`/servers/${project.data.guild_id}`}>
              {guild?.name ?? project.data.guild_id}
            </Link>{" "}
            /{" "}
          </>
        )}
        {project.data?.label ?? "…"}
      </div>

      <h1>{project.data?.label ?? "Проект"}</h1>
      {project.data?.desc && <p className="muted">{project.data.desc}</p>}

      <div className="tabs">
        {TABS.map((key) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {LABELS[key]}
            {key === "notifications" && unread.length > 0 && (
              <span className="badge scheduled" style={{ marginLeft: 6 }}>
                {unread.length}
              </span>
            )}
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
      {tab === "settings" && project.data && (
        <SettingsTab project={project.data} onSaved={() => project.reload()} />
      )}
    </div>
  );
}
