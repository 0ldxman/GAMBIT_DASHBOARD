import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "./Modal";

/**
 * Общие уведомления и подтверждения.
 *
 * До этого результат операции показывался строкой на странице, а её успешность
 * определялась регуляркой по русскому тексту сообщения. Удаление же спрашивалось
 * нативным `confirm()`, а время публикации — нативным `prompt()`.
 * Здесь и то и другое заменено на нормальные тост и модалку.
 */

interface Toast {
  id: number;
  text: string;
  kind: "ok" | "err";
}

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** Надпись на подтверждающей кнопке: «Удалить», «Опубликовать». */
  confirmLabel?: string;
  /** Необратимое действие — кнопка становится красной. */
  danger?: boolean;
}

interface FeedbackApi {
  toast: {
    ok: (text: string) => void;
    err: (text: unknown) => void;
  };
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const Ctx = createContext<FeedbackApi | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ask, setAsk] = useState<ConfirmOptions | null>(null);
  // Резолвер открытого вопроса: модалка отвечает промису, который ждёт вызвавший.
  const answer = useRef<((ok: boolean) => void) | null>(null);
  const nextId = useRef(1);

  const push = useCallback((text: string, kind: "ok" | "err") => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, text, kind }]);
    // Ошибку держим дольше: её обычно нужно дочитать, а то и скопировать.
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === "ok" ? 3500 : 8000);
  }, []);

  const api = useMemo<FeedbackApi>(
    () => ({
      toast: {
        ok: (text) => push(text, "ok"),
        err: (text) => push(String(text), "err"),
      },
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          answer.current = resolve;
          setAsk(options);
        }),
    }),
    [push],
  );

  function close(ok: boolean) {
    answer.current?.(ok);
    answer.current = null;
    setAsk(null);
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.kind === "ok" ? "✓" : "⚠"}</span>
            <span>{t.text}</span>
            <button onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>
      {ask && (
        <Modal title={ask.title} onClose={() => close(false)}>
          <div className="stack">
            {ask.body && <div>{ask.body}</div>}
            <div className="row spread">
              <button className="ghost" onClick={() => close(false)}>
                Отмена
              </button>
              <button
                className={ask.danger ? "primary danger" : "primary"}
                autoFocus
                onClick={() => close(true)}
              >
                {ask.confirmLabel ?? "Продолжить"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}

function useFeedback(): FeedbackApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("FeedbackProvider отсутствует выше по дереву");
  return ctx;
}

export const useToast = () => useFeedback().toast;
export const useConfirm = () => useFeedback().confirm;
