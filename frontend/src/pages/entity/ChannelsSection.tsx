import { useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import type { DiscordChannel, EntityChannel } from "../../types";

/** Каналы сущности: привязка существующих и создание новых прямо из дашборда. */
export function ChannelsSection({
  projectId,
  entityId,
}: {
  projectId: number;
  entityId: number;
}) {
  const links = useAsync<EntityChannel[]>(
    () => api.listEntityChannels(projectId, entityId),
    [projectId, entityId],
  );
  const guild = useAsync<DiscordChannel[]>(
    () => api.listDiscordChannels(projectId).catch(() => []),
    [projectId],
  );

  const [selected, setSelected] = useState("");
  const [newName, setNewName] = useState("");
  const [category, setCategory] = useState("");
  const [priv, setPriv] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const linked = new Set((links.data ?? []).map((l) => l.discord_channel_id));
  const categories = (guild.data ?? []).filter((c) => c.type === "category");

  async function link() {
    const ch = guild.data?.find((c) => c.channel_id === selected);
    if (!ch) return;
    setBusy(true);
    setErr(null);
    try {
      await api.linkEntityChannel(projectId, entityId, {
        discord_channel_id: ch.channel_id,
        label: ch.name,
        sync_access: true,
      });
      setSelected("");
      links.reload();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!newName.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createDiscordChannel(projectId, {
        name: newName.trim(),
        channel_type: "text",
        parent_id: category || null,
        private: priv,
        entity_id: entityId,
        register_channel: true,
      });
      setNewName("");
      links.reload();
      guild.reload();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSync(l: EntityChannel) {
    await api.updateEntityChannel(projectId, entityId, l.id, { sync_access: !l.sync_access });
    links.reload();
  }

  async function unlink(l: EntityChannel) {
    if (!confirm("Отвязать канал? Сам канал в Discord останется, доступ пересчитается.")) return;
    await api.unlinkEntityChannel(projectId, entityId, l.id);
    links.reload();
  }

  return (
    <section className="card">
      <h3 style={{ marginTop: 0 }}>Каналы</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        При «синхронизации доступа» канал видят участники всех связанных с ним сущностей.
        Игрок теряет доступ, только если не остался участником через другую сущность.
      </p>

      {links.loading && <p className="muted">Загрузка…</p>}
      {links.error && <p className="error">{links.error}</p>}
      {links.data?.length === 0 && <p className="muted">Каналов нет.</p>}

      {links.data?.map((l) => (
        <div className="row spread" key={l.id} style={{ marginTop: 8 }}>
          <span>
            # {l.label || l.discord_channel_id}{" "}
            <span className="muted" style={{ fontSize: 13 }}>
              {l.discord_channel_id}
            </span>
          </span>
          <div className="row" style={{ gap: 6 }}>
            <label className="row" style={{ margin: 0, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={l.sync_access}
                style={{ width: "auto", marginRight: 6 }}
                onChange={() => toggleSync(l)}
              />
              синхронизировать доступ
            </label>
            <button className="ghost danger" onClick={() => unlink(l)}>
              ✕
            </button>
          </div>
        </div>
      ))}

      <label style={{ marginTop: 16 }}>Привязать существующий</label>
      <div className="row" style={{ gap: 8 }}>
        <select value={selected} style={{ flex: 1 }} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— выберите канал —</option>
          {(guild.data ?? [])
            .filter((c) => c.type === "text" || c.type === "forum")
            .map((c) => (
              <option key={c.channel_id} value={c.channel_id} disabled={linked.has(c.channel_id)}>
                {c.parent_name ? `${c.parent_name} / ` : ""}#{c.name}
                {linked.has(c.channel_id) ? " — уже привязан" : ""}
              </option>
            ))}
        </select>
        <button className="ghost" onClick={link} disabled={busy || !selected}>
          Привязать
        </button>
      </div>

      <label style={{ marginTop: 16 }}>Создать новый канал</label>
      <div className="row" style={{ gap: 8 }}>
        <input
          value={newName}
          placeholder="название канала"
          onChange={(e) => setNewName(e.target.value)}
        />
        <select value={category} style={{ width: 200 }} onChange={(e) => setCategory(e.target.value)}>
          <option value="">— без категории —</option>
          {categories.map((c) => (
            <option key={c.channel_id} value={c.channel_id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="row" style={{ margin: 0, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={priv}
            style={{ width: "auto", marginRight: 6 }}
            onChange={(e) => setPriv(e.target.checked)}
          />
          приватный
        </label>
        <button className="primary" onClick={create} disabled={busy || !newName.trim()}>
          Создать
        </button>
      </div>

      {err && <div className="error">{err}</div>}
    </section>
  );
}
