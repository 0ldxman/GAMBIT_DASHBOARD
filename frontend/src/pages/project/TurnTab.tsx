import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Modal } from "../../components/Modal";
import { Empty, Skeleton } from "../../components/Empty";
import { Hint } from "../../components/Hint";
import { useConfirm, useToast } from "../../components/Feedback";
import type { TurnPreview, TurnState } from "../../types";

/**
 * Ход игры: автоизменения атрибутов у всех сущностей разом.
 *
 * Завершение хода необратимо меняет чужие данные, поэтому порядок жёсткий:
 * сперва предпросмотр «было → станет» по всему проекту, и только после него —
 * применение. Ошибка хотя бы в одном правиле останавливает весь ход: половина
 * начисленного дохода хуже, чем неначисленный.
 */
export function TurnTab({ projectId }: { projectId: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const state = useAsync<TurnState>(() => api.turnState(projectId), [projectId]);
  const [preview, setPreview] = useState<TurnPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function openPreview() {
    setBusy(true);
    try {
      setPreview(await api.turnPreview(projectId));
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (!preview) return;
    setBusy(true);
    try {
      const next = await api.turnEnd(projectId, preview.turn_number);
      toast.ok(`Ход ${preview.turn_number} завершён — теперь ход ${next.turn_number}`);
      setPreview(null);
      state.reload();
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  }

  async function rollback() {
    const ok = await confirm({
      title: "Откатить последний ход?",
      body: "Атрибуты всех сущностей вернутся к состоянию до завершения хода. Правки, сделанные после него, будут потеряны.",
      confirmLabel: "Откатить",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const next = await api.turnRollback(projectId);
      toast.ok(`Откат выполнен — снова ход ${next.turn_number}`);
      state.reload();
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  }

  const changedCount = (preview?.entities ?? []).reduce(
    (sum, entity) => sum + entity.rows.filter((row) => row.changed).length,
    0,
  );

  return (
    <div className="stack">
      <Hint id="project-turn">
        Правила автоизменений задаются у <b>типа сущности</b> и у самой{" "}
        <b>сущности</b> (вкладка «Ход» / раздел «Автоизменения в ход»). Здесь они
        применяются ко всем сущностям сразу. Расчёт одновременный: все значения берутся на
        начало хода, поэтому сосед не успевает «потратить» то, на что вы ссылаетесь через
        связи. Перед применением сохраняется снимок — последний ход можно откатить.
      </Hint>

      {state.loading && <Skeleton rows={1} height={80} />}
      {state.error && <p className="error">{state.error}</p>}

      {state.data && (
        <div className="card">
          <div className="row spread">
            <div>
              <h3 style={{ margin: 0 }}>Ход {state.data.turn_number}</h3>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {state.data.can_rollback
                  ? "Предыдущий ход можно откатить."
                  : "Снимка нет — откатывать пока нечего."}
              </p>
            </div>
            <div className="row" style={{ gap: "var(--s2)" }}>
              {state.data.can_rollback && (
                <button className="ghost danger" disabled={busy} onClick={rollback}>
                  Откатить ход
                </button>
              )}
              <button className="primary" disabled={busy} onClick={openPreview}>
                {busy ? "…" : "Завершить ход"}
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <Modal title={`Завершение хода ${preview.turn_number}`} onClose={() => setPreview(null)}>
          <div className="stack">
            {preview.entities.length === 0 && (
              <Empty icon="⏭" title="Автоизменений нет">
                Ни у одной сущности нет правил хода. Ход всё равно можно завершить — счётчик
                просто увеличится.
              </Empty>
            )}

            {preview.has_errors && (
              <div className="error">
                Есть правила с ошибкой — ход не будет применён, пока они не исправлены.
              </div>
            )}

            {preview.entities.map((entity) => (
              <div className="card" key={entity.entity_id}>
                <div className="row spread">
                  <strong>{entity.label}</strong>
                  <Link
                    to={`/projects/${projectId}/entities/${entity.entity_id}`}
                    style={{ fontSize: 13 }}
                  >
                    открыть →
                  </Link>
                </div>
                <table style={{ marginTop: 8 }}>
                  <tbody>
                    {entity.rows.map((row) => (
                      <tr key={row.path}>
                        <td className="muted mono" style={{ width: 240 }}>
                          {row.path}
                        </td>
                        <td>
                          {row.error ? (
                            <span className="error">⚠ {row.error}</span>
                          ) : (
                            <>
                              <span className="muted">{row.before}</span>
                              {" → "}
                              <strong>{row.after}</strong>
                              {!row.changed && (
                                <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                                  без изменений
                                </span>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            <div className="row spread">
              <span className="muted" style={{ fontSize: 13 }}>
                {changedCount > 0
                  ? `Изменится значений: ${changedCount}`
                  : "Значения не изменятся"}
              </span>
              <div className="row" style={{ gap: "var(--s2)" }}>
                <button className="ghost" onClick={() => setPreview(null)}>
                  Отмена
                </button>
                <button
                  className="primary"
                  disabled={busy || preview.has_errors}
                  onClick={end}
                >
                  Применить и завершить ход
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
