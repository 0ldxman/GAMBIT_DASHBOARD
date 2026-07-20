import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { ApiError } from "../api";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="login-box stack" onSubmit={onSubmit}>
        <h2 style={{ margin: 0 }}>⚔ Gambit Dashboard</h2>
        <p className="muted" style={{ margin: 0 }}>
          Вход для мастеров
        </p>
        <div>
          <label>Общий пароль</label>
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit" disabled={busy || !password}>
          {busy ? "Вход…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
