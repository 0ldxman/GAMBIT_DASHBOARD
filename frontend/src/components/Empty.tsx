import type { ReactNode } from "react";

/** Пустое состояние: не серая строка в углу, а объяснение и следующий шаг. */
export function Empty({
  icon = "∅",
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Заглушка на время загрузки: список не прыгает, когда данные приедут. */
export function Skeleton({ rows = 3, height = 38 }: { rows?: number; height?: number }) {
  return (
    <div className="stack tight" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}
