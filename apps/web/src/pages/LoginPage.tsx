import { Link } from "react-router-dom";
import { AuthForm } from "../features/auth/AuthForm";
import { usePageTitle } from "../hooks/usePageTitle";

export function LoginPage() {
  usePageTitle("Sign in");
  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">Shortify</p>
        <h1>Sign in</h1>
        <p className="muted">Use your account to manage short links and analytics.</p>
        <AuthForm mode="login" />
        <p>
          New to Shortify? <Link to="/register">Create an account</Link>
        </p>
      </section>
    </main>
  );
}
