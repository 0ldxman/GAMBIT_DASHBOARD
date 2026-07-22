import { useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { useConfirm, useToast } from "../../components/Feedback";
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
  // Тот же список, что на экране каналов проекта: только каналы категорий проекта.
  const guild = useAsync<DiscordChannel[]>(
    () => api.availableChannels(projectId).catch(() => []),
    [projectId],
  );

  const confirm = useConfirm();
  const toast = useToast();

  const [selected, setSelected] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const linked = new Set((links.data ?? []).map((l) => l.discord_channel_id));

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

  async function toggleSync(l: EntityChannel) {
    await api.updateEntityChannel(projectId, entityId, l.id, { sync_access: !l.sync_access });
    links.reload();
  }

  async function unlink(l: EntityChannel) {
    const ok = await confirm({
      title: `Отвязать канал ${l.label ? `«${l.label}»` : ""}?`,
      body: "Сам канал в Discord останется, но доступ игроков к нему пересчитается.",
      confirmLabel: "Отвязать",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.unlinkEntityChannel(projectId, entityId, l.id);
      toast.ok("Канал отвязан");
      links.reload();
    } catch (e) {
      toast.err(e);
    }
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

      <label style={{ marginTop: 16 }}>Дать доступ к каналу</label>
      <div className="row" style={{ gap: 8 }}>
        <select value={selected} style={{ flex: 1 }} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— выберите канал —</option>
          {(guild.data ?? []).map((c) => (
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
      <p className="muted" style={{ fontSize: 13 }}>
        Список — каналы категорий проекта. Новые каналы создаются во вкладке «Каналы».
      </p>

      {err && <div className="error">{err}</div>}
    </section>
  );
}
