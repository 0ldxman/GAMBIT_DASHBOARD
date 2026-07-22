import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

/** Булев флажок интерфейса, переживающий перезагрузку: свёрнут раздел или нет. */
export function useLocalFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? initial : saved === "1";
    } catch {
      // localStorage может быть недоступен (приватный режим) — не повод падать.
      return initial;
    }
  });

  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* пусто */
      }
    },
    [key],
  );

  return [value, set] as const;
}

/**
 * Что изменилось с момента загрузки формы.
 *
 * `current` — то, что в форме сейчас, `saved` — то, что пришло с сервера.
 * Возвращает список подписей изменённых кусков: он и включает панель сохранения,
 * и показывает мастеру, что именно он трогал.
 */
export function useChanges<T extends Record<string, unknown>>(
  current: T,
  // Сохранённая запись обычно шире формы (id, members и прочее) — сравниваем
  // только те поля, для которых задана подпись.
  saved: { [K in keyof T]?: unknown } | null,
  labels: Record<keyof T, string>,
): string[] {
  if (!saved) return [];
  const changed = (Object.keys(labels) as (keyof T)[])
    .filter((key) => JSON.stringify(current[key]) !== JSON.stringify(saved[key]))
    .map((key) => labels[key]);
  // Несколько полей могут описываться одной подписью («описание») — не двоим её.
  return [...new Set(changed)];
}

/** Значение, отстающее от source на delay мс: для предпросмотра и поиска. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      setDebounced(value);
      return;
    }
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debounced;
}

/** Загрузка данных с перезагрузкой (reload) и состояниями loading/error. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fn()
      .then((d) => setData(d))
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}
