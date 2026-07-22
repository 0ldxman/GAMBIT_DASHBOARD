import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Empty, Skeleton } from "../../components/Empty";
import { Hint } from "../../components/Hint";
import { RelationGraph, typeColor } from "../../components/RelationGraph";
import { useConfirm, useToast } from "../../components/Feedback";
import { HIERARCHY_TYPES, MUTUAL_TYPES, PRESETS, isHierarchyType } from "../../relations";
import type { Entity, Relation } from "../../types";

/**
 * Связи проекта: граф для обзора и список для правки.
 *
 * Связь бывает двух родов. Взаимная («союзник», «война») — стороны равны, и в
 * описании обеих она видна одинаково. Иерархическая («состав», «вассал») —
 * родитель и дочерняя, она же даёт `{{ родители }}` и `{{ дети }}`. По типу
 * связи доступны обе: `{{ связи.союзник | строки("{название}") }}`.
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
  const [type, setType] = useState(MUTUAL_TYPES[0]);
  const [directed, setDirected] = useState(false);
  const [busy, setBusy] = useState(false);
  // Правка существующей связи: id и её черновик.
  const [edit, setEdit] = useState<{ id: number; type: string; directed: boolean } | null>(null);

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

  /** Знакомый тип подсказывает род связи; галочку всё равно можно переставить. */
  function pickType(next: string) {
    setType(next);
    const known = isHierarchyType(next);
    if (known !== null) setDirected(known);
  }

  async function add() {
    if (parentId === "" || childId === "") return;
    setBusy(true);
    try {
      await api.addRelation(projectId, Number(parentId), {
        child_id: Number(childId),
        relation_type: type.trim() || "союзник",
        directed,
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

  async function saveEdit() {
    if (!edit) return;
    const relation = all.find((r) => r.id === edit.id);
    if (!relation) return;
    try {
      await api.updateRelation(projectId, relation.parent_id, relation.id, {
        relation_type: edit.type.trim() || relation.relation_type,
        directed: edit.directed,
      });
      toast.ok("Связь изменена");
      setEdit(null);
      relations.reload();
    } catch (e) {
      toast.err(e);
    }
  }

  async function remove(relation: Relation) {
    const ok = await confirm({
      title: "Удалить связь?",
      body: `${nameOf(relation.parent_id)} ${relation.directed ? "→" : "↔"} ${nameOf(
        relation.child_id,
      )} (${relation.relation_type})`,
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
        Связь бывает <b>взаимной</b> («союзник», «война») — стороны равны, порядок ничего не
        значит, — и <b>иерархической</b> («состав», «вассал»), где первая сторона родитель: её
        включает галочка «родитель → дочерняя». В графе иерархия рисуется стрелкой, взаимная
        связь — линией. В описании сущности связи доступны по типу:{" "}
        <code>{'{{ связи.союзник | строки("{название}") }}'}</code>, а иерархия ещё и через{" "}
        <code>{"{{ родители }}"}</code> и <code>{"{{ дети }}"}</code>. У второй стороны видны и
        её поля: <code>{'{{ связи.принадлежит | строки("{название} — {описание}") }}'}</code>.
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
            <option value="">— {directed ? "родительская сущность" : "первая сторона"} —</option>
            {entities.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <span className="muted">{directed ? "→" : "↔"}</span>
          <select
            className="grow"
            value={childId}
            onChange={(e) => setChildId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">— {directed ? "дочерняя сущность" : "вторая сторона"} —</option>
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
            onChange={(e) => pickType(e.target.value)}
          />
          <datalist id="relation-types">
            {[...new Set([...PRESETS, ...types])].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <label className="check" title="Иерархия: первая сторона — родитель второй">
            <input
              type="checkbox"
              checked={directed}
              onChange={(e) => setDirected(e.target.checked)}
            />
            родитель → дочерняя
          </label>
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
              <th>Сущность</th>
              <th></th>
              <th>Вторая сторона</th>
              <th>Тип</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const editing = edit?.id === r.id;
              return (
                <tr key={r.id}>
                  <td>
                    <Link to={`/projects/${projectId}/entities/${r.parent_id}`}>
                      {nameOf(r.parent_id)}
                    </Link>
                  </td>
                  <td
                    className="muted"
                    title={
                      (editing ? edit.directed : r.directed)
                        ? "иерархия: родитель → дочерняя"
                        : "взаимная связь"
                    }
                  >
                    {(editing ? edit.directed : r.directed) ? "→" : "↔"}
                  </td>
                  <td>
                    <Link to={`/projects/${projectId}/entities/${r.child_id}`}>
                      {nameOf(r.child_id)}
                    </Link>
                  </td>
                  <td>
                    {editing ? (
                      <div className="row" style={{ gap: 6 }}>
                        <input
                          value={edit.type}
                          list="relation-types"
                          style={{ width: 160 }}
                          onChange={(e) => setEdit({ ...edit, type: e.target.value })}
                        />
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={edit.directed}
                            onChange={(e) => setEdit({ ...edit, directed: e.target.checked })}
                          />
                          иерархия
                        </label>
                      </div>
                    ) : (
                      <span className="chip" style={{ borderColor: typeColor(r.relation_type) }}>
                        <span className="dot" style={{ background: typeColor(r.relation_type) }} />
                        {r.relation_type}
                      </span>
                    )}
                  </td>
                  <td className="actions">
                    {editing ? (
                      <>
                        <button className="primary small" onClick={saveEdit}>
                          Сохранить
                        </button>
                        <button className="ghost small" onClick={() => setEdit(null)}>
                          Отмена
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="ghost small"
                          onClick={() =>
                            setEdit({ id: r.id, type: r.relation_type, directed: r.directed })
                          }
                        >
                          Изменить
                        </button>
                        <button
                          className="ghost small"
                          onClick={() => navigate(`/projects/${projectId}/entities/${r.parent_id}`)}
                        >
                          Открыть
                        </button>
                      </>
                    )}
                    <button className="icon danger" title="Удалить связь" onClick={() => remove(r)}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!relations.loading && all.length === 0 && (
        <Empty icon="🕸" title="Связей пока нет">
          Свяжите двух соседей типом «{MUTUAL_TYPES[0]}» или включите провинцию в страну
          иерархией «{HIERARCHY_TYPES[0]}» — и они появятся в графе и в описаниях.
        </Empty>
      )}
    </div>
  );
}
