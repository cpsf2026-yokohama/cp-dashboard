<script setup lang="ts">
import { computed, ref } from 'vue'

type Video = {
  id: string
  title: string
  contentType: string
  sizeBytes: number
  createdAt: string
  canDelete: boolean
  isUnused: boolean
}

type ManagedUser = {
  id: string
  email: string
  role: 'admin' | 'producer' | 'operator'
  createdAt?: string
}

type ApiSchedule = {
  id: string
  videoId: string
  title: string
  startsAt: string
  createdBy: string
}

type Schedule = ApiSchedule & {
  date: string
  time: string
  status: '予約済み'
}

const API_BASE = useVideoApiBase()

const activeTab = ref<'overview' | 'videos' | 'schedule' | 'users'>('overview')
const canManageUsers = ref(false)
const managedUsers = ref<ManagedUser[]>([])
const usersLoading = ref(false)
const usersError = ref('')
const newUserEmail = ref('')
const newUserRole = ref<ManagedUser['role']>('producer')
const savingUser = ref(false)
const search = ref('')
const unusedOnly = ref(false)
const uploadTitle = ref('')
const uploadFile = ref<File | null>(null)
const uploadFileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const deletingVideoId = ref<string | null>(null)
const showAddSchedule = ref(false)
const selectedVideo = ref('')
const selectedDate = ref(new Date().toLocaleDateString('sv-SE'))
const selectedTime = ref('15:00')
const notice = ref('')
const noticeIsError = ref(false)

const videos = ref<Video[]>([])
const videosLoading = ref(false)
const videosError = ref('')

const schedules = ref<Schedule[]>([])
const schedulesLoading = ref(false)
const schedulesError = ref('')
const scheduleSaving = ref(false)

const filteredVideos = computed(() => {
  const query = search.value.trim().toLowerCase()

  return videos.value.filter(video =>
    video.title.toLowerCase().includes(query),
  ).filter(video => !unusedOnly.value || video.isUnused)
})

const totalVideoBytes = computed(() =>
  videos.value.reduce((total, video) => total + video.sizeBytes, 0),
)

const upcomingCount = computed(() => schedules.value.length)
const unusedVideoCount = computed(() => videos.value.filter(video => video.isUnused).length)

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function toSchedule(item: ApiSchedule): Schedule {
  const date = new Date(item.startsAt)

  return {
    ...item,
    date: date.toLocaleDateString('sv-SE', {
      timeZone: 'Asia/Tokyo',
    }),
    time: date.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    status: '予約済み',
  }
}

function videoTitle(id: string) {
  return videos.value.find(video => video.id === id)?.title
    ?? schedules.value.find(item => item.videoId === id)?.title
    ?? '不明な動画'
}

function showNotice(message: string, isError = false) {
  notice.value = message
  noticeIsError.value = isError
}

async function loadVideos() {
  videosLoading.value = true
  videosError.value = ''

  try {
    const response = await fetch(`${API_BASE}/videos`)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data: { videos: Video[], canManageUsers?: boolean } = await response.json()
    videos.value = data.videos
    canManageUsers.value = data.canManageUsers === true

    if (
      !selectedVideo.value
      || !videos.value.some(video => video.id === selectedVideo.value)
    ) {
      selectedVideo.value = videos.value[0]?.id ?? ''
    }
  } catch (error) {
    console.error('Failed to load videos:', error)
    videosError.value =
      '動画一覧を取得できませんでした。Workerの起動状態と接続を確認してください。'
  } finally {
    videosLoading.value = false
  }
}

async function loadUsers() {
  if (!canManageUsers.value) return
  usersLoading.value = true
  usersError.value = ''
  try {
    const response = await fetch(`${API_BASE}/users`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data: { users: ManagedUser[] } = await response.json()
    managedUsers.value = data.users
  } catch (error) {
    console.error('Failed to load users:', error)
    usersError.value = 'ユーザー一覧を取得できませんでした。'
  } finally {
    usersLoading.value = false
  }
}

async function addUser() {
  if (savingUser.value) return
  savingUser.value = true
  showNotice('')
  try {
    const response = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newUserEmail.value, role: newUserRole.value }),
    })
    const result: unknown = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
        ? result.error
        : `HTTP ${response.status}`
      throw new Error(message)
    }
    newUserEmail.value = ''
    await loadUsers()
    showNotice('ユーザーを登録しました。管理ページへのアクセス許可はCloudflare Access側にも別途追加してください。')
  } catch (error) {
    showNotice(`ユーザーを登録できませんでした。${error instanceof Error ? ` ${error.message}` : ''}`, true)
  } finally {
    savingUser.value = false
  }
}

