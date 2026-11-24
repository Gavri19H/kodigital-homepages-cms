export interface PublicPageProps {
  siteKey: string;
  variantKey: string;
}

export interface PublicChange {
  siteId: string | null;
  tags: string[];
  reason: string;
}

export interface GatewayRequestInput {
  url: URL;
  headers: Headers;
  cookies: Record<string, string>;
  cf: {
    country?: string;
    region?: string;
    regionCode?: string;
    city?: string;
    timezone?: string;
  };
  nowMs: number;
  sid: string;
}

export interface SiteSnapshot {
  v: 1;
  siteId: string;
  hostname: string;
  status: string;
  contentVersion: number;
  settingsVersion: number;
  writeBookmark: string | null;
  timeZone: string | null;
  language: string | null;
  builtAt: number;
  listicles: Record<string, unknown>;
  leadgen: Record<string, unknown>;
}
