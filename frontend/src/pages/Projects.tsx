import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Modal } from "../components/Modal";
import type { Project } from "../types";

export function Projects() {
  const { data, loading, error, reload } = useAsync<Project[]>(
    () => api.listProjects(),
    [],
  );
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="row spread">
        <h1>Проекты</h1>
        <button className="primary" onClick={() => setCreating(true)}>
          + Новый проект
        </button>
      </div>

      {loading && <p className="muted">Загрузка…</p>}
      {error && <p className="error">{error}</p>}

      {data && data.length === 0 && (
        <p className="muted">Пока нет проектов. Создайте первый.</p>
      )}

      <div className="grid">
        {data?.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card">
            <h3>{p.label}</h3>
            {p.type && <div className="muted">{p.type}</div>}
            {p.desc && <p className="muted">{p.desc}</p>}
          </Link>
        ))}
      </div>

      {creating && (
        <CreateProjectModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState("");
  const [desc, setDesc] = useState("");
  const [guildId, setGuildId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (guildId && !/^\d+$/.test(guildId)) {
      setErr("Discord guild_id должен быть числом");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.createProject({
        label,
        type,
        desc,
        guild_id: guildId ? Number(guildId) : null,
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
          <label>Discord server (guild) ID — для команд бота</label>
          <input value={guildId} placeholder="необязательно" onChange={(e) => setGuildId(e.target.value)} />
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
