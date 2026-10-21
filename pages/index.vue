<script setup lang="ts">
useSeoMeta({
  title: 'Campus Dashboard | 多機能デジタル時計',
  ogTitle: 'Campus Dashboard | 多機能デジタル時計',
  description: 'Web上でタイマー付きの大きなデジタル時計を表示し、役に立つ情報も一目で確認できる多機能ダッシュボード。',
  ogDescription: 'Web上でタイマー付きの大きなデジタル時計を表示し、役に立つ情報も一目で確認できる多機能ダッシュボード。',
  ogImage: 'https://cpd.cnion.dev/ogp.png',
  twitterCard: 'summary_large_image',
});

useHead({
  htmlAttrs: {
    lang: 'ja',
  },
  link: [
    {
      rel: 'icon',
      type: 'image/x-icon',
      href: 'favicon.ico',
    },
    {
      rel: 'icon',
      type: 'image/svg+xml',
      href: 'icon.svg',
    },
    {
      rel: 'apple-touch-icon',
      href: 'pwa/apple-touch-icon@192px.png',
    },
  ],
});

const widthState = widthScreenSize();
let dashboardAudioPrimer: ((event: MouseEvent) => void) | null = null

type PlaybackSchedule = {
  scheduleId: string
  videoId: string
  title: string
  startsAt: string
}

const API_BASE = useVideoApiBase()
const activePlayback = ref<PlaybackSchedule | null>(null)
const preparedPlayback = ref<PlaybackSchedule | null>(null)
const preparedVideoUrl = ref('')
const playbackError = ref('')
const playbackStalled = ref(false)
const playbackQueue: PlaybackSchedule[] = []
const seenScheduleIds = new Set<string>()
let schedulePollTimer: number | undefined
let playbackStartTimer: number | undefined
let schedulePollInFlight = false

function videoStreamUrl(item: PlaybackSchedule) {
  return `${API_BASE}/stream/videos/${encodeURIComponent(item.videoId)}/stream`
}

function prepareNextScheduledVideo() {
  if (activePlayback.value) return
  playbackQueue.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const next = playbackQueue[0] ?? null
  if (next?.scheduleId === preparedPlayback.value?.scheduleId) return

  if (playbackStartTimer !== undefined) {
    window.clearTimeout(playbackStartTimer)
    playbackStartTimer = undefined
  }
  preparedPlayback.value = next
  preparedVideoUrl.value = ''

  const startsAt = preparedPlayback.value ? Date.parse(preparedPlayback.value.startsAt) : NaN
  if (preparedPlayback.value && Number.isFinite(startsAt)) {
    const item = preparedPlayback.value
    const start = () => {
      if (preparedPlayback.value?.scheduleId !== item.scheduleId) return
      playbackStartTimer = undefined
      preparedVideoUrl.value = videoStreamUrl(item)
      activePlayback.value = item
      playbackQueue.shift()
      void nextTick(() => attemptScheduledPlayback())
    }
    if (startsAt <= Date.now()) start()
    else playbackStartTimer = window.setTimeout(start, startsAt - Date.now())
  }
}

async function attemptScheduledPlayback() {
  if (!activePlayback.value) return
  const video = document.querySelector<HTMLVideoElement>('#scheduled-video')
  if (!video) return

  try {
    await video.play()
    playbackError.value = ''
  } catch (error) {
    console.warn('Scheduled video playback needs user interaction:', error)
    playbackError.value = '再生を開始するには、下のボタンを押してください。'
  }
}

function failScheduledPlayback() {
  if (activePlayback.value) {
    playbackError.value = '動画を読み込めませんでした。Worker と動画ファイルを確認してください。'
  }
}

function finishScheduledPlayback() {
  activePlayback.value = null
  playbackError.value = ''
  playbackStalled.value = false
  preparedPlayback.value = null
  preparedVideoUrl.value = ''
  prepareNextScheduledVideo()
}

