/**
 * Toasts.
 *
 * A save banner at the top of a long page appears where you are not looking
 * and shifts the form down as it mounts. A toast reports the result near the
 * corner, over the page rather than in it, and clears itself.
 */
export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let seq = 0;
const items = $state<Toast[]>([]);

function push(kind: ToastKind, message: string, ttl = 4000) {
  // Errors linger: they usually need reading, and often acting on.
  const id = ++seq;
  items.push({ id, kind, message });
  setTimeout(() => dismiss(id), kind === "error" ? ttl * 2 : ttl);
  return id;
}

export function dismiss(id: number) {
  const i = items.findIndex((t) => t.id === id);
  if (i !== -1) items.splice(i, 1);
}

export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
  info: (message: string) => push("info", message),
};

export function toasts() {
  return items;
}
