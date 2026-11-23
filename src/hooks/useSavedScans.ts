import { useEffect, useState } from "react";
import {
  parseSavedScans,
  validateSavedScans,
  type SavedScan,
} from "@/lib/screen/stockScreener";

const STORAGE_KEY = "sa.savedScans.v1";

export function useSavedScans() {
  const [saved, setSaved] = useState<SavedScan[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedSaving, setSavedSaving] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/user/saved-scans", { cache: "no-store" });
        const payload = await response.json() as { exists?: boolean; scans?: unknown; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Could not load saved scans.");
        if (typeof payload.exists !== "boolean") throw new Error("The saved-scans response is malformed.");
        const accountScans = validateSavedScans(payload.scans);
        if (!accountScans.ok) throw new Error(accountScans.error);
        let next = accountScans.scans;
        if (payload.exists === false && next.length === 0) {
          let legacy: SavedScan[] = [];
          try { legacy = parseSavedScans(window.localStorage.getItem(STORAGE_KEY)); }
          catch { if (active) setSavedError("Could not import older scans from this browser's storage."); }
          if (legacy.length) {
            const imported = await fetch("/api/user/saved-scans", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scans: legacy }),
            });
            const result = await imported.json() as { scans?: unknown; error?: string };
            if (!imported.ok) throw new Error(result.error ?? "Could not import device scans.");
            const validated = validateSavedScans(result.scans);
            if (!validated.ok) throw new Error(validated.error);
            next = validated.scans;
          }
        }
        if (active) setSaved(next);
      } catch (loadError) {
        if (active) setSavedError(loadError instanceof Error ? loadError.message : "Could not load saved scans.");
      } finally {
        if (active) setSavedLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const persist = async (next: SavedScan[]): Promise<boolean> => {
    setSavedSaving(true);
    setSavedError(null);
    try {
      const response = await fetch("/api/user/saved-scans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scans: next }),
      });
      const payload = await response.json() as { scans?: unknown; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save scans to your account.");
      const validated = validateSavedScans(payload.scans);
      if (!validated.ok) throw new Error(validated.error);
      setSaved(validated.scans);
      return true;
    } catch (saveError) {
      setSavedError(saveError instanceof Error ? saveError.message : "Could not save scans to your account.");
      return false;
    } finally {
      setSavedSaving(false);
    }
  };

  return { saved, savedLoading, savedSaving, savedError, persist };
}
