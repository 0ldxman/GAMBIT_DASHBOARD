import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import type { EntityType } from "../../types";

export function EntityTypesTab({ projectId }: { projectId: number }) {
  const types = useAsync<EntityType[]>(() => api.listTypes(projectId), [projectId]);
  const navigate = useNavigate();

  return (
    <div>
      <div className="row spread">
        <h2 style={{ border: "none" }}>Типы сущностей</h2>
        <button
          className="primary"
          onClick={() => navigate(`/projects/${projectId}/types/new`)}
        >
          + Тип
        </button>
      </div>

      {types.loading && <p className="muted">Загрузка…</p>}
      {types.error && <p className="error">{types.error}</p>}

      {types.data && types.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>slug</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {types.data.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link to={`/projects/${projectId}/types/${t.id}`}>{t.label}</Link>
                </td>
                <td className="muted">{t.slug}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="ghost danger"
                    onClick={async () => {
                      if (confirm(`Удалить тип «${t.label}»?`)) {
                        await api.deleteType(projectId, t.id);
                        types.reload();
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
      {types.data?.length === 0 && <p className="muted">Типов пока нет.</p>}
    </div>
  );
}