async function changeUserRole(user: ManagedUser, event: Event) {
  const role = (event.target as HTMLSelectElement).value as ManagedUser['role']
  if (role === user.role) return
  try {
    const response = await fetch(`${API_BASE}/users/${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    const result: unknown = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
        ? result.error
        : `HTTP ${response.status}`
      throw new Error(message)
    }
    await loadUsers()
    showNotice('権限を更新しました。')
  } catch (error) {
    await loadUsers()
    showNotice(`権限を変更できませんでした。${error instanceof Error ? ` ${error.message}` : ''}`, true)
  }
}

async function loadSchedules() {
  schedulesLoading.value = true
  schedulesError.value = ''

  try {
    const response = await fetch(`${API_BASE}/schedules`)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data: { schedules: ApiSchedule[] } = await response.json()

    schedules.value = data.schedules
      .map(toSchedule)
      .filter(item => Date.parse(item.startsAt) > Date.now())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  } catch (error) {
    console.error('Failed to load schedules:', error)
    schedulesError.value =
      'スケジュールを取得できませんでした。Workerの起動状態と接続を確認してください。'
  } finally {
    schedulesLoading.value = false
  }
}

async function loadAll() {
  await Promise.all([loadVideos(), loadSchedules()])
}

void loadAll()

function selectUploadFile(event: Event) {
  const input = event.target
  uploadFile.value = input instanceof HTMLInputElement
    ? input.files?.[0] ?? null
    : null
}

async function uploadVideo() {
  if (uploading.value) return

  showNotice('')
  const title = uploadTitle.value.trim()
  if (!title || !uploadFile.value) {
    showNotice('動画名と動画ファイルを選択してください。', true)
    return
  }

  const formData = new FormData()
  formData.set('title', title)
  formData.set('file', uploadFile.value)
  uploading.value = true

  try {
    const response = await fetch(`${API_BASE}/videos`, {
      method: 'POST',
      body: formData,
    })
    const result: unknown = await response.json().catch(() => ({}))

    if (!response.ok) {
      let message = `HTTP ${response.status}`
      if (
        typeof result === 'object'
        && result !== null
        && 'error' in result
        && typeof result.error === 'string'
      ) {
        message = result.error
      }
      throw new Error(message)
    }

    uploadTitle.value = ''
    uploadFile.value = null
    if (uploadFileInput.value) uploadFileInput.value.value = ''
    await loadVideos()
    showNotice('動画をアップロードして登録しました。')
  } catch (error) {
    console.error('Failed to upload video:', error)
    showNotice(
      `動画をアップロードできませんでした。${error instanceof Error ? ` ${error.message}` : ''}`,
      true,
    )
  } finally {
    uploading.value = false
  }
}

async function deleteVideo(video: Video) {
  if (deletingVideoId.value) return
  if (!window.confirm(`「${video.title}」を削除しますか？この操作は元に戻せません。`)) return

  showNotice('')
  deletingVideoId.value = video.id

  try {
    const response = await fetch(`${API_BASE}/videos/${encodeURIComponent(video.id)}`, {
      method: 'DELETE',
    })
    const payload: unknown = await response.json().catch(() => ({}))
    const result = typeof payload === 'object' && payload !== null
      ? payload as { error?: string, storageCleanupPending?: boolean }
      : {}

    if (!response.ok) {
      const message = response.status === 409
        ? 'この動画はスケジュールで使用中です。先に予定をキャンセルしてください。'
        : result.error || `HTTP ${response.status}`
      throw new Error(message)
    }

    await loadVideos()
    showNotice(result.storageCleanupPending
      ? '動画情報を削除しましたが、保存ファイルの削除に失敗しました。管理者に確認してください。'
      : '動画を削除しました。')
  } catch (error) {
    console.error('Failed to delete video:', error)
    showNotice(
      `動画を削除できませんでした。${error instanceof Error ? ` ${error.message}` : ''}`,
      true,
    )
  } finally {
    deletingVideoId.value = null
  }
}

async function addSchedule() {
  if (scheduleSaving.value) return

  showNotice('')

  if (!selectedVideo.value || !selectedDate.value || !selectedTime.value) {
    showNotice('動画・日付・開始時刻を入力してください。', true)
    return
  }

  const localDateTime = new Date(
    `${selectedDate.value}T${selectedTime.value}:00`,
  )

  if (Number.isNaN(localDateTime.getTime())) {
    showNotice('日付または時刻が正しくありません。', true)
    return
  }

  const startsAt = localDateTime.toISOString()

  const conflict = schedules.value.some(
    item => item.startsAt === startsAt,
  )

  if (conflict) {
    showNotice('同じ時刻に予約があります。時刻を変更してください。', true)
    return
  }

  scheduleSaving.value = true

  try {
    const response = await fetch(`${API_BASE}/schedules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId: selectedVideo.value,
        startsAt,
      }),
    })

    const result: unknown = await response.json().catch(() => ({}))

    if (!response.ok) {
      let message = `HTTP ${response.status}`

      if (
        typeof result === 'object'
        && result !== null
        && 'error' in result
        && typeof result.error === 'string'
      ) {
        message = result.error
      }

      throw new Error(message)
    }

    await loadSchedules()

    if (schedulesError.value) {
      showNotice(
        '登録リクエストは成功しましたが、一覧を再取得できませんでした。再読み込みしてください。',
        true,
      )
      return
    }

    showAddSchedule.value = false
    showNotice('スケジュールを保存しました。')
  } catch (error) {
    console.error('Failed to add schedule:', error)

    showNotice(
      `登録できませんでした：${error instanceof Error ? error.message : '不明なエラー'}`,
      true,
    )
  } finally {
    scheduleSaving.value = false
  }
}

