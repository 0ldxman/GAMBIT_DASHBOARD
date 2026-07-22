import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Empty, Skeleton } from "../../components/Empty";
import { useConfirm, useToast } from "../../components/Feedback";
import type { Entity, EntityType } from "../../types";
import { plural } from "../Servers";

export function EntityTypesTab({ projectId }: { projectId: number }) {
  const types = useAsync<EntityType[]>(() => api.listTypes(projectId), [projectId]);
  // Сколько сущностей на типе — главный ответ на вопрос «можно ли его трогать».
  const entities = useAsync<Entity[]>(() => api.listEntities(projectId), [projectId]);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();

  const usedBy = (id: number) => (entities.data ?? []).filter((e) => e.type_id === id).length;

  async function doDelete(t: EntityType) {
    const count = usedBy(t.id);
    const ok = await confirm({
      title: `Удалить тип «${t.label}»?`,
      body:
        count > 0
          ? `${count} ${plural(count, "сущность останется", "сущности останутся", "сущностей останутся")} без типа: карточка и формулы у них пропадут, атрибуты сохранятся.`
          : "Типом никто не пользуется — удаление ни на что не повлияет.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteType(projectId, t.id);
      toast.ok(`Тип «${t.label}» удалён`);
      types.reload();
    } catch (e) {
      toast.err(e);
    }
  }

  async function duplicate(t: EntityType) {
    try {
      const copy = await api.createType(projectId, {
        label: `${t.label} (копия)`,
        slug: `${t.slug}-copy`,
        description_pages: t.description_pages,
        attributes_schema: t.attributes_schema,
        computed: t.computed,
      });
      toast.ok("Тип скопирован");
      navigate(`/projects/${projectId}/types/${copy.id}`);
    } catch (e) {
      toast.err(e);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2 className="section-title" style={{ margin: 0 }}>
          Типы сущностей
        </h2>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={() => navigate(`/projects/${projectId}/types/new`)}>
          + Тип
        </button>
      </div>

      {types.loading && <Skeleton rows={3} height={110} />}
      {types.error && <p className="error">{types.error}</p>}

      <div className="project-grid">
        {types.data?.map((t) => {
          const pages = (t.description_pages ?? []).length;
          const formulas = (t.computed ?? []).length;
          const attrs = Object.keys(t.attributes_schema ?? {}).length;
          const count = usedBy(t.id);
          return (
            <div className="card project-card" key={t.id}>
              <div>
                <h3 className="project-name">
                  <Link to={`/projects/${projectId}/types/${t.id}`}>{t.label}</Link>
                </h3>
                <div className="project-type mono">{t.slug}</div>
              </div>
              <div className="muted" style={{ fontSize: "var(--fs-cap)", flex: 1 }}>
                {pages > 0 ? `${pages} ${plural(pages, "страница", "страницы", "страниц")} описания` : "описания нет"}
                {" · "}
                {formulas > 0 ? `${formulas} ${plural(formulas, "формула", "формулы", "формул")}` : "без формул"}
                {" · "}
                {attrs > 0 ? `${attrs} ${plural(attrs, "атрибут", "атрибута", "атрибутов")}` : "без заготовки"}
              </div>
              <div className="project-stats spread">
                <span>
                  {count > 0
                    ? `${count} ${plural(count, "сущность", "сущности", "сущностей")}`
                    : "не используется"}
                </span>
                <span className="row" style={{ gap: 0 }}>
                  <button className="icon" title="Дублировать" onClick={() => duplicate(t)}>
                    ⧉
                  </button>
                  <button className="icon danger" title="Удалить" onClick={() => doDelete(t)}>
                    ✕
                  </button>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {!types.loading && types.data?.length === 0 && (
        <Empty
          icon="📐"
          title="Типов пока нет"
          action={
            <button className="primary" onClick={() => navigate(`/projects/${projectId}/types/new`)}>
              Создать тип
            </button>
          }
        >
          Тип задаёт всем своим сущностям общий вид карточки, заготовку атрибутов и формулы —
          например, «Страна» с бюджетом, считающимся из казны.
        </Empty>
      )}
    </div>
  );
}
