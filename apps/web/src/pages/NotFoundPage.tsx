import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useSessionToken } from "../hooks/useSession";

export function NotFoundPage() {
  usePageTitle("Not found");
  const token = useSessionToken();
  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">Shortify</p>
        <h1>Page not found</h1>
        <p className="muted">That address is not part of Shortify.</p>
        <p>
          <Link to={token ? "/dashboard" : "/login"}>{token ? "Back to dashboard" : "Back to sign in"}</Link>
        </p>
      </section>
    </main>
  );
}
