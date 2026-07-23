import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Modal } from "../../components/Modal";
import { Empty, Skeleton } from "../../components/Empty";
import { useToast } from "../../components/Feedback";
import type { Entity, Registration, RegistrationForm } from "../../types";

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

/** Заявки проекта целиком — вкладка «Входящие». */
export function RegistrationsTab({
  projectId,
  onChange,
}: {
  projectId: number;
  /** Дать проекту пересчитать счётчик входящих. */
  onChange?: () => void;
}) {
  return <RegistrationList projectId={projectId} onChange={onChange} showForm />;
}

/**
 * Список заявок с решением по каждой.
 *
 * Используется дважды: во «Входящих» — все заявки проекта, на экране формы —
 * только её. Решение уходит игроку в личные сообщения, поэтому и одобрение, и
 * отказ спрашивают текст: «отклонено» без причины игрок прочитает как молчание.
 */
export function RegistrationList({
  projectId,
  formId,
  onChange,
  showForm = false,
}: {
  projectId: number;
  /** Показывать заявки только этой формы. */
  formId?: number;
  onChange?: () => void;
  /** Подписывать, по какой форме заявка (во «Входящих» форм несколько). */
  showForm?: boolean;
}) {
  const [filter, setFilter] = useState<string>("pending");
  const regs = useAsync<Registration[]>(
    () => api.listRegistrations(projectId, filter || undefined, formId),
    [projectId, filter, formId],
  );
  const entities = useAsync<Entity[]>(() => api.listEntities(projectId), [projectId]);
  const forms = useAsync<RegistrationForm[]>(
    () => (showForm ? api.listForms(projectId) : Promise.resolve([])),
    [projectId, showForm],
  );
  const [review, setReview] = useState<{ reg: Registration; approve: boolean } | null>(null);

  const formTitle = (id: number) => forms.data?.find((f) => f.id === id)?.title ?? "";

  return (
    <div>
      <div className="toolbar">
        <div className="subtabs">
          {[
            { value: "pending", label: "Ожидают" },
            { value: "approved", label: "Одобренные" },
            { value: "rejected", label: "Отклонённые" },
            { value: "", label: "Все" },
          ].map((option) => (
            <button
              key={option.value}
              className={filter === option.value ? "active" : ""}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {regs.loading && <Skeleton rows={2} height={80} />}
      {regs.error && <p className="error">{regs.error}</p>}
      {regs.data?.length === 0 && (
        <Empty icon="📨" title="Заявок нет">
          Игроки подают их командой <code>/register</code>. Проверьте, что форма открыта.
        </Empty>
      )}

      <div className="stack">
        {regs.data?.map((r) => (
          <div key={r.id} className="card">
            <div className="row spread">
              <div className="row" style={{ gap: 8 }}>
                <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                <strong>{r.discord_username || r.discord_user_id}</strong>
                {showForm && formTitle(r.form_id) && (
                  <span className="muted" style={{ fontSize: 13 }}>
                    {formTitle(r.form_id)}
                  </span>
                )}
                <span className="muted" style={{ fontSize: 13 }}>
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </div>
              {r.status === "pending" && (
                <div>
                  <button className="ghost" onClick={() => setReview({ reg: r, approve: true })}>
                    Одобрить
                  </button>
                  <button
                    className="ghost danger"
                    onClick={() => setReview({ reg: r, approve: false })}
                  >
                    Отклонить
                  </button>
                </div>
              )}
            </div>

            <table style={{ marginTop: 8 }}>
              <tbody>
                {Object.entries(r.answers).map(([k, v]) => (
                  <tr key={k}>
                    <td className="muted" style={{ width: 200 }}>
                      {k}
                    </td>
                    <td>{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {r.status !== "pending" && (
              <div className="row" style={{ marginTop: 8, gap: "var(--s3)" }}>
                {r.review_note && (
                  <span className="muted" style={{ fontSize: 13 }}>
                    {r.status === "rejected" ? "Причина" : "Комментарий"}: {r.review_note}
                  </span>
                )}
                {r.entity_id && (
                  <Link
                    to={`/projects/${projectId}/entities/${r.entity_id}`}
                    style={{ fontSize: 13 }}
                  >
                    Сущность игрока →
                  </Link>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {review && (
        <ReviewModal
          projectId={projectId}
          reg={review.reg}
          approve={review.approve}
          entities={entities.data ?? []}
          onClose={() => setReview(null)}
          onDone={() => {
            setReview(null);
            regs.reload();
            onChange?.();
          }}
        />
      )}
    </div>
  );
}

/** Решение по заявке: текст игроку и, при одобрении, привязка к сущности. */
function ReviewModal({
  projectId,
  reg,
  approve,
  entities,
  onClose,
  onDone,
}: {
  projectId: number;
  reg: Registration;
  approve: boolean;
  entities: Entity[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [entityId, setEntityId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!approve && !note.trim()) {
      setErr("Напишите причину — игрок получит её в личных сообщениях");
      return;
    }
    setBusy(true);
    setErr(null);
    const body = {
      note: note.trim(),
      entity_id: approve && entityId !== "" ? Number(entityId) : null,
      notify,
    };
    try {
      if (approve) await api.approveRegistration(projectId, reg.id, body);
      else await api.rejectRegistration(projectId, reg.id, body);
      toast.ok(
        notify
          ? `Заявка ${approve ? "одобрена" : "отклонена"} — бот напишет игроку`
          : `Заявка ${approve ? "одобрена" : "отклонена"}`,
      );
      onDone();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  const who = reg.discord_username || reg.discord_user_id;

  return (
    <Modal title={approve ? `Одобрить заявку ${who}` : `Отклонить заявку ${who}`} onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label>{approve ? "Напутствие игроку" : "Причина отказа"}</label>
          <textarea
            value={note}
            autoFocus
            placeholder={
              approve
                ? "Добро пожаловать! Ваша страна — на карте востока."
                : "Например: анкета не соответствует сеттингу, попробуйте ещё раз."
            }
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="hint" style={{ margin: 0 }}>
            Бот отправит игроку личное сообщение с названием проекта, формы и этим текстом.
          </p>
        </div>

        {approve && (
          <div className="field">
            <label>Привязать к сущности</label>
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">— не привязывать —</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            <p className="hint" style={{ margin: 0 }}>
              Сущность из заявки больше не создаётся автоматически: анкета редко совпадает с
              тем, что должно лежать в атрибутах. Заведите её на вкладке «Сущности» — или
              выберите готовую, и игрок станет её участником.
            </p>
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Написать игроку в личные сообщения
        </label>

        {err && <div className="error">{err}</div>}
        <div className="row spread">
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className={approve ? "primary" : "primary danger"}
            disabled={busy}
            onClick={submit}
          >
            {approve ? "Одобрить" : "Отклонить"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
