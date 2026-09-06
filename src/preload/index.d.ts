import type { NearboxDesktopApi } from "./index";

declare global {
  interface Window {
    nearboxDesktop?: NearboxDesktopApi;
  }
}

export {};
