import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import type { Channel, Post } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  draft: "черновик",
  scheduled: "запланирован",
  published: "опубликован",
};

export function PostsTab({ projectId }: { projectId: number }) {
  const posts = useAsync<Post[]>(() => api.listPosts(projectId), [projectId]);
  const channels = useAsync<Channel[]>(() => api.listChannels(projectId), [projectId]);
  const navigate = useNavigate();

  const channelName = (p: Post) => {
    if (p.target_channel_id == null) return "—";
    const c = channels.data?.find((x) => x.channel_id === p.target_channel_id);
    return c ? `#${c.label || c.channel_id}` : p.target_channel_id;
  };

  async function doPublish(p: Post) {
    if (!confirm(`Опубликовать «${p.title || "без названия"}»? Правки применятся к сущностям.`))
      return;
    try {
      await api.publishPost(projectId, p.id);
      posts.reload();
    } catch (e) {
      alert(String(e));
    }
  }

  async function doSchedule(p: Post) {
    const input = prompt("Время публикации (ISO, напр. 2026-08-01T18:00:00Z):");
    if (!input) return;
    try {
      await api.schedulePost(projectId, p.id, input);
      posts.reload();
    } catch (e) {
      alert(String(e));
    }
  }

  return (
    <div>
      <div className="row spread">
        <h2 style={{ border: "none" }}>Верды</h2>
        <button className="primary" onClick={() => navigate(`/projects/${projectId}/posts/new`)}>
          + Верд
        </button>
      </div>

      {posts.loading && <p className="muted">Загрузка…</p>}
      {posts.error && <p className="error">{posts.error}</p>}

      {posts.data && posts.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Заголовок</th>
              <th>Статус</th>
              <th>Канал</th>
              <th>Содержимое</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {posts.data.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/projects/${projectId}/posts/${p.id}`}>
                    {p.title || <span className="muted">без названия</span>}
                  </Link>
                </td>
                <td>
                  <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                </td>
                <td className="muted">{channelName(p)}</td>
                <td className="muted" style={{ fontSize: 13 }}>
                  {[
                    p.content && "текст",
                    p.use_embed && "эмбед",
                    p.attachments.length > 0 && `${p.attachments.length} влож.`,
                    p.entity_edits.length > 0 && `${p.entity_edits.length} правк.`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "пусто"}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {p.status !== "published" && (
                    <>
                      <button className="ghost" onClick={() => doPublish(p)}>
                        Опубл.
                      </button>
                      <button className="ghost" onClick={() => doSchedule(p)}>
                        ⏱
                      </button>
                    </>
                  )}
                  <button
                    className="ghost danger"
                    onClick={async () => {
                      if (confirm("Удалить верд?")) {
                        await api.deletePost(projectId, p.id);
                        posts.reload();
                      }
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {posts.data?.length === 0 && <p className="muted">Вердов пока нет.</p>}
    </div>
  );
}
