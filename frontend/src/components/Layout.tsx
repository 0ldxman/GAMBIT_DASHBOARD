import { createContext, useContext, useEffect, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../auth";

/** Ширина рабочей области. Меняет её сам экран — см. useWideLayout. */
const WideContext = createContext<(wide: boolean) => void>(() => {});

/**
 * Попросить широкую рабочую область.
 *
 * Списочные экраны читаются лучше в узкой колонке, а редакторы сущности и типа
 * — двухколоночные: слева форма, справа предпросмотр. В 1100px там всё жмётся,
 * и шаблон описания начинает переноситься по слову. Экран включает ширину сам и
 * снимает её, когда уходит.
 */
export function useWideLayout() {
  const setWide = useContext(WideContext);
  useEffect(() => {
    setWide(true);
    return () => setWide(false);
  }, [setWide]);
}

export function Layout() {
  const { logout } = useAuth();
  const [wide, setWide] = useState(false);
  return (
    <WideContext.Provider value={setWide}>
      <div className="topbar">
        <Link to="/" className="brand">
          ⚔ Gambit Dashboard
        </Link>
        <button className="ghost" onClick={logout}>
          Выйти
        </button>
      </div>
      <div className={wide ? "container wide" : "container"}>
        <Outlet />
      </div>
    </WideContext.Provider>
  );
}
