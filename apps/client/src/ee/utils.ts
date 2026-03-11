import { getServerAppUrl, getSubdomainHost, isCloud } from "@/lib/config.ts";

export function getHostnameUrl(
  workspace: string | { hostname?: string; customDomain?: string },
): string {
  const url = new URL(getServerAppUrl());
  const isHttps = url.protocol === "https:";
  const protocol = isHttps ? "https" : "http";

  if (typeof workspace === "object") {
    if (!isCloud() && workspace.customDomain) {
      return `${protocol}://${workspace.customDomain}`;
    }
    return `${protocol}://${workspace.hostname}.${getSubdomainHost()}`;
  }

  return `${protocol}://${workspace}.${getSubdomainHost()}`;
}

export function exchangeTokenRedirectUrl(
  hostname: string,
  exchangeToken: string,
) {
  return getHostnameUrl(hostname) + "/api/auth/exchange?token=" + exchangeToken;
}