async function pollPlaybackSchedule() {
  if (schedulePollInFlight) return
  schedulePollInFlight = true
  try {
    const response = await fetch(`${API_BASE}/schedule`, { cache: 'no-store' })
    if (!response.ok) return

    const data: { schedules: PlaybackSchedule[] } = await response.json()
    const now = Date.now()

    for (const item of data.schedules) {
      const startsAt = Date.parse(item.startsAt)
      const lateness = now - startsAt
      if (
        !Number.isFinite(startsAt)
        || lateness > 60_000
        || seenScheduleIds.has(item.scheduleId)
      ) {
        continue
      }

      seenScheduleIds.add(item.scheduleId)
      playbackQueue.push(item)
    }

    prepareNextScheduledVideo()
  } catch (error) {
    console.warn('Failed to check playback schedule:', error)
  } finally {
    schedulePollInFlight = false
  }
}

// 一回でも画面がクリックされたかどうか
const firstClick = useState(() => false);

onMounted(async () => {
  if ('caches' in window) {
    void caches.delete('cp-dashboard-scheduled-video-v1').catch(() => undefined)
  }

  // 画面クリック後に行う、バックグラウンドで正常に動作するための対策
  // iOS / Safariでは、画面クリック後に各種権限を取得する必要がある模様
  dashboardAudioPrimer = async () => {
    if (!firstClick.value) {
      // バックグラウンドでの根本的な動作対策
      try {
        // スリープを無効化
        await navigator.wakeLock.request('screen');
        // タブ切り替え後でも持続するようにする
        document.addEventListener('visibilitychange', async () => {
          if (document.visibilityState === 'visible') {
            await navigator.wakeLock.request('screen');
          }
        });
      } catch (e) {
        console.warn(e);
      }

      // フォアグラウンドで音を鳴らした履歴を残す (いきなりバックグラウンドでは音が鳴らない模様)
      // iOSではこれだけでは不十分
      new Audio("./beep.mp3").play();

      // チャイム音源を読み込む (iOS対策でHTMLAudioをこの時点で読み込む)
      if (chimeFileName().value !== 'デフォルトの音声') {
        await appendFileToAudioState('chime.mp3', chimeSource);
      } else {
        chimeSource().value.load();
      }

      // 予鈴音源を読み込む
      if (preChimeFileName().value !== 'デフォルトの音声') {
        await appendFileToAudioState('pre-chime.mp3', preChimeSource);
      } else {
        preChimeSource().value.load();
      }

      // アラート音源を読み込む
      if (alertFileName().value !== 'デフォルトの音声') {
        await appendFileToAudioState('alert.mp3', timerAlertSource);
      } else {
        timerAlertSource().value.load();
      }

      firstClick.value = true;
    }
  };
  document.body.addEventListener('click', dashboardAudioPrimer, { once: true });

  // ウィンドウサイズを取得し適用
  widthState.value = window.innerWidth;

  // 画面サイズ更新時にstateを更新するようにする
  window.addEventListener('resize', () => {
    widthState.value = window.innerWidth;
  });

  void pollPlaybackSchedule();
  schedulePollTimer = window.setInterval(() => {
    void pollPlaybackSchedule();
  }, 10_000);
});

onUnmounted(() => {
  if (dashboardAudioPrimer) {
    document.body.removeEventListener('click', dashboardAudioPrimer)
    dashboardAudioPrimer = null
  }
  if (schedulePollTimer !== undefined)
    window.clearInterval(schedulePollTimer);
  if (playbackStartTimer !== undefined)
    window.clearTimeout(playbackStartTimer);
});
</script>

