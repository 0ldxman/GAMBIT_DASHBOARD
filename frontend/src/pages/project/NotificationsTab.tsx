import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Empty, Skeleton } from "../../components/Empty";
import type { AppNotification } from "../../types";

const TYPE_LABEL: Record<string, string> = {
  ping: "Пинг",
  registration: "Заявка",
  system: "Система",
};

export function NotificationsTab({
  projectId,
  onChange,
}: {
  projectId: number;
  onChange: () => void;
}) {
  const notes = useAsync<AppNotification[]>(
    () => api.listNotifications(projectId),
    [projectId],
  );

  async function markRead(n: AppNotification) {
    await api.markNotificationRead(projectId, n.id);
    notes.reload();
    onChange();
  }

  async function markAll() {
    await api.markAllNotificationsRead(projectId);
    notes.reload();
    onChange();
  }

  return (
    <div>
      <div className="toolbar">
        <span style={{ flex: 1 }} />
        <button className="ghost small" onClick={markAll}>
          Прочитать всё
        </button>
      </div>

      {notes.loading && <Skeleton rows={2} height={70} />}
      {notes.error && <p className="error">{notes.error}</p>}
      {notes.data?.length === 0 && (
        <Empty icon="🔕" title="Уведомлений нет">
          Сюда прилетают пинги игроков (<code>/ping-master</code>) и новые заявки.
        </Empty>
      )}

      <div className="stack">
        {notes.data?.map((n) => (
          <div
            key={n.id}
            className="card"
            style={{ opacity: n.is_read ? 0.55 : 1 }}
          >
            <div className="row spread">
              <div className="row" style={{ gap: 8 }}>
                <span className={`badge ${n.type === "ping" ? "scheduled" : "published"}`}>
                  {TYPE_LABEL[n.type]}
                </span>
                <strong>{n.message}</strong>
              </div>
              {!n.is_read && (
                <button className="ghost" onClick={() => markRead(n)}>
                  Прочитано
                </button>
              )}
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {new Date(n.created_at).toLocaleString()}
              {n.player_id ? ` · игрок ${n.player_id}` : ""}
              {n.discord_channel_id ? ` · #${n.discord_channel_id}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
