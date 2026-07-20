import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Modal } from "../components/Modal";
import { CategoryPicker } from "../components/CategoryPicker";
import { GuildIcon } from "./Servers";
import type { DiscordChannel, DiscordGuild, Project } from "../types";

/** Проекты, идущие на одном сервере. Сервер здесь уже известен — вводить его не нужно. */
export function ServerPage() {
  const { guildId } = useParams();
  const gid = guildId!;

  const guilds = useAsync<DiscordGuild[]>(() => api.listGuilds(), []);
  const projects = useAsync<Project[]>(() => api.listProjects(gid), [gid]);
  const channels = useAsync<DiscordChannel[]>(() => api.listGuildChannels(gid), [gid]);
  const [creating, setCreating] = useState(false);

  const guild = guilds.data?.find((g) => g.guild_id === gid);

  return (
    <div>
      <div className="crumbs">
        <Link to="/">Серверы</Link> / {guild?.name ?? gid}
      </div>

      <div className="row spread">
        <div className="row" style={{ gap: 12 }}>
          {guild && <GuildIcon guild={guild} size={40} />}
          <h1 style={{ margin: 0 }}>{guild?.name ?? "Сервер"}</h1>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>
          + Новый проект
        </button>
      </div>

      {projects.loading && <p className="muted">Загрузка…</p>}
      {projects.error && <p className="error">{projects.error}</p>}
      {projects.data?.length === 0 && (
        <p className="muted">На этом сервере пока нет проектов. Создайте первый.</p>
      )}

      <div className="grid">
        {projects.data?.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card">
            <h3>{p.label}</h3>
            {p.type && <div className="muted">{p.type}</div>}
            {p.desc && <p className="muted">{p.desc}</p>}
          </Link>
        ))}
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