async function cancelSchedule(id: string) {
  const confirmed = window.confirm(
    'この予約を削除しますか？この操作は取り消せません。',
  )

  if (!confirmed) return

  showNotice('')

  try {
    const response = await fetch(
      `${API_BASE}/schedules/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      },
    )

    if (!response.ok) {
      let message = `HTTP ${response.status}`

      try {
        const data: unknown = await response.json()

        if (
          typeof data === 'object'
          && data !== null
          && 'error' in data
          && typeof data.error === 'string'
        ) {
          message = data.error
        }
      } catch {
        // エラーレスポンスがJSONでなくても処理を続ける
      }

      throw new Error(message)
    }

    await loadSchedules()

    if (schedulesError.value) {
      showNotice(
        '予約は削除されましたが、一覧を再取得できませんでした。再読み込みしてください。',
        true,
      )
      return
    }

    showNotice('予約を削除しました。')
  } catch (error) {
    console.error('Failed to delete schedule:', error)

    showNotice(
      `予約を削除できませんでした：${error instanceof Error ? error.message : '不明なエラー'}`,
      true,
    )
  }
}

function openSchedule() {
  showNotice('')
  showAddSchedule.value = true
}
</script>

<template>
  <main class="min-h-screen bg-slate-50 text-slate-800">
    <div class="mx-auto max-w-7xl px-5 py-8 md:px-8">
      <header class="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>

          <h1 class="text-3xl font-bold tracking-tight">Video Control</h1>
          <p class="mt-2 text-sm text-slate-500">
            イベント映像と再生スケジュールを管理
          </p>
        </div>

        <button
          class="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          @click="openSchedule"
        >
          ＋ 予定を追加
        </button>
      </header>

      <nav class="mb-7 flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5">
        <button
          v-for="tab in [
            { id: 'overview', label: '概要' },
            { id: 'videos', label: '動画ライブラリ' },
            { id: 'schedule', label: 'スケジュール' },
        ]"
          :key="tab.id"
          class="shrink-0 rounded-lg px-4 py-2.5 text-sm font-medium"
          :class="activeTab === tab.id
            ? 'bg-slate-900 text-white'
            : 'text-slate-600 hover:bg-slate-100'"
          @click="activeTab = tab.id as typeof activeTab"
        >
          {{ tab.label }}
        </button>
        <button
          v-if="canManageUsers"
          class="shrink-0 rounded-lg px-4 py-2.5 text-sm font-medium"
          :class="activeTab === 'users' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'"
          @click="activeTab = 'users'; void loadUsers()"
        >
          ユーザー管理
        </button>
      </nav>

      <div
        v-if="notice"
        class="mb-5 flex items-center justify-between rounded-xl border px-4 py-3 text-sm"
        :class="noticeIsError
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-blue-200 bg-blue-50 text-blue-800'"
      >
        {{ notice }}
        <button class="ml-4 font-bold" @click="notice = ''">×</button>
      </div>

      <template v-if="activeTab === 'overview'">
        <section class="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-sm text-slate-500">登録動画</p>
            <p class="mt-3 text-3xl font-bold">{{ videos.length }}</p>
            <p class="mt-2 text-xs text-slate-400">ライブラリ内の動画</p>
          </article>

          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-sm text-slate-500">再生予定</p>
            <p class="mt-3 text-3xl font-bold">{{ upcomingCount }}</p>
            <p class="mt-2 text-xs text-slate-400">取得した予約数</p>
          </article>

          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-sm text-slate-500">保存容量</p>
            <p class="mt-3 text-3xl font-bold">{{ (totalVideoBytes / (1024 * 1024)).toFixed(1) }} <span class="text-base font-medium text-slate-400">MiB</span></p>
            <p class="mt-2 text-xs text-slate-400">登録済み動画サイズの合計</p>
          </article>

          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-sm text-slate-500">未使用動画</p>
            <p class="mt-3 text-3xl font-bold">{{ unusedVideoCount }}</p>
            <button
              class="mt-2 text-xs font-medium text-blue-600 hover:text-blue-800"
              @click="activeTab = 'videos'; unusedOnly = true"
            >
              未使用動画を確認 →
            </button>
          </article>
        </section>



        <section class="rounded-2xl border border-slate-200 bg-white p-6">
          <div class="mb-4 flex items-center justify-between gap-3">
            <h2 class="text-lg font-bold">直近のスケジュール</h2>
            <button
              class="text-sm font-semibold text-blue-600 hover:text-blue-800"
              @click="activeTab = 'schedule'"
            >
              すべて表示 →
            </button>
          </div>

          <p v-if="schedulesLoading" class="py-6 text-center text-slate-500">
            スケジュールを読み込み中...
          </p>
          <p v-else-if="schedulesError" class="py-6 text-center text-red-600">
            {{ schedulesError }}
          </p>
          <p v-else-if="schedules.length === 0" class="py-6 text-center text-slate-500">
            スケジュールはありません。
          </p>

          <div v-else class="divide-y divide-slate-100">
            <div
              v-for="item in schedules.slice(0, 4)"
              :key="item.id"
              class="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div>
                <p class="font-medium">{{ videoTitle(item.videoId) }}</p>
                <p class="mt-1 text-sm text-slate-500">
                  {{ formatDateTime(item.startsAt) }}
                </p>
              </div>
              <span class="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                {{ item.status }}
              </span>
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="activeTab === 'videos'">
        <section class="mb-6 rounded-2xl border border-slate-200 bg-white p-6">
          <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 class="text-xl font-bold">動画をアップロード</h2>
              <p class="mt-1 text-sm text-slate-500">
                MP4 などの動画ファイルを登録します（最大 100 MiB）。
              </p>
            </div>
            <p class="text-sm text-slate-600">
              登録済み合計：{{ (totalVideoBytes / (1024 * 1024)).toFixed(1) }} MiB
            </p>
          </div>
          <form class="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end" @submit.prevent="uploadVideo">
            <label class="block text-sm font-medium">
              動画名
              <input
                v-model="uploadTitle"
                type="text"
                maxlength="120"
                required
                class="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-2.5 font-normal"
                placeholder="例：オープニング映像"
              >
            </label>
            <label class="block text-sm font-medium">
              動画ファイル
              <input
                ref="uploadFileInput"
                type="file"
                accept="video/*"
                required
                class="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2 font-normal file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5"
                @change="selectUploadFile"
              >
            </label>
            <button
              type="submit"
              :disabled="uploading || !uploadTitle.trim() || !uploadFile"
              class="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {{ uploading ? 'アップロード中...' : 'アップロード' }}
            </button>
          </form>
        </section>

        <section class="rounded-2xl border border-slate-200 bg-white p-6">
          <div class="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 class="text-xl font-bold">動画ライブラリ</h2>
              <p class="mt-1 text-sm text-slate-500">
                APIから取得した動画一覧
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <label class="flex items-center gap-2 text-sm text-slate-600">
                <input v-model="unusedOnly" type="checkbox" class="checkbox checkbox-sm">
                未使用のみ
              </label>
              <input
                v-model="search"
                type="search"
                placeholder="動画を検索..."
                class="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm sm:w-64"
              >
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full min-w-[640px] text-left text-sm">
              <thead class="border-b border-slate-200 text-slate-500">
                <tr>
                  <th class="py-3 pr-4 font-medium">動画名</th>
                  <th class="py-3 pr-4 font-medium">長さ</th>
                  <th class="py-3 pr-4 font-medium">サイズ</th>
                  <th class="py-3 font-medium">状態</th>
                  <th class="py-3 pl-4 font-medium">操作</th>
                </tr>
              </thead>

              <tbody class="divide-y divide-slate-100">
                <tr v-if="videosLoading">
                  <td colspan="5" class="py-8 text-center text-slate-500">
                    動画一覧を読み込み中...
                  </td>
                </tr>
                <tr v-else-if="videosError">
                  <td colspan="5" class="py-8 text-center text-red-600">
                    {{ videosError }}
                  </td>
                </tr>
                <tr v-else-if="filteredVideos.length === 0">
                  <td colspan="5" class="py-8 text-center text-slate-500">
                    {{ unusedOnly || search ? '条件に一致する動画がありません。' : '動画が登録されていません。' }}
                  </td>
                </tr>
                <tr v-for="video in !videosLoading && !videosError ? filteredVideos : []" :key="video.id">
                  <td class="py-4 pr-4 font-medium">{{ video.title }}</td>
                  <td class="py-4 pr-4 text-slate-500">不明</td>
                  <td class="py-4 pr-4 text-slate-500">
                    {{ (video.sizeBytes / (1024 * 1024)).toFixed(1) }} MB
                  </td>
                  <td class="py-4">
                    <span class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                      登録済み
                    </span>
                  </td>
                  <td class="py-4 pl-4">
                    <button
                      v-if="video.canDelete && video.isUnused"
                      class="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      :disabled="deletingVideoId !== null"
                      @click="deleteVideo(video)"
                    >
                      {{ deletingVideoId === video.id ? '削除中...' : '削除' }}
                    </button>
                    <span v-else-if="video.canDelete" class="text-xs text-slate-400">予定あり</span>
                    <span v-else class="text-xs text-slate-400">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <template v-else-if="activeTab === 'schedule'">
        <section class="rounded-2xl border border-slate-200 bg-white p-6">
          <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-xl font-bold">スケジュール</h2>
              <p class="mt-1 text-sm text-slate-500">
                APIに保存された予約を表示しています。
              </p>
            </div>
            <button
              class="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              @click="openSchedule"
            >
              ＋ 予定を追加
            </button>
          </div>

          <p v-if="schedulesLoading" class="py-8 text-center text-slate-500">
            スケジュールを読み込み中...
          </p>
          <p v-else-if="schedulesError" class="py-8 text-center text-red-600">
            {{ schedulesError }}
          </p>
          <p v-else-if="schedules.length === 0" class="py-8 text-center text-slate-500">
            スケジュールがありません。
          </p>

          <div v-else class="divide-y divide-slate-100">
            <div
              v-for="item in schedules"
              :key="item.id"
              class="flex flex-wrap items-center justify-between gap-4 py-4"
            >
              <div>
                <p class="font-semibold">{{ videoTitle(item.videoId) }}</p>
                <p class="mt-1 text-sm text-slate-500">
                  {{ formatDateTime(item.startsAt) }}
                </p>
              </div>
              <div class="flex items-center gap-3">
                <span class="text-xs text-slate-500">{{ item.status }}</span>
                <button
                  class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium hover:bg-slate-50"
                  @click="cancelSchedule(item.id)"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="activeTab === 'users' && canManageUsers">
        <section class="mb-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 class="text-xl font-bold">ユーザーを登録</h2>
          <p class="mt-2 text-sm text-slate-500">ここではAPI上の役割を登録します。管理ページへのログイン許可はCloudflare Accessの許可リストにも必要です。</p>
          <form class="mt-4 grid gap-3 md:grid-cols-[1fr_12rem_auto]" @submit.prevent="addUser">
            <input v-model="newUserEmail" type="email" required maxlength="254" placeholder="メンバーのメールアドレス" class="rounded-xl border border-slate-200 px-4 py-2.5">
            <select v-model="newUserRole" class="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <option value="producer">動画制作担当</option>
              <option value="operator">運用担当</option>
              <option value="admin">管理者</option>
            </select>
            <button :disabled="savingUser" class="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{{ savingUser ? '登録中...' : '登録' }}</button>
          </form>
        </section>
        <section class="rounded-2xl border border-slate-200 bg-white p-6">
          <div class="flex items-center justify-between gap-3"><h2 class="text-xl font-bold">登録済みユーザー</h2><button class="text-sm text-blue-600" @click="void loadUsers()">再読み込み</button></div>
          <p v-if="usersLoading" class="py-6 text-center text-slate-500">読み込み中...</p>
          <p v-else-if="usersError" class="py-6 text-center text-red-600">{{ usersError }}</p>
          <div v-else class="mt-4 divide-y divide-slate-100">
            <div v-for="user in managedUsers" :key="user.id" class="flex flex-wrap items-center justify-between gap-3 py-3">
              <span class="font-medium">{{ user.email }}</span>
              <select :value="user.role" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" @change="changeUserRole(user, $event)">
                <option value="producer">動画制作担当</option><option value="operator">運用担当</option><option value="admin">管理者</option>
              </select>
            </div>
            <p v-if="!managedUsers.length" class="py-6 text-center text-slate-500">ユーザーがいません。</p>
          </div>
        </section>
      </template>

      <footer class="mt-8 text-center text-xs text-slate-400">
        Video Control · Cloudflareに保存 · 10G超えた状態で1ヶ月以上放置したらお金がかかります
      </footer>
    </div>

    <div
      v-if="showAddSchedule"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      @click.self="!scheduleSaving && (showAddSchedule = false)"
    >
      <section class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div class="mb-5 flex items-center justify-between">
          <h2 class="text-xl font-bold">再生予定を追加</h2>
          <button
            class="rounded-lg px-3 py-1 text-xl text-slate-400 hover:bg-slate-100 disabled:opacity-50"
            :disabled="scheduleSaving"
            @click="showAddSchedule = false"
          >
            ×
          </button>
        </div>

        <form class="space-y-4" @submit.prevent="addSchedule">
          <label class="block">
            <span class="mb-2 block text-sm font-medium">動画</span>
            <select
              v-model="selectedVideo"
              required
              :disabled="videosLoading || videos.length === 0 || scheduleSaving"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm disabled:bg-slate-100"
            >
              <option value="" disabled>動画を選択してください</option>
              <option v-for="video in videos" :key="video.id" :value="video.id">
                {{ video.title }}
              </option>
            </select>
            <span v-if="videosError" class="mt-1 block text-xs text-red-600">
              {{ videosError }}
            </span>
          </label>

          <label class="block">
            <span class="mb-2 block text-sm font-medium">日付</span>
            <input
              v-model="selectedDate"
              type="date"
              required
              :disabled="scheduleSaving"
              class="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm disabled:bg-slate-100"
            >
          </label>

          <label class="block">
            <span class="mb-2 block text-sm font-medium">開始時刻</span>
            <input
              v-model="selectedTime"
              type="time"
              required
              :disabled="scheduleSaving"
              class="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm disabled:bg-slate-100"
            >
          </label>

          <p class="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            開始時刻になると、メインページを開いている端末で動画を全画面再生します。ブラウザーの設定により最初の再生操作が必要な場合があります。
          </p>

          <div class="flex justify-end gap-3 pt-2">
            <button
              type="button"
              :disabled="scheduleSaving"
              class="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
              @click="showAddSchedule = false"
            >
              戻る
            </button>
            <button
              type="submit"
              :disabled="scheduleSaving || videos.length === 0"
              class="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {{ scheduleSaving ? '保存中...' : '予定を追加' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </main>
</template>
