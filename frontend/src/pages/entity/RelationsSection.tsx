import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { MUTUAL_TYPES, PRESETS, isHierarchyType } from "../../relations";
import type { Entity, Relation } from "../../types";

/** Связи сущности: взаимные («союзник») и иерархические («состав»). */
export function RelationsSection({
  projectId,
  entityId,
  entities,
}: {
  projectId: number;
  entityId: number;
  entities: Entity[];
}) {
  const relations = useAsync<Relation[]>(
    () => api.listRelations(projectId, entityId),
    [projectId, entityId],
  );
  const [childId, setChildId] = useState<number | "">("");
  const [type, setType] = useState(MUTUAL_TYPES[0]);
  const [directed, setDirected] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameOf = (id: number) => entities.find((e) => e.id === id)?.label ?? `#${id}`;
  const list = relations.data ?? [];
  const children = list.filter((r) => r.directed && r.parent_id === entityId);
  const parents = list.filter((r) => r.directed && r.child_id === entityId);
  // Взаимные связи иерархии не образуют: вторая сторона — та, что не эта.
  const mutual = list.filter((r) => !r.directed);
  const otherOf = (r: Relation) => (r.parent_id === entityId ? r.child_id : r.parent_id);

  /** Знакомый тип сам ставит галочку — «состав» иерархичен, «союзник» нет. */
  function pickType(next: string) {
    setType(next);
    const known = isHierarchyType(next);
    if (known !== null) setDirected(known);
  }

  async function add() {
    if (childId === "") return;
    setBusy(true);
    setErr(null);
    try {
      await api.addRelation(projectId, entityId, {
        child_id: Number(childId),
        relation_type: type,
        directed,
      });
      setChildId("");
      relations.reload();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Relation) {
    await api.deleteRelation(projectId, entityId, r.id);
    relations.reload();
  }

  return (
    <section className="card">
      <div className="row spread">
        <h3 style={{ marginTop: 0 }}>Связи</h3>
        <Link to={`/projects/${projectId}?tab=relations`} style={{ fontSize: "var(--fs-cap)" }}>
          Граф связей проекта →
        </Link>
      </div>
      <p className="hint">
        По умолчанию связь взаимна («союзник», «война») и видна с обеих сторон. Галочка
        «родитель → дочерняя» делает её иерархической: страна входит в блок, провинция — в
        страну. Тип связи виден в описании:{" "}
        <code>{'{{ связи.союзник | строки("{название}") }}'}</code>.
      </p>

      {relations.loading && <p className="muted">Загрузка…</p>}
      {relations.error && <p className="error">{relations.error}</p>}

      {mutual.length > 0 && (
        <>
          <label>Взаимные связи</label>
          {mutual.map((r) => (
            <div className="row spread" key={r.id} style={{ marginTop: 6 }}>
              <span>
                <Link to={`/projects/${projectId}/entities/${otherOf(r)}`}>
                  {nameOf(otherOf(r))}
                </Link>{" "}
                <span className="muted">— {r.relation_type}</span>
              </span>
              <button className="ghost danger" onClick={() => remove(r)}>
                ✕
              </button>
            </div>
          ))}
        </>
      )}

      {parents.length > 0 && (
        <>
          <label>Входит в</label>
          {parents.map((r) => (
            <div className="row spread" key={r.id} style={{ marginTop: 6 }}>
              <span>
                <Link to={`/projects/${projectId}/entities/${r.parent_id}`}>
                  {nameOf(r.parent_id)}
                </Link>{" "}
                <span className="muted">— {r.relation_type}</span>
              </span>
              <button className="ghost danger" onClick={() => remove(r)}>
                ✕
              </button>
            </div>
          ))}
        </>
      )}

      {children.length > 0 && (
        <>
          <label>Включает</label>
          {children.map((r) => (
            <div className="row spread" key={r.id} style={{ marginTop: 6 }}>
              <span>
                <Link to={`/projects/${projectId}/entities/${r.child_id}`}>
                  {nameOf(r.child_id)}
                </Link>{" "}
                <span className="muted">— {r.relation_type}</span>
              </span>
              <button className="ghost danger" onClick={() => remove(r)}>
                ✕
              </button>
            </div>
          ))}
        </>
      )}

      {relations.data?.length === 0 && <p className="muted">Связей нет.</p>}

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <select
          value={childId}
          style={{ flex: 1 }}
          onChange={(e) => setChildId(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">
            — {directed ? "добавить дочернюю сущность" : "связать с сущностью"} —
          </option>
          {entities
            .filter((e) => e.id !== entityId)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
        </select>
        <input
          value={type}
          list="relation-presets"
          style={{ width: 190 }}
          onChange={(e) => pickType(e.target.value)}
        />
        <datalist id="relation-presets">
          {PRESETS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <button className="primary" onClick={add} disabled={busy || childId === ""}>
          Связать
        </button>
      </div>
      <label className="check" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={directed} onChange={(e) => setDirected(e.target.checked)} />
        родитель → дочерняя (иерархия)
      </label>
      {err && <div className="error">{err}</div>}
    </section>
  );
}
