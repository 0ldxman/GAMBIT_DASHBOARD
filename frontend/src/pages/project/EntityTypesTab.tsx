import { useEffect, useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Modal } from "../../components/Modal";
import type { EntityType, TemplatePreview } from "../../types";

export function EntityTypesTab({ projectId }: { projectId: number }) {
  const types = useAsync<EntityType[]>(() => api.listTypes(projectId), [projectId]);
  const [editing, setEditing] = useState<EntityType | "new" | null>(null);

  return (
    <div>
      <div className="row spread">
        <h2 style={{ border: "none" }}>Типы сущностей</h2>
        <button className="primary" onClick={() => setEditing("new")}>
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
                <td>{t.label}</td>
                <td className="muted">{t.slug}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="ghost" onClick={() => setEditing(t)}>
                    Редактировать
                  </button>
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

      {editing && (
        <TypeEditor
          projectId={projectId}
          type={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            types.reload();
          }}
        />
      )}
    </div>
  );
}

const SAMPLE_HINT = `{
  "столица": "Москва",
  "население": 146000000
}`;

function TypeEditor({
  projectId,
  type,
  onClose,
  onSaved,
}: {
  projectId: number;
  type: EntityType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(type?.label ?? "");
  const [slug, setSlug] = useState(type?.slug ?? "");
  const [template, setTemplate] = useState(
    type?.attributes_template ?? "**{{ label }}**\nСтолица: {{ столица }}",
  );
  const [sample, setSample] = useState(SAMPLE_HINT);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Живой предпросмотр с дебаунсом.
  useEffect(() => {
    const handle = setTimeout(async () => {
      let attrs: Record<string, unknown> = {};
      try {
        attrs = sample.trim() ? JSON.parse(sample) : {};
      } catch {
        setPreview({ rendered: "", error: "Некорректный JSON атрибутов" });
        return;
      }
      try {
        const res = await api.previewTemplate(projectId, {
          template,
          attributes: attrs,
          label: label || "Пример",
        });
        setPreview(res);
      } catch (e) {
        setPreview({ rendered: "", error: String(e) });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [template, sample, label, projectId]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      if (type) {
        await api.updateType(projectId, type.id, { label, slug, attributes_template: template });
      } else {
        await api.createType(projectId, { label, slug, attributes_template: template });
      }
      onSaved();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={type ? "Редактирование типа" : "Новый тип"} onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Название</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>slug</label>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
        </div>
        <div>
          <label>Шаблон embed (Jinja2, кириллица: {"{{ ключ }}"})</label>
          <textarea
            value={template}
            style={{ minHeight: 120 }}
            onChange={(e) => setTemplate(e.target.value)}
          />
        </div>
        <div>
          <label>Пример атрибутов (JSON) — для предпросмотра</label>
          <textarea value={sample} onChange={(e) => setSample(e.target.value)} />
        </div>
        <div>
          <label>Предпросмотр</label>
          {preview?.error ? (
            <div className="error">{preview.error}</div>
          ) : (
            <div className="embed-preview">{preview?.rendered || " "}</div>
          )}
        </div>
        {err && <div className="error">{err}</div>}
        <div className="row spread">
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" disabled={busy || !label || !slug} onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}
