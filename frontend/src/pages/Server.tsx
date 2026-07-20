import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Modal } from "../components/Modal";
import { CategoryPicker } from "../components/CategoryPicker";
import { GuildIcon, plural } from "./Servers";
import type { DiscordChannel, DiscordGuild, Project, ProjectStats } from "../types";

/** Проекты, идущие на одном сервере. Сервер здесь уже известен — вводить его не нужно. */
export function ServerPage() {
  const { guildId } = useParams();
  const gid = guildId!;

  const guilds = useAsync<DiscordGuild[]>(() => api.listGuilds(), []);
  const projects = useAsync<Project[]>(() => api.listProjects(gid), [gid]);
  const stats = useAsync<ProjectStats[]>(
    () => api.projectStats(gid).catch(() => []),
    [gid],
  );
  const channels = useAsync<DiscordChannel[]>(() => api.listGuildChannels(gid), [gid]);
  const [creating, setCreating] = useState(false);

  const guild = guilds.data?.find((g) => g.guild_id === gid);
  const statsFor = (id: number) => stats.data?.find((s) => s.project_id === id);

  return (
    <div>
      <div className="crumbs">
        <Link to="/">Серверы</Link> / {guild?.name ?? gid}
      </div>

      <header className="page-header">
        {guild && <GuildIcon guild={guild} size={64} />}
        <div className="page-header-text">
          <h1>{guild?.name ?? "Сервер"}</h1>
          <p className="muted">
            {guild?.member_count != null &&
              `${guild.member_count} ${plural(
                guild.member_count,
                "участник",
                "участника",
                "участников",
              )} · `}
            {projects.data?.length ?? 0}{" "}
            {plural(projects.data?.length ?? 0, "проект", "проекта", "проектов")}
          </p>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>
          + Новый проект
        </button>
      </header>

      <h2 className="section-title">Проекты</h2>

      {projects.loading && <p className="muted">Загрузка…</p>}
      {projects.error && <p className="error">{projects.error}</p>}
      {projects.data?.length === 0 && (
        <p className="muted">На этом сервере пока нет проектов. Создайте первый.</p>
      )}

      <div className="project-grid">
        {projects.data?.map((p) => {
          const s = statsFor(p.id);
          return (
            <Link key={p.id} to={`/projects/${p.id}`} className="card project-card">
              <div>
                <h3 className="project-name">{p.label}</h3>
                {p.type && <div className="project-type">{p.type}</div>}
              </div>
              {p.desc && <p className="muted project-desc">{p.desc}</p>}
              <div className="project-stats">
                <span>
                  👤 {s?.player_count ?? 0}{" "}
                  {plural(s?.player_count ?? 0, "игрок", "игрока", "игроков")}
                </span>
                <span>
                  🗂 {s?.entity_count ?? 0}{" "}
                  {plural(s?.entity_count ?? 0, "сущность", "сущности", "сущностей")}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {creating && (
        <CreateProjectModal
          guildId={gid}
          channels={channels.data ?? []}
          channelsLoading={channels.loading}
          channelsError={channels.error}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            projects.reload();
          }}
        />
      )}
    </div>
  );
}

function CreateProjectModal({
  guildId,
  channels,
  channelsLoading,
  channelsError,
  onClose,
  onCreated,
}: {
  guildId: string;
  channels: DiscordChannel[];
  channelsLoading: boolean;
  channelsError: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState("");
  const [desc, setDesc] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.createProject({
        label,
        type,
        desc,
        guild_id: guildId,
        category_ids: categoryIds,
      });
      onCreated();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Новый проект" onClose={onClose}>
      <div className="stack">
        <div>
          <label>Название</label>
          <input value={label} autoFocus onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <label>Тип / жанр</label>
          <input value={type} onChange={(e) => setType(e.target.value)} />
        </div>
        <div>
          <label>Описание</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div>
          <label>Категории проекта</label>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Всё внутри выбранных категорий принадлежит проекту — по ним бот понимает,
            к какой игре относится команда.
          </p>
          <CategoryPicker
            channels={channels}
            selected={categoryIds}
            onChange={setCategoryIds}
            loading={channelsLoading}
            error={channelsError}
          />
        </div>
        {err && <div className="error">{err}</div>}
        <div className="row spread">
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" disabled={busy || !label} onClick={save}>
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}
