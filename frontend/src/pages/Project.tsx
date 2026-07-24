import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import type { AppNotification, DiscordGuild, Project, Registration } from "../types";
import { EntitiesTab } from "./project/EntitiesTab";
import { EntityTypesTab } from "./project/EntityTypesTab";
import { RelationsTab } from "./project/RelationsTab";
import { TurnTab } from "./project/TurnTab";
import { ChannelsTab } from "./project/ChannelsTab";
import { PostsTab } from "./project/PostsTab";
import { FormsTab } from "./project/FormsTab";
import { RegistrationsTab } from "./project/RegistrationsTab";
import { NotificationsTab } from "./project/NotificationsTab";
import { SettingsTab } from "./project/SettingsTab";
import { Section } from "../components/Section";

/**
 * Вкладки проекта двумя группами: слева то, чем занимаются каждый ход
 * (верды, сущности, типы), справа — настройка игры. «Заявки» и «Уведомления»
 * из этого ряда убраны: это входящие, им место у счётчика справа.
 */
const CONTENT = ["posts", "entities", "types", "relations", "turn"] as const;
const CONFIG = ["channels", "forms", "settings"] as const;
const TABS = [...CONTENT, ...CONFIG, "inbox"] as const;

type Tab = (typeof TABS)[number];

const LABELS: Record<Tab, string> = {
  posts: "Верды",
  entities: "Сущности",
  types: "Типы",
  relations: "Связи",
  turn: "Ход",
  channels: "Каналы",
  forms: "Формы",
  settings: "Настройки",
  inbox: "Входящие",
};

/** Старые ссылки вида ?tab=registrations продолжают работать. */
const ALIASES: Record<string, Tab> = {
  registrations: "inbox",
  notifications: "inbox",
};

export function ProjectPage() {
  const { projectId } = useParams();
  const pid = Number(projectId);
  const project = useAsync<Project>(() => api.getProject(pid), [pid]);
  const guilds = useAsync<DiscordGuild[]>(() => api.listGuilds().catch(() => []), []);

  // Вкладка живёт в URL: ссылки с других экранов открывают нужный раздел.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab") ?? "";
  const resolved = (ALIASES[requested] ?? requested) as Tab;
  const tab: Tab = TABS.includes(resolved) ? resolved : "posts";
  const setTab = (t: Tab) => setSearchParams(t === "posts" ? {} : { tab: t });

  // Непрочитанное — для счётчика входящих и периодического опроса.
  const [unread, setUnread] = useState<AppNotification[]>([]);
  const [pending, setPending] = useState<Registration[]>([]);
  const refreshInbox = () => {
    api.listNotifications(pid, true).then(setUnread).catch(() => {});
    api.listRegistrations(pid, "pending").then(setPending).catch(() => {});
  };
  useEffect(() => {
    refreshInbox();
    const t = setInterval(refreshInbox, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  const guild = guilds.data?.find((g) => g.guild_id === project.data?.guild_id);
  const inboxCount = unread.length + pending.length;

  const tabButton = (key: Tab) => (
    <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
      {LABELS[key]}
    </button>
  );

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

      <header className="page-header">
        <div className="page-header-text">
          <h1>{project.data?.label ?? "Проект"}</h1>
          {project.data?.desc && <p className="muted">{project.data.desc}</p>}
        </div>
      </header>

      <div className="tabs">
        {CONTENT.map(tabButton)}
        <span className="tabs-sep" />
        {CONFIG.map(tabButton)}
        <span style={{ flex: 1 }} />
        <button className={tab === "inbox" ? "active" : ""} onClick={() => setTab("inbox")}>
          🔔 {LABELS.inbox}
          {inboxCount > 0 && <span className="ping-count" style={{ marginLeft: 6 }}>{inboxCount}</span>}
        </button>
      </div>

      {tab === "posts" && <PostsTab projectId={pid} />}
      {tab === "entities" && <EntitiesTab projectId={pid} />}
      {tab === "types" && <EntityTypesTab projectId={pid} />}
      {tab === "relations" && <RelationsTab projectId={pid} />}
      {tab === "turn" && <TurnTab projectId={pid} />}
      {tab === "channels" && <ChannelsTab projectId={pid} />}
      {tab === "forms" && <FormsTab projectId={pid} />}
      {tab === "settings" && project.data && (
        <SettingsTab project={project.data} onSaved={() => project.reload()} />
      )}
      {tab === "inbox" && (
        <div className="stack">
          <Section
            id="inbox-regs"
            title="Заявки"
            summary={pending.length > 0 ? `${pending.length} ждут решения` : "новых нет"}
            warn={pending.length > 0}
            defaultOpen
          >
            <RegistrationsTab projectId={pid} onChange={refreshInbox} />
          </Section>
          <Section
            id="inbox-notes"
            title="Уведомления"
            summary={unread.length > 0 ? `${unread.length} непрочитанных` : "всё прочитано"}
            warn={unread.length > 0}
            defaultOpen={unread.length > 0}
          >
            <NotificationsTab projectId={pid} onChange={refreshInbox} />
          </Section>
        </div>
      )}
    </div>
  );
}
