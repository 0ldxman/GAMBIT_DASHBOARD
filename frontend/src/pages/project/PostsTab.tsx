import { useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Modal } from "../../components/Modal";
import type { Channel, Entity, EntityEdit, Post } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  draft: "черновик",
  scheduled: "запланирован",
  published: "опубликован",
};

export function PostsTab({ projectId }: { projectId: number }) {
  const posts = useAsync<Post[]>(() => api.listPosts(projectId), [projectId]);
  const channels = useAsync<Channel[]>(() => api.listChannels(projectId), [projectId]);
  const entities = useAsync<Entity[]>(() => api.listEntities(projectId), [projectId]);
  const [editing, setEditing] = useState<Post | "new" | null>(null);

  const channelName = (p: Post) => {
    if (p.target_channel_id == null) return "—";
    const c = channels.data?.find((x) => x.channel_id === p.target_channel_id);
    return c ? c.label || String(c.channel_id) : String(p.target_channel_id);
  };

  async function doPublish(p: Post) {
    if (!confirm(`Опубликовать «${p.title || "без названия"}»? Правки применятся к сущностям.`))
      return;
    try {
      await api.publishPost(projectId, p.id);
      posts.reload();
      entities.reload();
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
        <button className="primary" onClick={() => setEditing("new")}>
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
              <th>Правок</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {posts.data.map((p) => (
              <tr key={p.id}>
                <td>{p.title || <span className="muted">без названия</span>}</td>
                <td>
                  <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                </td>
                <td className="muted">{channelName(p)}</td>
                <td className="muted">{p.entity_edits.length}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {p.status !== "published" && (
                    <>
                      <button className="ghost" onClick={() => setEditing(p)}>
                        Изм.
                      </button>
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

      {editing && (
        <PostEditor
          projectId={projectId}
          post={editing === "new" ? null : editing}
          channels={channels.data ?? []}
          entities={entities.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            posts.reload();
          }}
        />
      )}
    </div>
  );
}

function PostEditor({
  projectId,
  post,
  channels,
  entities,
  onClose,
  onSaved,
}: {
  projectId: number;
  post: Post | null;
  channels: Channel[];
  entities: Entity[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(post?.title ?? "");
  const [channelId, setChannelId] = useState<number | null>(post?.channel_id ?? null);
  const [targetChannelId, setTargetChannelId] = useState(
    post?.target_channel_id?.toString() ?? "",
  );
  const [content, setContent] = useState(post?.content ?? "");
  const [edits, setEdits] = useState<EntityEdit[]>(post?.entity_edits ?? []);
  const [authorName, setAuthorName] = useState(post?.author_name ?? "");
  const [authorAvatar, setAuthorAvatar] = useState(post?.author_avatar_url ?? "");
  const [useEmbed, setUseEmbed] = useState(post?.use_embed ?? false);
  const [embedImage, setEmbedImage] = useState(post?.embed_image_url ?? "");
  const [embedColor, setEmbedColor] = useState(post?.embed_color ?? "#5865F2");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Выбор зарегистрированного канала подставляет его Discord channel_id.
  function pickRegistered(fk: string) {
    if (!fk) {
      setChannelId(null);
      return;
    }
    const ch = channels.find((c) => c.id === Number(fk));
    if (ch) {
      setChannelId(ch.id);
      setTargetChannelId(String(ch.channel_id));
    }
  }

  function addEdit() {
    const first = entities[0];
    if (!first) {
      setErr("Сначала создайте сущности");
      return;
    }
    setEdits([...edits, { entity_id: first.id, attributes: {} }]);
  }

  function setEditEntity(i: number, entityId: number) {
    setEdits(edits.map((e, idx) => (idx === i ? { ...e, entity_id: entityId } : e)));
  }

  function setEditAttrs(i: number, raw: string, ok: (v: boolean) => void) {
    try {
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      setEdits(edits.map((e, idx) => (idx === i ? { ...e, attributes: parsed } : e)));
      ok(true);
    } catch {
      ok(false);
    }
  }

  async function save() {
    if (targetChannelId && !/^\d+$/.test(targetChannelId)) {
      setErr("Discord channel_id должен быть числом");
      return;
    }
    setBusy(true);
    setErr(null);
    const payload = {
      title,
      channel_id: channelId,
      target_channel_id: targetChannelId ? Number(targetChannelId) : null,
      content,
      entity_edits: edits,
      author_name: authorName,
      author_avatar_url: authorAvatar,
      use_embed: useEmbed,
      embed_image_url: embedImage,
      embed_color: embedColor,
    };
    try {
      if (post) await api.updatePost(projectId, post.id, payload);
      else await api.createPost(projectId, payload);
      onSaved();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={post ? "Редактирование верда" : "Новый верд"} onClose={onClose}>
      <div className="stack">
        <div>
          <label>Заголовок {useEmbed && <span className="muted">(= заголовок эмбеда)</span>}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Канал из проекта</label>
            <select value={channelId ?? ""} onChange={(e) => pickRegistered(e.target.value)}>
              <option value="">— вручную —</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label || c.channel_id}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Discord channel_id (любой канал)</label>
            <input
              value={targetChannelId}
              placeholder="напр. 123456789012345678"
              onChange={(e) => {
                setTargetChannelId(e.target.value);
                setChannelId(null);
              }}
            />
          </div>
        </div>

        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Автор (имя вебхука)</label>
            <input value={authorName} onChange={(e) => setAuthorName(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Аватар автора (URL)</label>
            <input value={authorAvatar} onChange={(e) => setAuthorAvatar(e.target.value)} />
          </div>
        </div>

        <div>
          <label>Текст сообщения</label>
          <textarea value={content} style={{ minHeight: 100 }} onChange={(e) => setContent(e.target.value)} />
        </div>

        <div className="stack" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
          <label style={{ margin: 0 }} className="row" >
            <input
              type="checkbox"
              checked={useEmbed}
              style={{ width: "auto", marginRight: 8 }}
              onChange={(e) => setUseEmbed(e.target.checked)}
            />
            Добавить эмбед (title + текст сообщения как описание + автор)
          </label>
          {useEmbed && (
            <div className="row" style={{ gap: 12 }}>
              <div style={{ flex: 2 }}>
                <label>Картинка эмбеда (URL)</label>
                <input value={embedImage} onChange={(e) => setEmbedImage(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Цвет (hex)</label>
                <input value={embedColor} onChange={(e) => setEmbedColor(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="row spread">
            <label style={{ margin: 0 }}>Правки сущностей (применятся при публикации)</label>
            <button className="ghost" onClick={addEdit}>
              + правка
            </button>
          </div>
          {edits.map((edit, i) => (
            <EditRow
              key={i}
              edit={edit}
              entities={entities}
              onEntity={(id) => setEditEntity(i, id)}
              onAttrs={(raw, ok) => setEditAttrs(i, raw, ok)}
              onRemove={() => setEdits(edits.filter((_, idx) => idx !== i))}
            />
          ))}
        </div>

        {err && <div className="error">{err}</div>}
        <div className="row spread">
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" disabled={busy} onClick={save}>
            Сохранить черновик
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditRow({
  edit,
  entities,
  onEntity,
  onAttrs,
  onRemove,
}: {
  edit: EntityEdit;
  entities: Entity[];
  onEntity: (id: number) => void;
  onAttrs: (raw: string, ok: (v: boolean) => void) => void;
  onRemove: () => void;
}) {
  const [raw, setRaw] = useState(JSON.stringify(edit.attributes));
  const [valid, setValid] = useState(true);

  return (
    <div className="stack" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginTop: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <select
          value={edit.entity_id}
          onChange={(e) => onEntity(Number(e.target.value))}
          style={{ flex: 1 }}
        >
          {entities.map((en) => (
            <option key={en.id} value={en.id}>
              {en.label}
            </option>
          ))}
        </select>
        <button className="ghost danger" onClick={onRemove}>
          ✕
        </button>
      </div>
      <input
        value={raw}
        placeholder='{"население": 145000000}'
        style={{ borderColor: valid ? undefined : "var(--danger)" }}
        onChange={(e) => {
          setRaw(e.target.value);
          onAttrs(e.target.value, setValid);
        }}
      />
      {!valid && <div className="error">Некорректный JSON</div>}
    </div>
  );
}
