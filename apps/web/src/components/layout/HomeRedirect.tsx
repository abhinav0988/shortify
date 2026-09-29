import { Navigate } from "react-router-dom";
import { useSessionToken } from "../../hooks/useSession";

export function HomeRedirect() {
  const token = useSessionToken();
  return <Navigate to={token ? "/dashboard" : "/login"} replace />;
}
