import fs from "node:fs";
import path from "node:path";
import {
  SETTINGS_DEFAULTS,
  type AppSettings,
} from "./settings-types";

export type { AppSettings } from "./settings-types";
export { SETTINGS_DEFAULTS } from "./settings-types";

function readEnvVar(name: string): string {
  try {
    const env = fs.readFileSync(
      path.join(process.cwd(), "backend", "worker", ".env"),
      "utf8",
    );
    const m = env.match(new RegExp(`^${name}=(.*)$`, "m"));
    return m?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

function readAmazonTagFromEnv(): string {
  return readEnvVar("AMAZON_TAG");
}

export function settingsPath(): string {
  return path.join(
    process.cwd(),
    "backend",
    "worker",
    "data",
    "settings.json",
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function sanitizePool(pool: unknown): number[] {
  if (!Array.isArray(pool)) return SETTINGS_DEFAULTS.sendIntervalPool;
  const nums = pool
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? nums : SETTINGS_DEFAULTS.sendIntervalPool;
}

/** Lista de grupos: aceita array novo, string legada e fallback do .env. Dedup + sem vazios. */
function sanitizeGroups(
  raw: Partial<AppSettings> & { whatsappGroupId?: unknown },
  envGroup: string,
): string[] {
  const out: string[] = [];
  if (Array.isArray(raw.whatsappGroupIds)) out.push(...raw.whatsappGroupIds.map((x) => String(x)));
  else if (typeof raw.whatsappGroupId === "string") out.push(raw.whatsappGroupId); // legado
  const cleaned = out.map((g) => g.trim()).filter(Boolean);
  if (!cleaned.length && envGroup) cleaned.push(envGroup);
  return [...new Set(cleaned)];
}

export function normalizeSettings(
  raw: Partial<AppSettings> | null | undefined,
): AppSettings {
  const envTag = readAmazonTagFromEnv();
  const envGroup = readEnvVar("WHATSAPP_GROUP_ID");
  const d = {
    ...SETTINGS_DEFAULTS,
    amazonTag: envTag || SETTINGS_DEFAULTS.amazonTag,
  };
  const s = raw ?? {};
  return {
    automationRunning: s.automationRunning === true,
    whatsappGroupIds: sanitizeGroups(s, envGroup),
    mlEnabled: s.mlEnabled !== false,
    amazonEnabled: s.amazonEnabled === true,
    amazonTag: String(s.amazonTag ?? d.amazonTag).trim(),
    shopeeEnabled: s.shopeeEnabled === true,
    shopeeAppId: String(s.shopeeAppId ?? d.shopeeAppId).trim(),
    shopeeSecret: String(s.shopeeSecret ?? d.shopeeSecret).trim(),
    shopeeFeedCount: clamp(Number(s.shopeeFeedCount ?? d.shopeeFeedCount), 0, 100),
    sendIntervalMinutes: clamp(
      Number(s.sendIntervalMinutes ?? d.sendIntervalMinutes),
      1,
      1440,
    ),
    sendIntervalPool: sanitizePool(s.sendIntervalPool),
    useIntervalPool: s.useIntervalPool !== false,
    activeHoursStart: clamp(
      Number(s.activeHoursStart ?? d.activeHoursStart),
      0,
      23,
    ),
    activeHoursEnd: clamp(
      Number(s.activeHoursEnd ?? d.activeHoursEnd),
      1,
      24,
    ),
    feedCount: clamp(Number(s.feedCount ?? d.feedCount), 0, 100),
    amazonFeedCount: clamp(
      Number(s.amazonFeedCount ?? d.amazonFeedCount),
      0,
      100,
    ),
    feedAmHour: clamp(Number(s.feedAmHour ?? d.feedAmHour), 0, 23),
    feedPmHour: clamp(Number(s.feedPmHour ?? d.feedPmHour), 0, 23),
    feedReactiveThreshold: clamp(
      Number(s.feedReactiveThreshold ?? d.feedReactiveThreshold),
      0,
      50,
    ),
    autoFeedEnabled: s.autoFeedEnabled !== false,
  };
}

export function readSettingsFile(): AppSettings {
  const file = settingsPath();
  try {
    const data = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as Partial<AppSettings>;
    return normalizeSettings(data);
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

export function writeSettingsFile(
  partial: Partial<AppSettings>,
): AppSettings {
  const file = settingsPath();
  const next = normalizeSettings({ ...readSettingsFile(), ...partial });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}
