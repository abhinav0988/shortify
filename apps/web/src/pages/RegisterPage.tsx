import { Link } from "react-router-dom";
import { AuthForm } from "../features/auth/AuthForm";
import { usePageTitle } from "../hooks/usePageTitle";

export function RegisterPage() {
  usePageTitle("Create account");
  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">Shortify</p>
        <h1>Create your account</h1>
        <p className="muted">Registration creates an account and signs you in.</p>
        <AuthForm mode="register" />
        <p>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
