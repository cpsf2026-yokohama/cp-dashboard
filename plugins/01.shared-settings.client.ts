import { nextTick, watch } from 'vue';
import {
  LOCAL_SETTINGS_BACKUP_KEY,
  SHARED_SETTING_KEYS,
  applySharedSettingsToClient,
  loadSharedBanners,
  loadSharedSettings,
  saveSharedSettings,
  type SharedSettings,
} from '../composables/useSharedSettings';

export default defineNuxtPlugin(async () => {
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
    const storageKeys: Record<keyof SharedSettings, string> = {
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
      applySharedSettingsToClient(response.settings, response.apply);
      await nextTick();
    } finally {
      applyingRemote = false;
    }
    error.value = null;
  };

  const applyRemoteBanners = async () => {
    const banners = await loadSharedBanners();
    bannerSource().value = banners.horizontal?.url ?? null;
    verticalBannerSource().value = banners.vertical?.url ?? null;
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
    ready.value = true;

    // Local edits are saved; the Worker merges only fields enabled by the admin policy.
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let saveQueue = Promise.resolve();
    const save = () => {
      const snapshot = saveCurrentSettings();
      saveQueue = saveQueue
        .catch(() => undefined)
        .then(() => saveSharedSettings(snapshot))
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

    // Pick up updates made on /admin and apply enabled fields on every device.
    // Refresh immediately when an already-open dashboard becomes active again,
    // rather than making it wait for the next timer tick.
    let polling = false;
    const refreshSharedSettings = async () => {
      if (polling) return;
      polling = true;
      try {
        const settings = await loadSharedSettings();
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
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshSharedSettings();
    };
    window.setInterval(() => void refreshSharedSettings(), 15_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
  } catch (cause) {
    console.error('共有設定の初期化に失敗しました:', cause);
    error.value = '共有設定を読み込めませんでした。';
    ready.value = true;
  }
});
