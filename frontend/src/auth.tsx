import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { api, clearToken, getToken, setToken } from "./api";

interface AuthContextValue {
  isAuthed: boolean;
  login: (password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthed, setIsAuthed] = useState<boolean>(() => !!getToken());

  const login = useCallback(async (password: string) => {
    const { access_token } = await api.login(password);
    setToken(access_token);
    setIsAuthed(true);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setIsAuthed(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthed, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth вне AuthProvider");
  return ctx;
}
