const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();
let scriptLoaded = false;
let pendingPageView: string | null = null;
let lastTrackedPath = "";

type GtagCommand = "js" | "config" | "event";
type GtagParams = Record<string, unknown>;
type GtagArguments = [GtagCommand, string | Date, GtagParams?];

declare global {
  interface Window {
    dataLayer?: GtagArguments[];
    gtag?: (...args: GtagArguments) => void;
  }
}

export function initAnalytics() {
  if (!measurementId || typeof window === "undefined") return;
  if (window.gtag) {
    scriptLoaded = true;
    lastTrackedPath = window.location.pathname;
    return;
  }

  pendingPageView = window.location.pathname;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: GtagArguments) {
    window.dataLayer?.push(args);
  };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  script.onload = () => {
    scriptLoaded = true;
    if (pendingPageView) {
      sendPageView(pendingPageView);
      pendingPageView = null;
    }
  };
  document.head.appendChild(script);

  window.gtag("js", new Date());
}

function sendPageView(path: string) {
  if (!measurementId || typeof window === "undefined" || !window.gtag) return;
  if (path === lastTrackedPath) return;

  lastTrackedPath = path;
  window.gtag("config", measurementId, {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title
  });
}

export function trackPageView(path: string) {
  if (!measurementId || typeof window === "undefined" || !window.gtag) return;
  if (!scriptLoaded) {
    pendingPageView = path;
    return;
  }

  sendPageView(path);
}
