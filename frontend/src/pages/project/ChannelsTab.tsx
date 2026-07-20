import { useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Modal } from "../../components/Modal";
import type { Channel } from "../../types";

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
              <th>Название</th>
              <th>Discord channel_id</th>
              <th>Тип</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {channels.data.map((c) => (
              <tr key={c.id}>
                <td>{c.label || "—"}</td>
                <td className="muted">{c.channel_id}</td>
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
  onClose,
  onAdded,
}: {
  projectId: number;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [label, setLabel] = useState("");
  const [channelId, setChannelId] = useState("");
  const [channelType, setChannelType] = useState("text");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!/^\d+$/.test(channelId)) {
      setErr("channel_id должен быть числом (Discord snowflake)");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.createChannel(projectId, {
        label,
        channel_id: Number(channelId),
        channel_type: channelType,
      });
      onAdded();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Привязать Discord-канал" onClose={onClose}>
      <div className="stack">
        <div>
          <label>Название (для удобства)</label>
          <input value={label} autoFocus onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <label>Discord channel_id</label>
          <input value={channelId} onChange={(e) => setChannelId(e.target.value)} />
        </div>
        <div>
          <label>Тип</label>
          <select value={channelType} onChange={(e) => setChannelType(e.target.value)}>
            <option value="text">text</option>
            <option value="category">category</option>
            <option value="forum">forum</option>
            <option value="news">news</option>
          </select>
        </div>
        {err && <div className="error">{err}</div>}
        <div className="row spread">
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" disabled={busy || !channelId} onClick={save}>
            Привязать
          </button>
        </div>
      </div>
    </Modal>
  );
}
