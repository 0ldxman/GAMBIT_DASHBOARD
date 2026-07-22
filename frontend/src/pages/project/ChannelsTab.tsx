import { useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Modal } from "../../components/Modal";
import { useConfirm } from "../../components/Feedback";
import type { CategoryNode, ChannelNode, Entity, ChannelTree } from "../../types";

const TYPE_ICON: Record<string, string> = {
  text: "#",
  voice: "🔊",
  news: "📢",
  forum: "💬",
  stage: "🎤",
};

/** Каналы проекта: категории одна за другой, каналы внутри собираются из Discord. */
export function ChannelsTab({ projectId }: { projectId: number }) {
  const confirm = useConfirm();
  const tree = useAsync<ChannelTree>(() => api.channelTree(projectId), [projectId]);
  const entities = useAsync<Entity[]>(() => api.listEntities(projectId), [projectId]);
  const [creatingIn, setCreatingIn] = useState<CategoryNode | null>(null);
  const [access, setAccess] = useState<ChannelNode | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function removeChannel(ch: ChannelNode) {
    const ok = await confirm({
      title: `Удалить канал #${ch.name} в Discord?`,
      body: "Канал и вся его история пропадут на сервере. Отменить нельзя.",
      confirmLabel: "Удалить канал",
      danger: true,
    });
    if (!ok) return;
    setErr(null);
    try {
      await api.deleteDiscordChannel(projectId, ch.channel_id);
      tree.reload();
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div>
      <div className="row spread">
        <h2 style={{ border: "none" }}>Каналы</h2>
        <button className="ghost" onClick={() => tree.reload()}>
          Обновить
        </button>
      </div>
      <p className="muted">
        Каналы не хранятся в дашборде — состав категорий всегда берётся с сервера.
        Категории проекта настраиваются во вкладке «Настройки».
      </p>

      {tree.loading && <p className="muted">Загрузка…</p>}
      {tree.data?.error && <div className="error">{tree.data.error}</div>}
      {err && <div className="error">{err}</div>}
      {tree.data?.categories.length === 0 && !tree.data.error && (
        <p className="muted">
          У проекта нет категорий. Добавьте их во вкладке «Настройки».
        </p>
      )}

      {tree.data?.categories.map((cat) => (
        <section className="card" key={cat.id} style={{ marginTop: 16 }}>
          <div className="row spread">
            <h3 style={{ margin: 0 }}>
              📁 {cat.name}
              {cat.missing && (
                <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>
                  — категории больше нет на сервере
                </span>
              )}
            </h3>
            {!cat.missing && (
              <button className="ghost" title="Создать канал" onClick={() => setCreatingIn(cat)}>
                +
              </button>
            )}
          </div>

          {cat.channels.length === 0 && !cat.missing && (
            <p className="muted">В категории нет каналов.</p>
          )}

          {cat.channels.map((ch) => (
            <ChannelRow
              key={ch.channel_id}
              projectId={projectId}
              channel={ch}
              onAccess={() => setAccess(ch)}
              onDelete={() => removeChannel(ch)}
            />
          ))}
        </section>
      ))}

      {tree.data && tree.data.loose.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Вне категорий проекта</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Каналы, привязанные к проекту отдельно.
          </p>
          {tree.data.loose.map((ch) => (
            <ChannelRow
              key={ch.channel_id}
              projectId={projectId}
              channel={ch}
              onAccess={() => setAccess(ch)}
              onDelete={() => removeChannel(ch)}
            />
          ))}
        </section>
      )}

      {creatingIn && (
        <CreateChannelModal
          projectId={projectId}
          category={creatingIn}
          onClose={() => setCreatingIn(null)}
          onCreated={() => {
            setCreatingIn(null);
            tree.reload();
          }}
        />
      )}

      {access && (
        <AccessModal
          projectId={projectId}
          channel={access}
          entities={entities.data ?? []}
          onClose={() => setAccess(null)}
          onChanged={() => tree.reload()}
        />
      )}
    </div>
  );
}

