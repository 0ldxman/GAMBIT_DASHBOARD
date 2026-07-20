import { useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Modal } from "../../components/Modal";
import type { FieldType, FormField, RegistrationForm } from "../../types";

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Строка" },
  { value: "paragraph", label: "Абзац" },
  { value: "number", label: "Число" },
  { value: "select", label: "Выбор" },
];

export function FormsTab({ projectId }: { projectId: number }) {
  const forms = useAsync<RegistrationForm[]>(() => api.listForms(projectId), [projectId]);
  const [editing, setEditing] = useState<RegistrationForm | "new" | null>(null);

  return (
    <div>
      <div className="row spread">
        <h2 style={{ border: "none" }}>Формы регистрации</h2>
        <button className="primary" onClick={() => setEditing("new")}>
          + Форма
        </button>
      </div>
      <p className="muted">
        Игроки заполняют форму в Discord командой <code>/register</code>. Заявки видны во вкладке «Заявки».
      </p>

      {forms.loading && <p className="muted">Загрузка…</p>}
      {forms.error && <p className="error">{forms.error}</p>}
      {forms.data?.length === 0 && <p className="muted">Форм пока нет.</p>}

      <div className="stack">
        {forms.data?.map((f) => (
          <div key={f.id} className="card">
            <div className="row spread">
              <div>
                <strong>{f.title}</strong>{" "}
                <span className={`badge ${f.is_open ? "published" : "draft"}`}>
                  {f.is_open ? "открыта" : "закрыта"}
                </span>
                <div className="muted" style={{ fontSize: 13 }}>
                  {f.fields.length} пол(я) · {f.description || "без описания"}
                </div>
              </div>
              <div>
                <button className="ghost" onClick={() => setEditing(f)}>
                  Редактировать
                </button>
                <button
                  className="ghost danger"
                  onClick={async () => {
                    if (confirm(`Удалить форму «${f.title}»?`)) {
                      await api.deleteForm(projectId, f.id);
                      forms.reload();
                    }
                  }}
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <FormEditor
          projectId={projectId}
          form={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            forms.reload();
          }}
        />
      )}
    </div>
  );
}

function FormEditor({
  projectId,
  form,
  onClose,
  onSaved,
}: {
  projectId: number;
  form: RegistrationForm | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(form?.title ?? "Регистрация");
  const [description, setDescription] = useState(form?.description ?? "");
  const [isOpen, setIsOpen] = useState(form?.is_open ?? true);
  const [fields, setFields] = useState<FormField[]>(form?.fields ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function addField() {
    setFields([...fields, { key: "", label: "", type: "text", required: false, options: [] }]);
  }
  function patchField(i: number, patch: Partial<FormField>) {
    setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  async function save() {
    // ключи полей обязательны и уникальны (это ключи в answers).
    const keys = fields.map((f) => f.key.trim());
    if (keys.some((k) => !k)) {
      setErr("У каждого поля должен быть ключ");
      return;
    }
    if (new Set(keys).size !== keys.length) {
      setErr("Ключи полей должны быть уникальны");
      return;
    }
    if (fields.length > 5) {
      setErr("Discord-модалка вмещает максимум 5 полей");
      return;
    }
    setBusy(true);
    setErr(null);
    const payload = { title, description, is_open: isOpen, fields };
    try {
      if (form) await api.updateForm(projectId, form.id, payload);
      else await api.createForm(projectId, payload);
      onSaved();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={form ? "Редактирование формы" : "Новая форма"} onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 2 }}>
            <label>Название</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Статус</label>
            <label className="row" style={{ margin: "8px 0 0" }}>
              <input
                type="checkbox"
                checked={isOpen}
                style={{ width: "auto", marginRight: 8 }}
                onChange={(e) => setIsOpen(e.target.checked)}
              />
              Открыта
            </label>
          </div>
        </div>
        <div>
          <label>Описание</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="row spread">
          <label style={{ margin: 0 }}>Поля (макс. 5)</label>
          <button className="ghost" onClick={addField} disabled={fields.length >= 5}>
            + поле
          </button>
        </div>
        {fields.map((f, i) => (
          <div
            key={i}
            className="stack"
            style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}
          >
            <div className="row" style={{ gap: 8 }}>
              <input
                placeholder="ключ (answers)"
                value={f.key}
                onChange={(e) => patchField(i, { key: e.target.value })}
              />
              <input
                placeholder="подпись"
                value={f.label}
                onChange={(e) => patchField(i, { label: e.target.value })}
              />
              <select
                value={f.type}
                style={{ width: 120 }}
                onChange={(e) => patchField(i, { type: e.target.value as FieldType })}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button
                className="ghost danger"
                onClick={() => setFields(fields.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <label className="row" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={f.required}
                  style={{ width: "auto", marginRight: 6 }}
                  onChange={(e) => patchField(i, { required: e.target.checked })}
                />
                обязательное
              </label>
              {f.type === "select" && (
                <input
                  placeholder="варианты через запятую"
                  value={f.options.join(", ")}
                  onChange={(e) =>
                    patchField(i, {
                      options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              )}
            </div>
          </div>
        ))}

        {err && <div className="error">{err}</div>}
        <div className="row spread">
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" disabled={busy || !title} onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}
