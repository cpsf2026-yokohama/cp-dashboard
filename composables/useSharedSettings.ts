
export interface SharedSettings {
  countdownDates: CountdownData[];
  yearlyCountdownDates: CountdownData[];
  userChimeTimes: ChimeTime[];
  isChimeEnabled: boolean;
  isPreChimeEnabled: boolean;
  isBannerVisible: boolean;
  isVerticalBanner: boolean;
}

export const SHARED_SETTING_KEYS = [
  'countdownDates',
  'yearlyCountdownDates',
  'userChimeTimes',
  'isChimeEnabled',
  'isPreChimeEnabled',
  'isBannerVisible',
  'isVerticalBanner',
] as const satisfies readonly (keyof SharedSettings)[];

export type SharedSettingsPolicy = Record<keyof SharedSettings, boolean>;

export interface SharedSettingsResponse {
  settings: SharedSettings;
  apply: SharedSettingsPolicy;
  updatedAt: string;
}

export const DEFAULT_SHARED_SETTINGS_POLICY: SharedSettingsPolicy = {
  countdownDates: true,
  yearlyCountdownDates: true,
  userChimeTimes: true,
  isChimeEnabled: true,
  isPreChimeEnabled: true,
  isBannerVisible: true,
  isVerticalBanner: true,
};

export const LOCAL_SETTINGS_BACKUP_KEY = "cpDashboardLocalSettingsBackupV1";

export function hasLocalSettingsBackup(): boolean {
  return typeof localStorage !== "undefined" &&
    localStorage.getItem(LOCAL_SETTINGS_BACKUP_KEY) !== null;
}

/** Restore values that existed locally before shared settings were first applied. */
export function restoreLocalSettingsBackup(): number {
  const raw = localStorage.getItem(LOCAL_SETTINGS_BACKUP_KEY);
  if (!raw) return 0;

  let backup: unknown;
  try {
    backup = JSON.parse(raw);
  } catch {
    throw new Error("ローカル設定のバックアップを読み取れません");
  }

  if (typeof backup !== "object" || backup === null || Array.isArray(backup)) {
    throw new Error("ローカル設定のバックアップ形式が正しくありません");
  }

  const values = backup as Record<string, unknown>;
  const restored: Partial<SharedSettings> = {};
  const parseArray = (key: string): unknown[] | undefined => {
    if (typeof values[key] !== "string") return;
    try {
      const value: unknown = JSON.parse(values[key] as string);
      return Array.isArray(value) ? value : undefined;
    } catch {
      return;
    }
  };
  const countdowns = parseArray("countdownDates");
  const yearlyCountdowns = parseArray("yearlyCountdownDates");
  const chimeTimes = parseArray("chimeTimes");
  if (countdowns) restored.countdownDates = countdowns as CountdownData[];
  if (yearlyCountdowns) restored.yearlyCountdownDates = yearlyCountdowns as CountdownData[];
  if (chimeTimes) restored.userChimeTimes = chimeTimes as ChimeTime[];

  for (const [key, target] of [
    ["isChimeEnabled", "isChimeEnabled"],
    ["isPreChimeEnabled", "isPreChimeEnabled"],
    ["isBannerVisible", "isBannerVisible"],
    ["isVerticalBanner", "isVerticalBanner"],
  ] as const) {
    if (typeof values[key] !== "string") continue;
    try {
      const value: unknown = JSON.parse(values[key] as string);
      if (typeof value === "boolean") restored[target] = value;
    } catch {
      // Ignore an invalid individual value and keep the shared value.
    }
  }

  if (restored.countdownDates) countdownDates().value = restored.countdownDates;
  if (restored.yearlyCountdownDates) yearlyCountdownDates().value = restored.yearlyCountdownDates;
  if (restored.userChimeTimes) userChimeTimes().value = restored.userChimeTimes;
  if (typeof restored.isChimeEnabled === "boolean") isChimeEnabled().value = restored.isChimeEnabled;
  if (typeof restored.isPreChimeEnabled === "boolean") isPreChimeEnabled().value = restored.isPreChimeEnabled;
  if (typeof restored.isBannerVisible === "boolean") isBannerVisible().value = restored.isBannerVisible;
  if (typeof restored.isVerticalBanner === "boolean") isVerticalBanner().value = restored.isVerticalBanner;

  return Object.keys(restored).length;
}

function isSharedSettings(value: unknown): value is SharedSettings {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const settings = value as Record<string, unknown>;

  return (
    Array.isArray(settings.countdownDates) &&
    Array.isArray(settings.yearlyCountdownDates) &&
    Array.isArray(settings.userChimeTimes) &&
    typeof settings.isChimeEnabled === "boolean" &&
    typeof settings.isPreChimeEnabled === "boolean" &&
    typeof settings.isBannerVisible === "boolean" &&
    typeof settings.isVerticalBanner === "boolean"
  );
}

