import { Navigate, Outlet } from "react-router-dom";
import { useSessionToken } from "../../hooks/useSession";

export function RequireAuth() {
  const token = useSessionToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
