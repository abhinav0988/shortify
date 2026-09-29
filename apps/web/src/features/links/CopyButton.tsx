import { useState } from "react";
import { Button } from "../../components/ui/Button";

export function CopyButton({ value }: { value: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function copy(): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is unavailable");
      }
      await navigator.clipboard.writeText(value);
      setFailed(false);
      setMessage("Copied");
    } catch {
      setFailed(true);
      setMessage("Could not copy. Select the short URL and copy it manually.");
    }
  }

  return (
    <span className="copy-control">
      <Button variant="secondary" aria-label="Copy short URL" onClick={() => void copy()}>
        Copy
      </Button>
      {message ? (
        <span className={failed ? "field-error" : "copied"} role="status">
          {message}
        </span>
      ) : null}
    </span>
  );
}
