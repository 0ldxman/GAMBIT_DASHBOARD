import { useEffect, useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { Empty, Skeleton } from "../../components/Empty";
import { Hint } from "../../components/Hint";
import { useConfirm, useToast } from "../../components/Feedback";
import { RegistrationList } from "./RegistrationsTab";
import type { FieldType, FormField, RegistrationForm } from "../../types";

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Строка" },
  { value: "paragraph", label: "Абзац" },
  { value: "number", label: "Число" },
  { value: "select", label: "Выбор" },
];

/** Заготовка новой формы: правится тут же, как существующая. */
const BLANK: RegistrationForm = {
  id: 0,
  project_id: 0,
  title: "Регистрация",
  description: "",
  is_open: true,
  fields: [],
  created_at: "",
};

type Tab = "fields" | "answers";

/**
 * Формы регистрации: слева список, справа выбранная форма.
 *
 * Раньше поля правились в модалке, а заявки жили отдельной вкладкой — из-за
 * этого «что спрашиваем» и «что ответили» невозможно было увидеть рядом.
 * Теперь форма выбирается как в почте: список слева, содержимое справа, и
 * ответы на неё — соседняя вкладка того же экрана.
 */
export function FormsTab({ projectId }: { projectId: number }) {
  const confirm = useConfirm();
  const toast = useToast();
  const forms = useAsync<RegistrationForm[]>(() => api.listForms(projectId), [projectId]);
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const [tab, setTab] = useState<Tab>("fields");

  // Первая форма открывается сама: пустая правая половина ничего не объясняет.
  useEffect(() => {
    if (selected === null && forms.data && forms.data.length > 0) setSelected(forms.data[0].id);
  }, [forms.data, selected]);

  const current =
    selected === "new" ? BLANK : forms.data?.find((f) => f.id === selected) ?? null;

  async function remove(form: RegistrationForm) {
    const ok = await confirm({
      title: `Удалить форму «${form.title}»?`,
      body: "Уже поданные заявки останутся, но подать новую по ней будет нельзя.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteForm(projectId, form.id);
      toast.ok("Форма удалена");
      setSelected(null);
      forms.reload();
    } catch (e) {
      toast.err(e);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2 className="section-title" style={{ margin: 0 }}>
          Формы регистрации
        </h2>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={() => { setSelected("new"); setTab("fields"); }}>
          + Форма
        </button>
      </div>
      <Hint id="forms">
        Игроки заполняют форму в Discord командой <code>/register</code>. Ответы приходят во
        вкладку «Заявки» этой же формы и во «Входящие». Одобрение <b>не создаёт сущность</b> —
        её заводят отдельно, а игрока к ней можно привязать при одобрении.
      </Hint>

      {forms.loading && <Skeleton rows={2} height={80} />}
      {forms.error && <p className="error">{forms.error}</p>}

      {forms.data?.length === 0 && selected !== "new" && (
        <Empty
          icon="📋"
          title="Форм пока нет"
          action={
            <button className="primary" onClick={() => setSelected("new")}>
              Собрать форму
            </button>
          }
        >
          Форма — это анкета новичка: по её ответам мастер решает, брать ли игрока в игру.
        </Empty>
      )}

      {(forms.data?.length ?? 0) > 0 || selected === "new" ? (
        <div className="forms-layout">
          <aside className="stack tight">
            {forms.data?.map((f) => (
              <button
                key={f.id}
                className={`form-card${selected === f.id ? " selected" : ""}`}
                onClick={() => setSelected(f.id)}
              >
                <div className="row spread">
                  <strong>{f.title}</strong>
                  <span className={`badge ${f.is_open ? "published" : "draft"}`}>
                    {f.is_open ? "открыта" : "закрыта"}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: "var(--fs-cap)" }}>
                  {f.fields.length} пол(я) · {f.description || "без описания"}
                </div>
              </button>
            ))}
            {selected === "new" && (
              <button className="form-card selected" onClick={() => setSelected("new")}>
                <strong>Новая форма</strong>
              </button>
            )}
          </aside>

          <div>
            {current && (
              <>
                <div className="subtabs" style={{ marginBottom: "var(--s3)" }}>
                  <button
                    className={tab === "fields" ? "active" : ""}
                    onClick={() => setTab("fields")}
                  >
                    Поля
                  </button>
                  <button
                    className={tab === "answers" ? "active" : ""}
                    disabled={selected === "new"}
                    onClick={() => setTab("answers")}
                  >
                    Заявки
                  </button>
                </div>

                {tab === "fields" ? (
                  <FormEditor
                    key={selected === "new" ? "new" : current.id}
                    projectId={projectId}
                    form={selected === "new" ? null : current}
                    onDelete={selected === "new" ? undefined : () => remove(current)}
                    onCancel={selected === "new" ? () => setSelected(null) : undefined}
                    onSaved={(saved) => {
                      setSelected(saved.id);
                      forms.reload();
                    }}
                  />
                ) : (
                  <RegistrationList projectId={projectId} formId={current.id} />
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FormEditor({
  projectId,
  form,
  onSaved,
  onDelete,
  onCancel,
}: {
  projectId: number;
  form: RegistrationForm | null;
  onSaved: (form: RegistrationForm) => void;
  onDelete?: () => void;
  onCancel?: () => void;
}) {
  const toast = useToast();
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
  function moveField(i: number, delta: number) {
    const target = i + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[i], next[target]] = [next[target], next[i]];
    setFields(next);
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
    const empty = fields.find((f) => f.type === "select" && f.options.length === 0);
    if (empty) {
      setErr(`У поля «${empty.label || empty.key}» нет ни одного варианта ответа`);
      return;
    }
    setBusy(true);
    setErr(null);
    const payload = { title, description, is_open: isOpen, fields };
    try {
      const saved = form
        ? await api.updateForm(projectId, form.id, payload)
        : await api.createForm(projectId, payload);
      toast.ok("Форма сохранена");
      onSaved(saved);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="fields two">
        <div className="field">
          <label>Название</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>Приём заявок</label>
          <label className="check" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={isOpen}
              onChange={(e) => setIsOpen(e.target.checked)}
            />
            Форма открыта — игроки могут её подавать
          </label>
        </div>
      </div>
      <div className="field">
        <label>Описание</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="row spread">
        <label style={{ margin: 0 }}>Поля (макс. 5 — предел Discord-модалки)</label>
        <button className="ghost small" onClick={addField} disabled={fields.length >= 5}>
          + поле
        </button>
      </div>
      {fields.length === 0 && (
        <p className="muted">Полей нет — игроку нечего будет заполнять.</p>
      )}
      {fields.map((f, i) => (
        <div key={i} className="page-block">
          <div className="row" style={{ gap: "var(--s2)" }}>
            <input
              className="mono grow"
              placeholder="ключ (в ответах)"
              value={f.key}
              onChange={(e) => patchField(i, { key: e.target.value })}
            />
            <input
              className="grow"
              placeholder="подпись для игрока"
              value={f.label}
              onChange={(e) => patchField(i, { label: e.target.value })}
            />
            <select
              value={f.type}
              style={{ width: 120 }}
              onChange={(e) =>
                patchField(i, { type: e.target.value as FieldType })
              }
            >
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <div className="row" style={{ gap: 0 }}>
              <button className="icon" title="Выше" disabled={i === 0} onClick={() => moveField(i, -1)}>
                ↑
              </button>
              <button
                className="icon"
                title="Ниже"
                disabled={i === fields.length - 1}
                onClick={() => moveField(i, 1)}
              >
                ↓
              </button>
              <button
                className="icon danger"
                title="Удалить поле"
                onClick={() => setFields(fields.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            </div>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={f.required}
              onChange={(e) => patchField(i, { required: e.target.checked })}
            />
            обязательное
          </label>
          {f.type === "select" && (
            <OptionsEditor
              options={f.options}
              onChange={(options) => patchField(i, { options })}
            />
          )}
        </div>
      ))}

      {err && <div className="error">{err}</div>}
      <div className="row spread">
        <div className="row">
          {onDelete && (
            <button className="ghost danger" onClick={onDelete}>
              Удалить форму
            </button>
          )}
          {onCancel && (
            <button className="ghost" onClick={onCancel}>
              Отмена
            </button>
          )}
        </div>
        <button className="primary" disabled={busy || !title} onClick={save}>
          Сохранить
        </button>
      </div>
    </div>
  );
}

/**
 * Варианты ответа: строка на вариант, кнопка на добавление и удаление.
 *
 * Раньше это было одно поле «через запятую»: вариант с запятой внутри
 * («Москва, столица») распадался на два, а пока строку набирали, пробел после
 * запятой съедался разбором.
 */
function OptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (options: string[]) => void;
}) {
  return (
    <div className="stack tight">
      <div className="row spread">
        <span className="muted" style={{ fontSize: "var(--fs-cap)" }}>
          Варианты ответа ({options.length})
        </span>
        <button className="ghost small" onClick={() => onChange([...options, ""])}>
          + вариант
        </button>
      </div>
      {options.length === 0 && (
        <p className="muted" style={{ margin: 0, fontSize: "var(--fs-cap)" }}>
          Вариантов нет — игроку не из чего выбрать.
        </p>
      )}
      {options.map((option, i) => (
        <div className="row" key={i} style={{ gap: "var(--s2)" }}>
          <input
            className="grow"
            value={option}
            placeholder={`вариант ${i + 1}`}
            onChange={(e) => onChange(options.map((o, idx) => (idx === i ? e.target.value : o)))}
          />
          <button
            className="icon"
            title="Выше"
            disabled={i === 0}
            onClick={() => {
              const next = [...options];
              [next[i - 1], next[i]] = [next[i], next[i - 1]];
              onChange(next);
            }}
          >
            ↑
          </button>
          <button
            className="icon danger"
            title="Убрать вариант"
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
