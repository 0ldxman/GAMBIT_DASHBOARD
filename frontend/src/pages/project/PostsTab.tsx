import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Empty, Skeleton } from "../../components/Empty";
import { Modal } from "../../components/Modal";
import { useConfirm, useToast } from "../../components/Feedback";
import type { Channel, Post } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  draft: "черновик",
  scheduled: "запланирован",
  published: "опубликован",
};

const WHEN_FMT = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Когда верд ушёл или уйдёт в канал. */
function whenLabel(p: Post): string {
  if (p.published_at) return WHEN_FMT.format(new Date(p.published_at));
  if (p.scheduled_at) return `→ ${WHEN_FMT.format(new Date(p.scheduled_at))}`;
  return "—";
}

/** Сколько осталось до отправки: «через 2 ч», «через 15 мин», «просрочен». */
function countdown(iso: string): string {
  const left = new Date(iso).getTime() - Date.now();
  if (left < 0) return "время прошло";
  const minutes = Math.round(left / 60000);
  if (minutes < 60) return `через ${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `через ${hours} ч`;
  return `через ${Math.round(hours / 24)} д`;
}

/** Что верд несёт в себе — одной строкой. */
function payload(p: Post): string {
  return (
    [
      p.content && "текст",
      p.use_embed && "эмбед",
      p.attachments.length > 0 && `${p.attachments.length} влож.`,
      p.entity_edits.length > 0 && `${p.entity_edits.length} правк.`,
    ]
      .filter(Boolean)
      .join(" · ") || "пусто"
  );
}

type Filter = "all" | "draft" | "scheduled" | "published";

const FILTER_LABEL: Record<Filter, string> = {
  all: "Все",
  draft: "Черновики",
  scheduled: "Запланированные",
  published: "Опубликованные",
};

export function PostsTab({ projectId }: { projectId: number }) {
  const posts = useAsync<Post[]>(() => api.listPosts(projectId), [projectId]);
  const channels = useAsync<Channel[]>(() => api.listChannels(projectId), [projectId]);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // Верд, которому назначают время: модалка с нормальным пикером вместо prompt.
  const [scheduling, setScheduling] = useState<Post | null>(null);

  const channelName = (p: Post) => {
    if (p.target_channel_id == null) return "—";
    const c = channels.data?.find((x) => x.channel_id === p.target_channel_id);
    return c ? `#${c.label || c.channel_id}` : p.target_channel_id;
  };

  const all = posts.data ?? [];
  // Запланированное — отдельным блоком сверху: ради него вкладку и открывают.
  const upcoming = useMemo(
    () =>
      all
        .filter((p) => p.status === "scheduled" && p.scheduled_at)
        .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "")),
    [all],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter(
      (p) =>
        (filter === "all" || p.status === filter) &&
        (!needle || p.title.toLowerCase().includes(needle)),
    );
  }, [all, filter, query]);

  async function doPublish(p: Post) {
    const edits = p.entity_edits.length;
    const ok = await confirm({
      title: `Опубликовать «${p.title || "без названия"}»?`,
      body: (
        <div className="stack tight">
          <div>
            Сообщение уйдёт в {channelName(p)} и вернуть его из дашборда будет нельзя.
          </div>
          {edits > 0 && (
            <div className="error">
              Правки применятся к {edits} {edits === 1 ? "сущности" : "сущностям"} — атрибуты
              изменятся.
            </div>
          )}
        </div>
      ),
      confirmLabel: "Опубликовать",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.publishPost(projectId, p.id);
      toast.ok("Верд опубликован");
      posts.reload();
    } catch (e) {
      toast.err(e);
    }
  }

  async function doDelete(p: Post) {
    const ok = await confirm({
      title: `Удалить «${p.title || "без названия"}»?`,
      body: "Черновик и его правки исчезнут безвозвратно.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePost(projectId, p.id);
      toast.ok("Верд удалён");
      posts.reload();
    } catch (e) {
      toast.err(e);
    }
  }

  const rows = (list: Post[]) => (
    <table>
      <thead>
        <tr>
          <th>Заголовок</th>
          <th>Статус</th>
          <th>Канал</th>
          <th>Когда</th>
          <th>Содержимое</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {list.map((p) => (
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
            <td className="muted" style={{ whiteSpace: "nowrap" }}>
              {whenLabel(p)}
            </td>
            <td className="muted">{payload(p)}</td>
            <td className="actions">
              {p.status !== "published" && (
                <>
                  <button className="ghost small" onClick={() => doPublish(p)}>
                    Опубликовать
                  </button>
                  <button className="ghost small" title="Запланировать" onClick={() => setScheduling(p)}>
                    ⏱
                  </button>
                </>
              )}
              <button className="icon danger" title="Удалить" onClick={() => doDelete(p)}>
                ✕
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div>
      <div className="toolbar">
        <h2 className="section-title" style={{ margin: 0 }}>
          Верды
        </h2>
        {(Object.keys(FILTER_LABEL) as Filter[]).map((key) => (
          <button
            key={key}
            className={filter === key ? "chip active" : "chip"}
            onClick={() => setFilter(key)}
          >
            {FILTER_LABEL[key]}
            {key !== "all" && ` ${all.filter((p) => p.status === key).length}`}
          </button>
        ))}
        <input
          className="search"
          value={query}
          placeholder="поиск по заголовку…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={() => navigate(`/projects/${projectId}/posts/new`)}>
          + Верд
        </button>
      </div>

      {posts.loading && <Skeleton rows={4} />}
      {posts.error && <p className="error">{posts.error}</p>}

      {upcoming.length > 0 && filter === "all" && !query && (
        <section className="card" style={{ marginBottom: "var(--s4)" }}>
          <h3>Уйдёт по расписанию</h3>
          <div className="stack tight">
            {upcoming.map((p) => (
              <div className="row spread" key={p.id}>
                <Link to={`/projects/${projectId}/posts/${p.id}`}>
                  {p.title || "без названия"}
                </Link>
                <span className="muted">
                  {channelName(p)} · {WHEN_FMT.format(new Date(p.scheduled_at!))} ·{" "}
                  <span className="badge scheduled">{countdown(p.scheduled_at!)}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {visible.length > 0 && rows(visible)}

      {!posts.loading && all.length === 0 && (
        <Empty
          icon="✍"
          title="Вердов пока нет"
          action={
            <button className="primary" onClick={() => navigate(`/projects/${projectId}/posts/new`)}>
              Написать первый
            </button>
          }
        >
          Верд — это пост-сводка в канал: текст, эмбед и правки атрибутов сущностей, которые
          применятся при публикации.
        </Empty>
      )}
      {!posts.loading && all.length > 0 && visible.length === 0 && (
        <Empty icon="🔍" title="Ничего не найдено">
          Ни один верд не подходит под фильтр.
        </Empty>
      )}

      {scheduling && (
        <ScheduleModal
          projectId={projectId}
          post={scheduling}
          onClose={() => setScheduling(null)}
          onDone={() => {
            setScheduling(null);
            posts.reload();
          }}
        />
      )}
    </div>
  );
}

/** ISO → значение для <input type="datetime-local"> в местном времени. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/**
 * Назначение времени публикации.
 *
 * Раньше здесь стоял нативный `prompt`, в который мастер вручную набирал ISO-строку
 * с часовым поясом. Теперь — обычный пикер в местном времени, как в редакторе верда.
 */
function ScheduleModal({
  projectId,
  post,
  onClose,
  onDone,
}: {
  projectId: number;
  post: Post;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(toLocalInput(post.scheduled_at));
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const when = value ? new Date(value) : null;
  const past = when != null && when.getTime() < Date.now();

  async function save() {
    if (!when) return;
    setBusy(true);
    try {
      await api.schedulePost(projectId, post.id, when.toISOString());
      toast.ok(`Верд уйдёт ${WHEN_FMT.format(when)}`);
      onDone();
    } catch (e) {
      toast.err(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Когда отправить «${post.title || "без названия"}»`} onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label>Дата и время (местное)</label>
          <input
            type="datetime-local"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {past && <div className="error">Это время уже прошло — верд не уйдёт.</div>}
        {when && !past && <p className="hint">Отправится {countdown(when.toISOString())}.</p>}
        <div className="row spread">
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" disabled={busy || !when || past} onClick={save}>
            Запланировать
          </button>
        </div>
      </div>
    </Modal>
  );
}
