export type DeviceKind = "desktop" | "mobile" | "tablet" | "bot" | "unknown";
export type BrowserKind = "chrome" | "firefox" | "safari" | "edge" | "other" | "unknown";

const BOT_PATTERN =
  /googlebot|bingbot|duckduckbot|baiduspider|yandex|slurp|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|slackbot|discordbot|applebot|semrush|ahrefs|crawler|spider/i;

export function classifyUserAgent(userAgent: string | null | undefined): { device: DeviceKind; browser: BrowserKind } {
  const value = userAgent?.trim() ?? "";
  if (!value) {
    return { device: "unknown", browser: "unknown" };
  }

  const browser = classifyBrowser(value.toLowerCase());
  if (BOT_PATTERN.test(value)) {
    return { device: "bot", browser };
  }
  if (/ipad|tablet|playbook|silk/i.test(value)) {
    return { device: "tablet", browser };
  }
  if (/mobile|iphone|ipod|iemobile|opera mini|blackberry/i.test(value)) {
    return { device: "mobile", browser };
  }
  if (/android/i.test(value)) {
    return { device: "tablet", browser };
  }
  return { device: "desktop", browser };
}

function classifyBrowser(value: string): BrowserKind {
  if (value.includes("edg/") || value.includes("edge/")) {
    return "edge";
  }
  if (value.includes("firefox/") || value.includes("fxios/")) {
    return "firefox";
  }
  if (value.includes("chrome/") || value.includes("crios/") || value.includes("chromium/")) {
    return "chrome";
  }
  if (value.includes("safari/")) {
    return "safari";
  }
  return "other";
}
