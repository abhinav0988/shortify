import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { useSessionToken } from "../../hooks/useSession";
import { fetchCurrentUser } from "../../services/auth.api";
import { clearSession } from "../../services/session";

export function AppShell() {
  const token = useSessionToken();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: fetchCurrentUser,
    enabled: Boolean(token),
  });

  function logout(): void {
    clearSession();
    queryClient.clear();
    void navigate("/login");
  }

  const name = me.data?.user.name;
  const email = me.data?.user.email;

  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <p className="brand">Shortify</p>
        <nav className="nav" aria-label="Primary">
          <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            Dashboard
          </NavLink>
          <NavLink to="/links" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            My Links
          </NavLink>
        </nav>
        <div className="account">
          <p className="user-name">{name ?? "Signed in"}</p>
          {email ? <p className="user-email">{email}</p> : null}
          <Button variant="secondary" onClick={logout}>
            Log out
          </Button>
        </div>
      </aside>
      <div className="content" id="main">
        <Outlet />
      </div>
    </div>
  );
}
