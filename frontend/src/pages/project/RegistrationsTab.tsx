import { useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Modal } from "../../components/Modal";
import type { EntityType, Registration } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  pending: "ожидает",
  approved: "одобрена",
  rejected: "отклонена",
};
const STATUS_BADGE: Record<string, string> = {
  pending: "scheduled",
  approved: "published",
  rejected: "draft",
};

export function RegistrationsTab({ projectId }: { projectId: number }) {
  const [filter, setFilter] = useState<string>("pending");
  const regs = useAsync<Registration[]>(
    () => api.listRegistrations(projectId, filter || undefined),
    [projectId, filter],
  );
  const types = useAsync<EntityType[]>(() => api.listTypes(projectId), [projectId]);
  const [approving, setApproving] = useState<Registration | null>(null);

  async function reject(r: Registration) {
    if (!confirm("Отклонить заявку?")) return;
    await api.rejectRegistration(projectId, r.id);
    regs.reload();
  }

  return (
    <div>
      <div className="row spread">
        <h2 style={{ border: "none" }}>Заявки</h2>
        <select value={filter} style={{ width: 180 }} onChange={(e) => setFilter(e.target.value)}>
          <option value="">все</option>
          <option value="pending">ожидают</option>
          <option value="approved">одобренные</option>
          <option value="rejected">отклонённые</option>
        </select>
      </div>

      {regs.loading && <p className="muted">Загрузка…</p>}
      {regs.error && <p className="error">{regs.error}</p>}
      {regs.data?.length === 0 && <p className="muted">Заявок нет.</p>}

      <div className="stack">
        {regs.data?.map((r) => (
          <div key={r.id} className="card">
            <div className="row spread">
              <div className="row" style={{ gap: 8 }}>
                <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                <strong>{r.discord_username || r.discord_user_id}</strong>
                <span className="muted" style={{ fontSize: 13 }}>
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </div>
              {r.status === "pending" && (
                <div>
                  <button className="ghost" onClick={() => setApproving(r)}>
                    Одобрить
                  </button>
                  <button className="ghost danger" onClick={() => reject(r)}>
                    Отклонить
                  </button>
                </div>
              )}
            </div>
            <table style={{ marginTop: 8 }}>
              <tbody>
                {Object.entries(r.answers).map(([k, v]) => (
                  <tr key={k}>
                    <td className="muted" style={{ width: 200 }}>{k}</td>
                    <td>{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {approving && (
        <ApproveModal
          projectId={projectId}
          reg={approving}
          types={types.data ?? []}
          onClose={() => setApproving(null)}
          onDone={() => {
            setApproving(null);
            regs.reload();
          }}
        />
      )}
    </div>
  );
}

function ApproveModal({
  projectId,
  reg,
  types,
  onClose,
  onDone,
}: {
  projectId: number;
  reg: Registration;
  types: EntityType[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [createEntity, setCreateEntity] = useState(true);
  const [entityLabel, setEntityLabel] = useState(reg.discord_username || "");
  const [typeId, setTypeId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      await api.approveRegistration(projectId, reg.id, {
        create_entity: createEntity,
        entity_label: entityLabel,
        entity_type_id: typeId,
      });
      onDone();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Одобрить заявку" onClose={onClose}>
      <div className="stack">
        <label className="row" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={createEntity}
            style={{ width: "auto", marginRight: 8 }}
            onChange={(e) => setCreateEntity(e.target.checked)}
          />
          Создать сущность и закрепить за игроком (ответы формы → атрибуты)
        </label>
        {createEntity && (
          <>
            <div>
              <label>Название сущности</label>
              <input value={entityLabel} onChange={(e) => setEntityLabel(e.target.value)} />
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
          </>
        )}
        {err && <div className="error">{err}</div>}
        <div className="row spread">
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" disabled={busy} onClick={confirm}>
            Одобрить
          </button>
        </div>
      </div>
    </Modal>
  );
}
