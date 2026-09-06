import { useCallback, useEffect, useState } from "react";
import type { TaskStatus } from "@shared/protocol";

export type Route =
  | { name: "inbox" }
  | { name: "tasks"; status: TaskStatus | "all" }
  | { name: "task"; id: string }
  | { name: "runs" }
  | { name: "run"; id: string }
  | { name: "projects" }
  | { name: "settings" };

export type Section = "inbox" | "tasks" | "runs" | "projects" | "settings";

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [pathPart, query = ""] = raw.split("?");
  const parts = (pathPart ?? "").split("/").filter(Boolean);
  const params = new URLSearchParams(query);
  switch (parts[0]) {
    case "tasks": {
      const status = params.get("status") ?? "all";
      return { name: "tasks", status: isStatus(status) ? status : "all" };
    }
    case "task":
      return parts[1] ? { name: "task", id: decodeURIComponent(parts[1]) } : { name: "tasks", status: "all" };
    case "runs":
      return { name: "runs" };
    case "run":
      return parts[1] ? { name: "run", id: decodeURIComponent(parts[1]) } : { name: "runs" };
    case "projects":
      return { name: "projects" };
    case "settings":
      return { name: "settings" };
    default:
      return { name: "inbox" };
  }
}

function isStatus(value: string): value is TaskStatus | "all" {
  return value === "all" || value === "inbox" || value === "todo" || value === "doing" || value === "done";
}

export function sectionOf(route: Route): Section {
  switch (route.name) {
    case "inbox":
      return "inbox";
    case "tasks":
    case "task":
      return "tasks";
    case "runs":
    case "run":
      return "runs";
    case "projects":
      return "projects";
    case "settings":
      return "settings";
  }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case "inbox":
      return "#/inbox";
    case "tasks":
      return route.status === "all" ? "#/tasks" : `#/tasks?status=${route.status}`;
    case "task":
      return `#/task/${encodeURIComponent(route.id)}`;
    case "runs":
      return "#/runs";
    case "run":
      return `#/run/${encodeURIComponent(route.id)}`;
    case "projects":
      return "#/projects";
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
      window.location.hash = "#/inbox";
    }
  }, []);

  return { route, navigate, back };
}
