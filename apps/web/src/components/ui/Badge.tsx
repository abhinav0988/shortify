import type { LinkStatus } from "@shortify/shared";
import { capitalize } from "../../utils/format";

export function Badge({ status }: { status: LinkStatus }) {
  return <span className={`badge badge-${status}`}>{capitalize(status)}</span>;
}