export function isSharedSettingsPolicy(value: unknown): value is SharedSettingsPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const policy = value as Record<string, unknown>;
  return SHARED_SETTING_KEYS.every(key => typeof policy[key] === 'boolean');
}

export function applySharedSettingsToClient(
  settings: SharedSettings,
  apply: SharedSettingsPolicy,
): void {
  if (apply.countdownDates) countdownDates().value = settings.countdownDates;
  if (apply.yearlyCountdownDates) yearlyCountdownDates().value = settings.yearlyCountdownDates;
  if (apply.userChimeTimes) userChimeTimes().value = settings.userChimeTimes;
  if (apply.isChimeEnabled) isChimeEnabled().value = settings.isChimeEnabled;
  if (apply.isPreChimeEnabled) isPreChimeEnabled().value = settings.isPreChimeEnabled;
  if (apply.isBannerVisible) isBannerVisible().value = settings.isBannerVisible;
  if (apply.isVerticalBanner) isVerticalBanner().value = settings.isVerticalBanner;
}

function getSettingsApiBase(): string {
  const config = useRuntimeConfig();
  return String(config.public.videoApiBase || "/api")
    .trim()
    .replace(/\/+$/, "");
}

export type SharedBannerKind = 'horizontal' | 'vertical';
export interface SharedBannerInfo {
  url: string;
  size: number;
  contentType: string;
}

export async function loadSharedBanners(): Promise<Record<SharedBannerKind, SharedBannerInfo | null>> {
  const response = await fetch(`${getSettingsApiBase()}/banners`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`バナー一覧の取得に失敗しました (${response.status})`);
  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null || !('banners' in payload)
    || typeof payload.banners !== 'object' || payload.banners === null) {
    throw new Error('バナー一覧の形式が正しくありません');
  }
  const raw = payload.banners as Record<string, unknown>;
  const result = {} as Record<SharedBannerKind, SharedBannerInfo | null>;
  for (const kind of ['horizontal', 'vertical'] as const) {
    const item = raw[kind];
    if (item === null || item === undefined) {
      result[kind] = null;
      continue;
    }
    if (typeof item !== 'object' || !('etag' in item) || typeof item.etag !== 'string'
      || !('size' in item) || typeof item.size !== 'number'
      || !('contentType' in item) || typeof item.contentType !== 'string') {
      throw new Error('バナー情報の形式が正しくありません');
    }
    result[kind] = {
      url: `${getSettingsApiBase()}/banners/${kind}?v=${encodeURIComponent(item.etag)}`,
      size: item.size,
      contentType: item.contentType,
    };
  }
  return result;
}

export async function uploadSharedBanner(kind: SharedBannerKind, file: File): Promise<void> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選択してください');
  if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new Error('画像は10 MiB以下のファイルを選択してください');
  const response = await fetch(`${getSettingsApiBase()}/banners/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!response.ok) throw new Error(`バナー画像を保存できませんでした (${response.status})`);
}

export async function deleteSharedBanner(kind: SharedBannerKind): Promise<void> {
  const response = await fetch(`${getSettingsApiBase()}/banners/${kind}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`バナー画像を削除できませんでした (${response.status})`);
}

export async function loadSharedSettings(): Promise<SharedSettingsResponse> {
  const response = await fetch(`${getSettingsApiBase()}/settings`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`共有設定の読み込みに失敗しました (${response.status})`);
  }

  const result: unknown = await response.json();

  if (typeof result !== "object" || result === null || !("settings" in result)) {
    throw new Error("共有設定のレスポンス形式が正しくありません");
  }

  const settings = result.settings;

  if (!isSharedSettings(settings)) {
    throw new Error("共有設定のデータ形式が正しくありません");
  }

  const apply = 'apply' in result && isSharedSettingsPolicy(result.apply)
    ? result.apply
    : DEFAULT_SHARED_SETTINGS_POLICY;

  return {
    settings,
    apply,
    updatedAt: 'updatedAt' in result && typeof result.updatedAt === 'string'
      ? result.updatedAt
      : '',
  };
}

export async function saveSharedSettings(
  settings: SharedSettings,
): Promise<void> {
  if (!isSharedSettings(settings)) {
    throw new Error("保存する共有設定の形式が正しくありません");
  }

  const response = await fetch(`${getSettingsApiBase()}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? `：${body.error}`
        : '';
    throw new Error(`共有設定の保存に失敗しました (HTTP ${response.status}${detail})`);
  }
}

export async function saveSharedSettingsPolicy(
  apply: SharedSettingsPolicy,
): Promise<void> {
  if (!isSharedSettingsPolicy(apply)) {
    throw new Error('反映対象の設定形式が正しくありません');
  }

  const response = await fetch(`${getSettingsApiBase()}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apply }),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? `：${body.error}`
        : '';
    throw new Error(`反映対象の保存に失敗しました (HTTP ${response.status}${detail})`);
  }
}
