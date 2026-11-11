import { nextTick, watch } from 'vue';
import {
  LOCAL_SETTINGS_BACKUP_KEY,
  SHARED_SETTING_KEYS,
  applySharedSettingsToClient,
  loadSharedChimes,
  loadSharedBanners,
  loadSharedSettings,
  saveSharedSettings,
  type SharedSettings,
} from '../composables/useSharedSettings';

export default defineNuxtPlugin(async (nuxtApp) => {
  const sharedTheme = useState<SharedSettings['dashboardTheme']>('sharedDashboardTheme', () => null);
  const ready = useState<boolean>('sharedSettingsReady', () => false);
  const error = useState<string | null>('sharedSettingsError', () => null);
  let applyingRemote = false;

  ready.value = false;
  error.value = null;

  const saveCurrentSettings = () => ({
    countdownDates: countdownDates().value,
    yearlyCountdownDates: yearlyCountdownDates().value,
    userChimeTimes: userChimeTimes().value,
    isChimeEnabled: isChimeEnabled().value,
    isPreChimeEnabled: isPreChimeEnabled().value,
    isBannerVisible: isBannerVisible().value,
    isVerticalBanner: isVerticalBanner().value,
  } satisfies SharedSettings);

  const backupLocalSettingsOnce = () => {
    if (localStorage.getItem(LOCAL_SETTINGS_BACKUP_KEY)) return;
    const storageKeys: Record<(typeof SHARED_SETTING_KEYS)[number], string> = {
      countdownDates: 'countdownDates',
      yearlyCountdownDates: 'yearlyCountdownDates',
      userChimeTimes: 'chimeTimes',
      isChimeEnabled: 'isChimeEnabled',
      isPreChimeEnabled: 'isPreChimeEnabled',
      isBannerVisible: 'isBannerVisible',
      isVerticalBanner: 'isVerticalBanner',
    };
    const backup = Object.fromEntries(
      SHARED_SETTING_KEYS.map(key => [key === 'userChimeTimes' ? 'chimeTimes' : key, localStorage.getItem(storageKeys[key])]),
    );
    localStorage.setItem(LOCAL_SETTINGS_BACKUP_KEY, JSON.stringify(backup));
  };

  const applyRemoteSettings = async (response: Awaited<ReturnType<typeof loadSharedSettings>>) => {
    applyingRemote = true;
    try {
      sharedTheme.value = response.settings.dashboardTheme ?? null;
      nuxtApp.runWithContext(() => applySharedSettingsToClient(response.settings, response.apply));
      await nextTick();
    } finally {
      applyingRemote = false;
    }
    error.value = null;
  };

  const applyRemoteBanners = async () => {
    const banners = await nuxtApp.runWithContext(loadSharedBanners);
    nuxtApp.runWithContext(() => {
      bannerSource().value = banners.horizontal?.url ?? null;
      verticalBannerSource().value = banners.vertical?.url ?? null;
    });
  };

  const applyRemoteChimes = async () => {
    const chimes = await nuxtApp.runWithContext(loadSharedChimes);
    nuxtApp.runWithContext(() => {
      for (const kind of ['chime', 'pre-chime'] as const) {
        const url = chimes[kind]?.url ?? null;
        const sharedUrl = sharedChimeAudioUrl(kind);
        if (sharedUrl.value === url) continue;
        sharedUrl.value = url;
        const source = kind === 'chime' ? chimeSource() : preChimeSource();
        source.value = new Audio(url ?? `${useRuntimeConfig().app.baseURL}${kind === 'chime' ? 'chime.mp3' : 'pre-chime.mp3'}`);
        source.value.load();
      }
    });
  };

  try {
    const initial = await loadSharedSettings();
    backupLocalSettingsOnce();
    await applyRemoteSettings(initial);
    try {
      await applyRemoteBanners();
    } catch (cause) {
      console.warn('共有バナーの初期読み込みに失敗しました:', cause);
    }
    try {
      await applyRemoteChimes();
    } catch (cause) {
      console.warn('共有チャイム音声の初期読み込みに失敗しました:', cause);
    }
    ready.value = true;

    // Local edits are saved; the Worker merges only fields enabled by the admin policy.
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let saveQueue = Promise.resolve();
    const save = () => {
      const snapshot = nuxtApp.runWithContext(saveCurrentSettings);
      saveQueue = saveQueue
        .catch(() => undefined)
        .then(() => nuxtApp.runWithContext(() => saveSharedSettings(snapshot)))
        .catch((cause: unknown) => {
          console.error('共有設定の保存に失敗しました:', cause);
          error.value = '共有設定を保存できませんでした。';
        });
    };

    const sources = [
      countdownDates(),
      yearlyCountdownDates(),
      userChimeTimes(),
      isChimeEnabled(),
      isPreChimeEnabled(),
      isBannerVisible(),
      isVerticalBanner(),
    ];
    sources.forEach((source) => {
      watch(source, () => {
        if (!ready.value || applyingRemote) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 500);
      }, { deep: true });
    });
  } catch (cause) {
    console.error('共有設定の初期化に失敗しました:', cause);
    error.value = '共有設定を読み込めませんでした。';
    ready.value = true;
  }

  // Pick up updates made on /admin and apply enabled fields on every device.
  // Refresh immediately when an already-open dashboard becomes active again,
  // rather than making it wait for the next timer tick.
  let polling = false;
  const refreshSharedSettings = async () => {
    if (polling) return;
    polling = true;
    try {
      const settings = await nuxtApp.runWithContext(loadSharedSettings);
      await applyRemoteSettings(settings);
    } catch (cause) {
      console.warn('共有設定の再読み込みに失敗しました:', cause);
    } finally {
      polling = false;
    }
    try {
      await applyRemoteBanners();
    } catch (cause) {
      console.warn('共有バナーの再読み込みに失敗しました:', cause);
    }
    try {
      await applyRemoteChimes();
    } catch (cause) {
      console.warn('共有チャイム音声の再読み込みに失敗しました:', cause);
    }
  };
  const refreshWhenVisible = () => {
    if (document.visibilityState === 'visible') void refreshSharedSettings();
  };
  window.setInterval(() => void refreshSharedSettings(), 15_000);
  window.addEventListener('focus', refreshWhenVisible);
  document.addEventListener('visibilitychange', refreshWhenVisible);
});
