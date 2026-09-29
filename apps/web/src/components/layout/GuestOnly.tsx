import { Navigate, Outlet } from "react-router-dom";
import { useSessionToken } from "../../hooks/useSession";

export function GuestOnly() {
  const token = useSessionToken();
  if (token) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
