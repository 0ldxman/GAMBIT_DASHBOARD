import { useEffect } from "react";

/**
 * Липкая панель несохранённого.
 *
 * Раньше редакторы держали правки в локальном состоянии и позволяли уйти по
 * крошкам, молча их потеряв. Панель появляется только когда есть что терять,
 * перечисляет изменённое и вешает предупреждение браузера на закрытие вкладки.
 */
export function SaveBar({
  dirty,
  changed,
  saving,
  onSave,
  onReset,
}: {
  dirty: boolean;
  /** Что именно изменено — «атрибуты», «формулы»: мастеру видно, что он трогал. */
  changed: string[];
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  // Ctrl/Cmd+S — привычный жест для формы, которую правят долго.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, onSave]);

  if (!dirty) return null;
  return (
    <div className="savebar">
      <span>Есть несохранённые изменения</span>
      {changed.length > 0 && <span className="what">— {changed.join(", ")}</span>}
      <span className="spacer" />
      <button className="ghost" disabled={saving} onClick={onReset}>
        Отменить
      </button>
      <button className="primary" disabled={saving} onClick={onSave}>
        {saving ? "Сохранение…" : "Сохранить"}
      </button>
    </div>
  );
}
