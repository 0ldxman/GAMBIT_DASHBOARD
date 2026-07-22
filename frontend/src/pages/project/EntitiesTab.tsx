import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Modal } from "../../components/Modal";
import { Empty, Skeleton } from "../../components/Empty";
import { MembersSummary } from "../../components/PlayerBadge";
import { PingBell } from "../../components/PingBell";
import { useConfirm, useToast } from "../../components/Feedback";
import type { Entity, EntityPingCount, EntityType } from "../../types";

export function EntitiesTab({ projectId }: { projectId: number }) {
  const entities = useAsync<Entity[]>(() => api.listEntities(projectId), [projectId]);
  const types = useAsync<EntityType[]>(() => api.listTypes(projectId), [projectId]);
  const pings = useAsync<EntityPingCount[]>(
    () => api.entityPingCounts(projectId).catch(() => []),
    [projectId],
  );
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<number | "all">("all");
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();

  const typeName = (id: number | null) => types.data?.find((t) => t.id === id)?.label ?? "—";
  const pingsFor = (id: number) => pings.data?.find((p) => p.entity_id === id)?.unread ?? 0;

  const all = entities.data ?? [];
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter(
      (e) =>
        (typeFilter === "all" || e.type_id === typeFilter) &&
        (!needle || e.label.toLowerCase().includes(needle)),
    );
  }, [all, query, typeFilter]);

  async function doDelete(e: Entity) {
    const ok = await confirm({
      title: `Удалить «${e.label}»?`,
      body: "Атрибуты, связи и привязки игроков исчезнут. Каналы в Discord останутся, но доступ к ним пересчитается.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteEntity(projectId, e.id);
      toast.ok(`«${e.label}» удалена`);
      entities.reload();
    } catch (err) {
      toast.err(err);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2 className="section-title" style={{ margin: 0 }}>
          Сущности
        </h2>
        <input
          className="search"
          value={query}
          placeholder="поиск по названию…"
          onChange={(e) => setQuery(e.target.value)}
        />
        {(types.data ?? []).length > 1 && (
          <select
            value={typeFilter}
            style={{ width: "auto" }}
            onChange={(e) => setTypeFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">все типы</option>
            {types.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={() => setCreating(true)}>
          + Сущность
        </button>
      </div>

      {entities.loading && <Skeleton rows={4} />}
      {entities.error && <p className="error">{entities.error}</p>}

      {visible.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Тип</th>
              <th>Игроки</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link to={`/projects/${projectId}/entities/${e.id}`}>{e.label}</Link>
                  <PingBell count={pingsFor(e.id)} />
                </td>
                <td className="muted">{typeName(e.type_id)}</td>
                <td>
                  <MembersSummary members={e.members} />
                </td>
                <td className="actions">
                  <button
                    className="ghost small"
                    onClick={() => navigate(`/projects/${projectId}/posts/new?entity=${e.id}`)}
                  >
                    Написать верд
                  </button>
                  <button className="icon danger" title="Удалить" onClick={() => doDelete(e)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!entities.loading && all.length === 0 && (
        <Empty
          icon="🏛"
          title="Сущностей пока нет"
          action={
            <button className="primary" onClick={() => setCreating(true)}>
              Создать первую
            </button>
          }
        >
          Сущность — это страна, фракция, персонаж или локация: набор атрибутов, карточка в
          Discord и игроки, которые ей управляют.
        </Empty>
      )}
      {!entities.loading && all.length > 0 && visible.length === 0 && (
        <Empty icon="🔍" title="Ничего не найдено">
          Ни одна сущность не подходит под фильтр.
        </Empty>
      )}

      {creating && (
        <CreateEntityModal
          projectId={projectId}
          types={types.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/projects/${projectId}/entities/${id}`);
          }}
        />
      )}
    </div>
  );
}

function CreateEntityModal({
  projectId,
  types,
  onClose,
  onCreated,
}: {
  projectId: number;
  types: EntityType[];
  onClose: () => void;
  onCreated: (entityId: number) => void;
}) {
  const [label, setLabel] = useState("");
  const [typeId, setTypeId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const schemaKeys = Object.keys(types.find((t) => t.id === typeId)?.attributes_schema ?? {}).length;

  async function save() {
    setBusy(true);
    try {
      // attributes не шлём вовсе: пустой объект — сигнал взять заготовку типа.
      const created = await api.createEntity(projectId, { label, type_id: typeId });
      toast.ok(`«${label}» создана`);
      onCreated(created.id);
    } catch (e) {
      toast.err(e);
      setBusy(false);
    }
  }

  return (
    <Modal title="Новая сущность" onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label>Название</label>
          <input value={label} autoFocus onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field">
          <label>Тип</label>
          <select
            value={typeId ?? ""}
            onChange={(e) => setTypeId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— без типа —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {schemaKeys > 0 && (
            <p className="hint" style={{ marginTop: "var(--s1)" }}>
              Сущность создастся с атрибутами типа: {schemaKeys}{" "}
              {schemaKeys === 1 ? "поле" : schemaKeys < 5 ? "поля" : "полей"} верхнего уровня.
            </p>
          )}
        </div>
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