function ChannelRow({
  projectId,
  channel,
  onAccess,
  onDelete,
}: {
  projectId: number;
  channel: ChannelNode;
  onAccess: () => void;
  onDelete: () => void;
}) {
  const [proxy, setProxy] = useState(channel.auto_proxy);
  const [err, setErr] = useState<string | null>(null);

  async function toggleProxy(value: boolean) {
    setProxy(value);
    setErr(null);
    try {
      await api.updateChannelSettings(projectId, channel.channel_id, { auto_proxy: value });
    } catch (e) {
      setProxy(!value); // не сохранилось — возвращаем галочку на место
      setErr(String(e));
    }
  }

  return (
    <div className="row spread channel-row">
      <span>
        {TYPE_ICON[channel.type] ?? "#"} {channel.name}
        {channel.entities.length > 0 && (
          <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>
            доступ: {channel.entities.map((e) => e.entity_label).join(", ")}
          </span>
        )}
        {err && <span className="error" style={{ fontSize: 13, marginLeft: 8 }}>{err}</span>}
      </span>
      <div className="row" style={{ gap: 6, alignItems: "center" }}>
        <label
          className="row muted"
          style={{ margin: 0, fontSize: 13, whiteSpace: "nowrap" }}
          title="Сообщения игрока уходят от лица его сущности: имя и аватарка подменяются вебхуком"
        >
          <input
            type="checkbox"
            checked={proxy}
            style={{ width: "auto", marginRight: 6 }}
            onChange={(e) => toggleProxy(e.target.checked)}
          />
          авто-подмена
        </label>
        <button className="ghost" onClick={onAccess}>
          Доступ
        </button>
        <button className="ghost danger" onClick={onDelete}>
          Удалить
        </button>
      </div>
    </div>
  );
}

/** Выдача доступа сущностям — тот же набор каналов, что и на экране сущности. */
function AccessModal({
  projectId,
  channel,
  entities,
  onClose,
  onChanged,
}: {
  projectId: number;
  channel: ChannelNode;
  entities: Entity[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [links, setLinks] = useState(channel.entities);
  const [entityId, setEntityId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const linked = new Set(links.map((l) => l.entity_id));

  async function grant() {
    if (entityId === "") return;
    setBusy(true);
    setErr(null);
    try {
      const link = await api.grantEntityChannel(projectId, channel.channel_id, Number(entityId));
      setLinks([...links, link]);
      setEntityId("");
      onChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(entity_id: number) {
    setBusy(true);
    setErr(null);
    try {
      await api.revokeEntityChannel(projectId, channel.channel_id, entity_id);
      setLinks(links.filter((l) => l.entity_id !== entity_id));
      onChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Доступ к #${channel.name}`} wide onClose={onClose}>
      <div className="stack">
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Канал видят игроки всех связанных сущностей. Игрок теряет доступ, только если
          не остался участником ни одной из них.
        </p>

        {links.length === 0 && <p className="muted">Сущностей не привязано.</p>}
        {links.map((l) => (
          <div className="row spread" key={l.link_id}>
            <span>{l.entity_label}</span>
            <button className="ghost danger" disabled={busy} onClick={() => revoke(l.entity_id)}>
              ✕
            </button>
          </div>
        ))}

        <div className="row" style={{ gap: 8 }}>
          <select
            value={entityId}
            style={{ flex: 1 }}
            onChange={(e) => setEntityId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">— добавить сущность —</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id} disabled={linked.has(e.id)}>
                {e.label}
                {linked.has(e.id) ? " — уже есть" : ""}
              </option>
            ))}
          </select>
          <button className="primary" onClick={grant} disabled={busy || entityId === ""}>
            Дать доступ
          </button>
        </div>

        {err && <div className="error">{err}</div>}
        <div className="row spread">
          <span />
          <button className="ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CreateChannelModal({
  projectId,
  category,
  onClose,
  onCreated,
}: {
  projectId: number;
  category: CategoryNode;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [channelType, setChannelType] = useState("text");
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.createDiscordChannel(projectId, {
        name: name.trim(),
        channel_type: channelType,
        parent_id: category.channel_id,
        private: priv,
        entity_id: null,
        // Канал и так внутри категории проекта — отдельная регистрация лишняя.
        register_channel: false,
      });
      onCreated();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Новый канал в «${category.name}»`} onClose={onClose}>
      <div className="stack">
        <div>
          <label>Название</label>
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label>Тип</label>
          <select value={channelType} onChange={(e) => setChannelType(e.target.value)}>
            <option value="text">текстовый</option>
            <option value="voice">голосовой</option>
            <option value="forum">форум</option>
            <option value="news">новостной</option>
          </select>
        </div>
        <label className="row" style={{ margin: 0, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={priv}
            style={{ width: "auto", marginRight: 8 }}
            onChange={(e) => setPriv(e.target.checked)}
          />
          приватный — закрыт от @everyone, открыт мастерским ролям
        </label>
        {err && <div className="error">{err}</div>}
        <div className="row spread">
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" disabled={busy || !name.trim()} onClick={save}>
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}
