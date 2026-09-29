import type { AuthResponse } from "@shortify/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "../../components/feedback/Alert";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { loginAccount, registerAccount } from "../../services/auth.api";
import { setSession } from "../../services/session";
import { userMessage } from "../../utils/user-message";
import { validateEmail, validateName, validatePassword } from "../../utils/validation";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; password?: string }>({});

  const mutation = useMutation({
    mutationFn: (body: { name?: string; email: string; password: string }) =>
      mode === "register" ? registerAccount({ name: body.name ?? "", email: body.email, password: body.password }) : loginAccount(body),
    onSuccess: async (response: AuthResponse) => {
      setSession(response.token);
      queryClient.setQueryData(["me"], { user: response.user });
      await navigate("/dashboard");
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (mutation.isPending) {
      return;
    }
    const nextErrors = {
      name: mode === "register" ? validateName(name) : undefined,
      email: validateEmail(email),
      password: validatePassword(password, mode),
    };
    setFieldErrors(nextErrors);
    if (nextErrors.name || nextErrors.email || nextErrors.password) {
      return;
    }
    mutation.mutate({
      ...(mode === "register" ? { name: name.trim() } : {}),
      email: email.trim(),
      password,
    });
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {mode === "register" ? (
        <Field id="name" label="Name" error={fieldErrors.name}>
          <input
            id="name"
            name="name"
            autoComplete="name"
            value={name}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
      ) : null}
      <Field id="email" label="Email" error={fieldErrors.email}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </Field>
      <Field id="password" label="Password" hint={mode === "register" ? "At least 8 characters." : undefined} error={fieldErrors.password}>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          value={password}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? "password-error" : mode === "register" ? "password-hint" : undefined}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </Field>
      {mutation.isError ? <Alert>{userMessage(mutation.error, mode === "login" ? "credentials" : undefined)}</Alert> : null}
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}
