import type { ReactNode } from "react";
import { useLocalFlag } from "../hooks";

/**
 * Сворачиваемый раздел экрана.
 *
 * Правило по умолчанию: раздел, в котором ничего нет, приходит свёрнутым, а с
 * данными или ошибкой — раскрытым. Это главный приём против «навалено в кучу»:
 * функции никуда не деваются, но экран показывает сразу только то, что заполнено.
 * Выбор мастера запоминается по `id`, поэтому свёрнутое не разворачивается само.
 */
export function Section({
  id,
  title,
  summary,
  actions,
  defaultOpen = true,
  warn = false,
  children,
}: {
  /** Ключ памяти состояния. Уникален в пределах экрана. */
  id: string;
  title: string;
  /** Что показать в заголовке: «3 игрока», «не настроены», «1 ошибка». */
  summary?: ReactNode;
  /** Кнопки раздела. Живут вне кнопки-заголовка: кнопка в кнопке недопустима. */
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** Подсветить сводку: в разделе есть проблема, которую видно и свёрнутым. */
  warn?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useLocalFlag(`sec:${id}`, defaultOpen);

  return (
    <section className="sec">
      <div className="sec-head-wrap">
        <button className="sec-head" onClick={() => setOpen(!open)}>
          <span className="sec-caret">{open ? "▾" : "▸"}</span>
          <span className="sec-title">{title}</span>
          {summary != null && (
            <span className={warn ? "sec-summary warn" : "sec-summary"}>{summary}</span>
          )}
        </button>
        {actions && open && <div className="sec-actions">{actions}</div>}
      </div>
      {open && <div className="sec-body">{children}</div>}
    </section>
  );
}
