import { useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Modal } from "../../components/Modal";
import type { Channel, DiscordChannel } from "../../types";

const TYPE_ICON: Record<string, string> = {
  text: "#",
  voice: "🔊",
  category: "📁",
  news: "📢",
  forum: "💬",
  stage: "🎤",
};

export function ChannelsTab({ projectId }: { projectId: number }) {
  const channels = useAsync<Channel[]>(() => api.listChannels(projectId), [projectId]);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div className="row spread">
        <h2 style={{ border: "none" }}>Каналы и категории</h2>
        <button className="primary" onClick={() => setAdding(true)}>
          + Канал
        </button>
      </div>

      {channels.loading && <p className="muted">Загрузка…</p>}
      {channels.error && <p className="error">{channels.error}</p>}

      {channels.data && channels.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Канал</th>
              <th>Discord ID</th>
              <th>Тип</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {channels.data.map((c) => (
              <tr key={c.id}>
                <td>
                  {TYPE_ICON[c.channel_type] ?? "#"} {c.label || <span className="muted">без названия</span>}
                </td>
                <td className="muted" style={{ fontFamily: "ui-monospace, monospace" }}>
                  {c.channel_id}
                </td>
                <td className="muted">{c.channel_type || "—"}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="ghost danger"
                    onClick={async () => {
                      if (confirm("Удалить канал?")) {
                        await api.deleteChannel(projectId, c.id);
                        channels.reload();
                      }
                    }}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {channels.data?.length === 0 && <p className="muted">Каналов пока нет.</p>}

      {adding && (
        <AddChannelModal
          projectId={projectId}
          existing={channels.data ?? []}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            channels.reload();
          }}
        />
      )}
    </div>
  );
}

function AddChannelModal({
  projectId,
  existing,
  onClose,
  onAdded,
}: {
  projectId: number;
  existing: Channel[];
  onClose: () => void;
  onAdded: () => void;
}) {
  // Список каналов сервера тянем через бота/Discord API.
  const guild = useAsync<DiscordChannel[]>(
    () => api.listDiscordChannels(projectId),
    [projectId],
  );
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [manualId, setManualId] = useState("");
  const [manualLabel, setManualLabel] = useState("");
  const [manualType, setManualType] = useState("text");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const alreadyAdded = new Set(existing.map((c) => c.channel_id));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      if (manual) {
        if (!/^\d+$/.test(manualId)) {
          setErr("Discord channel_id должен быть числом");
          setBusy(false);
          return;
        }
        await api.createChannel(projectId, {
          channel_id: manualId,
          channel_type: manualType,
          label: manualLabel,
        });
      } else {
        const ch = guild.data?.find((c) => c.channel_id === selected);
        if (!ch) {
          setErr("Выберите канал");
          setBusy(false);
          return;
        }
        // Имя канала сохраняем в label — чтобы показывать его в списке.
        await api.createChannel(projectId, {
          channel_id: ch.channel_id,
          channel_type: ch.type,
          label: ch.name,
        });
      }
      onAdded();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Привязать Discord-канал" onClose={onClose}>
      <div className="stack">
        {!manual && (
          <>
            {guild.loading && <p className="muted">Загружаю каналы сервера…</p>}
            {guild.error && (
              <div className="stack">
                <div className="error">{guild.error}</div>
                <p className="muted">
                  Проверьте, что у проекта задан Discord server (guild_id), бот приглашён на сервер,
                  а у backend есть DISCORD_BOT_TOKEN.
                </p>
              </div>
            )}
            {guild.data && (
              <div>
                <label>Канал сервера</label>
                <select
                  size={10}
                  value={selected}
                  style={{ height: "auto" }}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {guild.data.map((c) => (
                    <option
                      key={c.channel_id}
                      value={c.channel_id}
                      disabled={alreadyAdded.has(c.channel_id)}
                    >
                      {c.parent_name ? `${c.parent_name} / ` : ""}
                      {TYPE_ICON[c.type] ?? "#"} {c.name}
                      {alreadyAdded.has(c.channel_id) ? " — уже добавлен" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        {manual && (
          <>
            <div>
              <label>Название (для удобства)</label>
              <input value={manualLabel} onChange={(e) => setManualLabel(e.target.value)} />
            </div>
            <div>
              <label>Discord channel_id</label>
              <input value={manualId} onChange={(e) => setManualId(e.target.value)} />
            </div>
            <div>
              <label>Тип</label>
              <select value={manualType} onChange={(e) => setManualType(e.target.value)}>
                <option value="text">text</option>
                <option value="category">category</option>
                <option value="forum">forum</option>
                <option value="news">news</option>
              </select>
            </div>
          </>
        )}

        <button className="ghost" onClick={() => setManual(!manual)}>
          {manual ? "← Выбрать из списка сервера" : "Ввести ID вручную →"}
        </button>

        {err && <div className="error">{err}</div>}
        <div className="row spread">
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="primary"
            disabled={busy || (manual ? !manualId : !selected)}
            onClick={save}
          >
            Привязать
          </button>
        </div>
      </div>
    </Modal>
  );
}
