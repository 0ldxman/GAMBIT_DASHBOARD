import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Empty, Skeleton } from "../../components/Empty";
import { Hint } from "../../components/Hint";
import { RelationGraph, typeColor } from "../../components/RelationGraph";
import { useConfirm, useToast } from "../../components/Feedback";
import type { Entity, Relation } from "../../types";

/** Частые виды связей. Список открытый — можно вписать свой. */
const PRESETS = ["состав", "член организации", "вассал", "союзник", "враг", "торговый партнёр"];

/**
 * Связи проекта: граф для обзора и список для правки.
 *
 * Связь направленная (родитель → дочерняя), но её смысл задаёт тип: «состав» —
 * иерархия, «союзник» или «враг» — отношения. В шаблоне описания они доступны
 * по типу: `{{ связи.союзник | строки("{название}") }}`.
 */
export function RelationsTab({ projectId }: { projectId: number }) {
  const entities = useAsync<Entity[]>(() => api.listEntities(projectId), [projectId]);
  const relations = useAsync<Relation[]>(
    () => api.listProjectRelations(projectId),
    [projectId],
  );
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();

  const [typeFilter, setTypeFilter] = useState<string>("");
  const [focus, setFocus] = useState<number | null>(null);
  const [parentId, setParentId] = useState<number | "">("");
  const [childId, setChildId] = useState<number | "">("");
  const [type, setType] = useState(PRESETS[0]);
  const [busy, setBusy] = useState(false);

  const all = relations.data ?? [];
  const nameOf = (id: number) => entities.data?.find((e) => e.id === id)?.label ?? `#${id}`;
  const types = useMemo(
    () => [...new Set(all.map((r) => r.relation_type))].sort(),
    [all],
  );
  const visible = useMemo(
    () => (typeFilter ? all.filter((r) => r.relation_type === typeFilter) : all),
    [all, typeFilter],
  );

  async function add() {
    if (parentId === "" || childId === "") return;
    setBusy(true);
    try {
      await api.addRelation(projectId, Number(parentId), {
        child_id: Number(childId),
        relation_type: type.trim() || "состав",
      });
      toast.ok("Связь добавлена");
      setChildId("");
      relations.reload();
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(relation: Relation) {
    const ok = await confirm({
      title: "Удалить связь?",
      body: `${nameOf(relation.parent_id)} → ${nameOf(relation.child_id)} (${relation.relation_type})`,
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteRelation(projectId, relation.parent_id, relation.id);
      toast.ok("Связь удалена");
      relations.reload();
    } catch (e) {
      toast.err(e);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2 className="section-title" style={{ margin: 0 }}>
          Связи
        </h2>
        <button
          className={typeFilter === "" ? "chip active" : "chip"}
          onClick={() => setTypeFilter("")}
        >
          Все {all.length}
        </button>
        {types.map((t) => (
          <button
            key={t}
            className={typeFilter === t ? "chip active" : "chip"}
            style={{ borderColor: typeColor(t) }}
            onClick={() => setTypeFilter(t)}
          >
            <span className="dot" style={{ background: typeColor(t) }} />
            {t} {all.filter((r) => r.relation_type === t).length}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {focus != null && (
          <button className="ghost small" onClick={() => setFocus(null)}>
            Снять подсветку
          </button>
        )}
      </div>

      <Hint id="relations">
        Граф — только для обзора: узел можно перетащить, клик открывает сущность. Связь
        направленная (родитель → дочерняя), но её смысл задаёт тип. В описании сущности связи
        доступны по типу: <code>{'{{ связи.союзник | строки("{название}") }}'}</code>, а
        иерархия — через <code>{"{{ родители }}"}</code> и <code>{"{{ дети }}"}</code>.
      </Hint>

      {(entities.loading || relations.loading) && <Skeleton rows={1} height={320} />}

      {!entities.loading && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <RelationGraph
            entities={entities.data ?? []}
            relations={visible}
            highlight={focus}
            onPick={(id) => setFocus(focus === id ? null : id)}
          />
        </div>
      )}

      <section className="card" style={{ marginTop: "var(--s4)" }}>
        <h3>Новая связь</h3>
        <div className="row wrap">
          <select
            className="grow"
            value={parentId}
            onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">— родительская сущность —</option>
            {entities.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <span className="muted">→</span>
          <select
            className="grow"
            value={childId}
            onChange={(e) => setChildId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">— дочерняя сущность —</option>
            {entities.data
              ?.filter((e) => e.id !== parentId)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
          </select>
          <input
            value={type}
            list="relation-types"
            style={{ width: 190 }}
            placeholder="тип связи"
            onChange={(e) => setType(e.target.value)}
          />
          <datalist id="relation-types">
            {[...new Set([...PRESETS, ...types])].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <button
            className="primary"
            disabled={busy || parentId === "" || childId === ""}
            onClick={add}
          >
            Связать
          </button>
        </div>
      </section>

      {visible.length > 0 && (
        <table style={{ marginTop: "var(--s4)" }}>
          <thead>
            <tr>
              <th>Родитель</th>
              <th>Дочерняя</th>
              <th>Тип</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/projects/${projectId}/entities/${r.parent_id}`}>
                    {nameOf(r.parent_id)}
                  </Link>
                </td>
                <td>
                  <Link to={`/projects/${projectId}/entities/${r.child_id}`}>
                    {nameOf(r.child_id)}
                  </Link>
                </td>
                <td>
                  <span className="chip" style={{ borderColor: typeColor(r.relation_type) }}>
                    <span className="dot" style={{ background: typeColor(r.relation_type) }} />
                    {r.relation_type}
                  </span>
                </td>
                <td className="actions">
                  <button
                    className="ghost small"
                    onClick={() => navigate(`/projects/${projectId}/entities/${r.parent_id}`)}
                  >
                    Открыть
                  </button>
                  <button className="icon danger" title="Удалить связь" onClick={() => remove(r)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!relations.loading && all.length === 0 && (
        <Empty icon="🕸" title="Связей пока нет">
          Свяжите страну с блоком, провинцию со страной или двух соседей типом «союзник» —
          и они появятся в графе и в описаниях.
        </Empty>
      )}
    </div>
  );
}
