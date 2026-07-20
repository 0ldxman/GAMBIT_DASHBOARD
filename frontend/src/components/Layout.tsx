import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../auth";

export function Layout() {
  const { logout } = useAuth();
  return (
    <>
      <div className="topbar">
        <Link to="/" className="brand">
          ⚔ Gambit Dashboard
        </Link>
        <button className="ghost" onClick={logout}>
          Выйти
        </button>
      </div>
      <div className="container">
        <Outlet />
      </div>
    </>
  );
}