<template>
  <div id="snow"></div>
  <NuxtPwaManifest />
  <NuxtLayout v-show="!activePlayback">
    <ClientOnly>
      <div v-if="!firstClick && !activePlayback" class="toast toast-top toast-center whitespace-normal z-50 w-full">
        <div class="alert alert-warning">
          <Icon class="icon" name="uil:exclamation-triangle" size="30px" />
          <p>
            <span>チャイムやタイマーを正常に動作させるため、1回は画面をクリックしてください。</span>
            <br>
            <span>画面をクリックした後、バックグラウンドで正常に動作させるために、短い効果音が1回再生されます。</span>
          </p>
        </div>
      </div>
    </ClientOnly>

    <!-- 大画面デバイスの表示 -->
    <div v-if="widthState >= 1280" class="min-h-[100dvh] flex flex-row text-center gap-2">
      <div class="basis-[20.0%] flex flex-row justify-between">
        <status></status>
      </div>

      <div class="grow m-auto">
        <clock></clock>
      </div>

      <div class="basis-[15.0%] flex flex-col items-end m-3 gap-4">
        <report></report>
        <div class="grow m-2 flex flex-col justify-end gap-2">
          <button class="btn btn-neutral" onclick="window.location.replace(window.location.href)">再読み込み</button>
          <TimerSetting></TimerSetting>
          <span>Copyright © 2024 CoreNion</span>
        </div>
      </div>
    </div>

    <!-- 小画面デバイスの表示　-->
    <div v-if="widthState <= 1280" class="min-h-[100dvh] min-w-full flex flex-col text-center mb-2">
      <div class="navbar bg-neutral">
        <div class="navbar-start">
          <button class="btn" onclick="window.location.replace(window.location.href)">
            <Icon name="uil:redo" size="2.5vh" />
          </button>
        </div>
        <div class="navbar-center">
          <a class="btn btn-ghost text-xl text-neutral-content">Campus Dashboard</a>
        </div>
        <div class="navbar-end">
          <DynamicModal IconName="uil:setting">
            <Settings />
          </DynamicModal>
        </div>
      </div>
      <clock class="grow m-auto"></clock>
      <TimerSetting></TimerSetting>
      <div class="flex flex-row justify-center gap-5 my-3">
        <span>Copyright © 2024 CoreNion</span>
        <a href="https://github.com/CoreNion/cp-dashboard/" class="link">Source Code / Licence</a>
      </div>
    </div>
  </NuxtLayout>
  <section
    v-if="preparedPlayback"
    :class="activePlayback
      ? 'fixed inset-0 z-[10000] flex h-[100dvh] w-screen items-center justify-center bg-black'
      : 'fixed -left-[10000px] top-0 h-px w-px overflow-hidden'"
    :aria-hidden="!activePlayback"
    aria-label="予約動画を再生中"
  >
    <video
      id="scheduled-video"
      :key="preparedPlayback.scheduleId"
      class="h-full w-full object-contain"
      :src="preparedVideoUrl || undefined"
      preload="none"
      playsinline
      disablepictureinpicture
      @waiting="playbackStalled = true"
      @playing="playbackStalled = false"
      @ended="finishScheduledPlayback"
      @error="failScheduledPlayback"
    />

    <div
      v-if="playbackStalled && activePlayback"
      class="absolute inset-0 flex items-center justify-center bg-black/70 px-6 text-center text-white"
      role="status"
      aria-live="polite"
    >
      動画を読み込んでいます…
    </div>

    <div
      v-else-if="playbackError"
      class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-6 text-center text-white"
      role="alert"
    >
      <p>{{ playbackError }}</p>
      <div class="flex flex-wrap justify-center gap-3">
        <button
          v-if="playbackError.includes('ボタン')"
          class="rounded-lg bg-white px-5 py-3 font-semibold text-black"
          @click="attemptScheduledPlayback"
        >
          再生を開始する
        </button>
        <button
          class="rounded-lg border border-white/60 px-5 py-3 font-semibold"
          @click="finishScheduledPlayback"
        >
          ダッシュボードに戻る
        </button>
      </div>
    </div>
  </section>
</template>
