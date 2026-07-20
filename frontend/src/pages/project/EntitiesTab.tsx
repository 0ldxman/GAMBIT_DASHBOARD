import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Modal } from "../../components/Modal";
import { MembersSummary } from "../../components/PlayerBadge";
import { PingBell } from "../../components/PingBell";
import type { Entity, EntityPingCount, EntityType } from "../../types";

export function EntitiesTab({ projectId }: { projectId: number }) {
  const entities = useAsync<Entity[]>(() => api.listEntities(projectId), [projectId]);
  const types = useAsync<EntityType[]>(() => api.listTypes(projectId), [projectId]);
  const pings = useAsync<EntityPingCount[]>(
    () => api.entityPingCounts(projectId).catch(() => []),
    [projectId],
  );
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const typeName = (id: number | null) =>
    types.data?.find((t) => t.id === id)?.label ?? "—";
  const pingsFor = (id: number) =>
    pings.data?.find((p) => p.entity_id === id)?.unread ?? 0;

  return (
    <div>
      <div className="row spread">
        <h2 style={{ border: "none" }}>Сущности</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          + Сущность
        </button>
      </div>

      {entities.loading && <p className="muted">Загрузка…</p>}
      {entities.error && <p className="error">{entities.error}</p>}

      {entities.data && entities.data.length > 0 && (
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
            {entities.data.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link to={`/projects/${projectId}/entities/${e.id}`}>{e.label}</Link>
                  <PingBell count={pingsFor(e.id)} />
                </td>
                <td className="muted">{typeName(e.type_id)}</td>
                <td>
                  <MembersSummary members={e.members} />
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="ghost"
                    onClick={() =>
                      navigate(`/projects/${projectId}/posts/new?entity=${e.id}`)
                    }
                  >
                    Написать верд
                  </button>
                  <button
                    className="ghost danger"
                    onClick={async () => {
                      if (confirm(`Удалить «${e.label}»?`)) {
                        await api.deleteEntity(projectId, e.id);
                        entities.reload();
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
      {entities.data?.length === 0 && <p className="muted">Сущностей пока нет.</p>}

      {creating && (
        <CreateEntityModal
          projectId={projectId}
          types={types.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            entities.reload();
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
  onCreated: () => void;
}) {
  const [label, setLabel] = useState("");
  const [typeId, setTypeId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.createEntity(projectId, { label, type_id: typeId, attributes: {} });
      onCreated();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Новая сущность" onClose={onClose}>
      <div className="stack">
        <div>
          <label>Название</label>
          <input value={label} autoFocus onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
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
        </div>
        {err && <div className="error">{err}</div>}
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
