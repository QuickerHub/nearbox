import { useCallback, useEffect, useState } from "react";

/**
 * Three places to be: a fresh conversation, one task's thread, or settings.
 * Old links (#/run/:id, #/inbox, #/tasks, #/projects) are still parsed so
 * notifications and bookmarks from earlier versions keep working.
 */
export type Route =
  | { name: "home" }
  | { name: "task"; id: string }
  | { name: "run"; id: string }
  | { name: "settings" };

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [pathPart = ""] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean);
  switch (parts[0]) {
    case "task":
      return parts[1] ? { name: "task", id: decodeURIComponent(parts[1]) } : { name: "home" };
    case "run":
      return parts[1] ? { name: "run", id: decodeURIComponent(parts[1]) } : { name: "home" };
    case "settings":
    case "projects":
      return { name: "settings" };
    default:
      return { name: "home" };
  }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "task":
      return `#/task/${encodeURIComponent(route.id)}`;
    case "run":
      return `#/run/${encodeURIComponent(route.id)}`;
    case "settings":
      return "#/settings";
  }
}

export function useRoute(): { route: Route; navigate(route: Route | string, replace?: boolean): void; back(): void } {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((target: Route | string, replace = false) => {
    const hash = typeof target === "string" ? target : hrefFor(target);
    if (replace) {
      window.history.replaceState(null, "", hash);
      setRoute(parseRoute(hash));
      return;
    }
    if (window.location.hash === hash) {
      return;
    }
    window.location.hash = hash;
  }, []);

  const back = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.hash = "#/";
    }
  }, []);

  return { route, navigate, back };
}
