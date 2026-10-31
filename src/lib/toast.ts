/** A short confirmation ("Position added") shown by the page frame; any client code can call it. */
export const TOAST_EVENT = "traders:toast";

export function showToast(text: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<string>(TOAST_EVENT, { detail: text }));
}
