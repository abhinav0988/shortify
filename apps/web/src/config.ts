const configuredBase = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || "http://localhost:8080";

export const apiBaseUrl = configuredBase.replace(/\/$/, "");

const configuredShortOrigin = import.meta.env.VITE_SHORT_URL_ORIGIN || apiBaseUrl;

export const shortUrlOrigin = configuredShortOrigin.replace(/\/$/, "");
