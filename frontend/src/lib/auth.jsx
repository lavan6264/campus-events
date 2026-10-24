import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, session, setUnauthorizedHandler } from "./crud/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => (session.token ? session.user : null));
  const client = useQueryClient();

  const signOut = useCallback(() => {
    session.clear();
    setUser(null);
    client.clear();
  }, [client]);

  // A 401 on any signed in request ends the session. ProtectedRoute then sends the person to the login page.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      client.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [client]);

  const accept = useCallback((result) => {
    session.set(result.access_token, result.user);
    setUser(result.user);
    return result.user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      login: async (email, password) => accept(await api("/auth/login", { method: "POST", body: { email, password }, auth: false })),
      register: async (body) => accept(await api("/auth/register", { method: "POST", body, auth: false })),
      logout: signOut,
    }),
    [user, accept, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Sends signed out visitors to the login page, and signed in people without the right role to the 403 page. */
export function RequireAuth({ roles, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/forbidden" replace />;
  return children;
}
