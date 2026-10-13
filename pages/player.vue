<script setup lang="ts">
type Video = {
  id: string
  title: string
  contentType: string
  sizeBytes: number
  createdAt: string
}

const API_BASE = useVideoApiBase()

const videos = ref<Video[]>([])
const selectedVideoId = ref('')
const loading = ref(true)
const errorMessage = ref('')

const selectedVideo = computed(
  () => videos.value.find(video => video.id === selectedVideoId.value) ?? null,
)

const streamUrl = computed(() =>
  selectedVideo.value
    ? `${API_BASE}/stream/videos/${encodeURIComponent(selectedVideo.value.id)}/stream`
    : '',
)

onMounted(async () => {
  try {
    const response = await fetch(`${API_BASE}/videos`)
    if (!response.ok) {
      throw new Error(`動画一覧の取得に失敗しました (${response.status})`)
    }

    const data: { videos: Video[] } = await response.json()
    videos.value = data.videos
    selectedVideoId.value = data.videos[0]?.id ?? ''
  } catch (error) {
    console.error('Failed to load videos:', error)
    errorMessage.value = error instanceof Error
      ? error.message
      : '動画一覧を読み込めませんでした。Worker が起動しているか確認してください。'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="min-h-screen bg-slate-50 px-4 py-8 text-slate-800 sm:px-6">
    <section class="mx-auto max-w-4xl space-y-6">
      <header>
        <p class="text-sm font-semibold text-sky-700">開発用ページ</p>
        <h1 class="mt-1 text-2xl font-bold">動画再生テスト</h1>
        <p class="mt-2 text-sm text-slate-600">
          Worker から動画を読み込み、再生とシークを確認します。
        </p>
      </header>

      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <label for="video-select" class="mb-2 block text-sm font-medium">
          再生する動画
        </label>
        <select
          id="video-select"
          v-model="selectedVideoId"
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          :disabled="loading || videos.length === 0"
        >
          <option v-if="loading" value="">動画を読み込み中...</option>
          <option v-else-if="videos.length === 0" value="">動画がありません</option>
          <option v-for="video in videos" :key="video.id" :value="video.id">
            {{ video.title }}
          </option>
        </select>

        <p v-if="errorMessage" class="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {{ errorMessage }}
        </p>
        <p v-else-if="!loading && videos.length === 0" class="mt-4 text-sm text-slate-600">
          先に管理ページから動画をアップロードしてください。
        </p>

        <div v-if="selectedVideo" class="mt-5">
          <video
            :key="selectedVideo.id"
            class="aspect-video w-full rounded-lg bg-black"
            :src="streamUrl"
            controls
            playsinline
            preload="metadata"
          >
            お使いのブラウザーは動画再生に対応していません。
          </video>
          <dl class="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <div>
              <dt class="inline font-medium text-slate-700">形式：</dt>
              <dd class="inline">{{ selectedVideo.contentType }}</dd>
            </div>
            <div>
              <dt class="inline font-medium text-slate-700">サイズ：</dt>
              <dd class="inline">{{ (selectedVideo.sizeBytes / (1024 * 1024)).toFixed(1) }} MiB</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  </main>
</template>
