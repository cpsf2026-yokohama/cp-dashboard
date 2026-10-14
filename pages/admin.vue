<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

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
const scheduleDialog = ref<HTMLDialogElement | null>(null)

watch(showAddSchedule, async (open) => {
  await nextTick()
  if (open) {
    if (!scheduleDialog.value?.open) scheduleDialog.value?.showModal()
  } else {
    scheduleDialog.value?.close()
  }
})

function dismissScheduleBackdrop(event: MouseEvent) {
  const dialog = scheduleDialog.value
  if (!dialog || event.target !== dialog || scheduleSaving.value) return
  const bounds = dialog.getBoundingClientRect()
  if (
    event.clientX < bounds.left || event.clientX > bounds.right
    || event.clientY < bounds.top || event.clientY > bounds.bottom
  ) {
    showAddSchedule.value = false
  }
}

function keepScheduleFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const dialog = scheduleDialog.value
  if (!dialog) return
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled])',
  ))
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (!first || !last) {
    event.preventDefault()
    return
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
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
  <main class="admin-page" data-theme="light">
    <div class="admin-shell">
      <header class="page-header">
        <div>
          <h1>Video Control</h1>
          <p class="muted">動画と再生予定を管理</p>
        </div>
        <button class="button button-primary" @click="openSchedule">予定を追加</button>
      </header>

      <nav class="admin-tabs" aria-label="管理メニュー">
        <button
          v-for="tab in [
            { id: 'overview', label: '概要' },
            { id: 'videos', label: '動画ライブラリ' },
            { id: 'schedule', label: 'スケジュール' },
          ]"
          :key="tab.id"
          :class="{ active: activeTab === tab.id }"
          :aria-current="activeTab === tab.id ? 'page' : undefined"
          @click="activeTab = tab.id as typeof activeTab"
        >{{ tab.label }}</button>
        <button
          v-if="canManageUsers"
          :class="{ active: activeTab === 'users' }"
          :aria-current="activeTab === 'users' ? 'page' : undefined"
          @click="activeTab = 'users'; void loadUsers()"
        >ユーザー管理</button>
      </nav>

      <div v-if="notice && !showAddSchedule" class="notice" :class="{ 'notice-error': noticeIsError }" :role="noticeIsError ? 'alert' : 'status'">
        <span>{{ notice }}</span>
        <button class="icon-button" aria-label="通知を閉じる" @click="notice = ''">×</button>
      </div>

      <template v-if="activeTab === 'overview'">
        <section class="stats" aria-label="管理状況">
          <article>
            <span class="muted">登録動画</span>
            <strong>{{ videosLoading || videosError ? '—' : videos.length }}</strong>
          </article>
          <article>
            <span class="muted">再生予定</span>
            <strong>{{ schedulesLoading || schedulesError ? '—' : upcomingCount }}</strong>
          </article>
          <article>
            <span class="muted">保存容量</span>
            <strong>{{ videosLoading || videosError ? '—' : (totalVideoBytes / (1024 * 1024)).toFixed(1) }} <small v-if="!videosLoading && !videosError">MiB</small></strong>
          </article>
          <article>
            <button class="text-button" @click="activeTab = 'videos'; unusedOnly = true">未使用動画 →</button>
            <strong>{{ videosLoading || videosError ? '—' : unusedVideoCount }}</strong>
          </article>
        </section>

        <section class="panel">
          <div class="section-heading">
            <h2>直近のスケジュール</h2>
            <button class="text-button" @click="activeTab = 'schedule'">すべて表示 →</button>
          </div>
          <p v-if="videosError" class="state-message error" role="alert">{{ videosError }}</p>
          <p v-if="schedulesLoading" class="state-message muted" role="status">スケジュールを読み込み中...</p>
          <p v-else-if="schedulesError" class="state-message error" role="alert">{{ schedulesError }}</p>
          <p v-else-if="schedules.length === 0" class="state-message muted">スケジュールはありません。</p>
          <div v-else class="schedule-list">
            <div v-for="item in schedules.slice(0, 5)" :key="item.id" class="schedule-row">
              <time :datetime="item.startsAt">{{ formatDateTime(item.startsAt) }}</time>
              <span class="item-title">{{ videoTitle(item.videoId) }}</span>
              <span class="badge">{{ item.status }}</span>
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="activeTab === 'videos'">
        <section class="panel">
          <div class="section-heading">
            <div>
              <h2>動画をアップロード</h2>
              <p class="help">動画ファイル・最大 100 MiB</p>
            </div>
            <p class="help">登録済み合計：{{ videosLoading || videosError ? '—' : (totalVideoBytes / (1024 * 1024)).toFixed(1) }} MiB</p>
          </div>
          <form class="upload-form" @submit.prevent="uploadVideo">
            <label class="field">
              <span>動画名</span>
              <input v-model="uploadTitle" type="text" maxlength="120" required placeholder="例：オープニング映像">
            </label>
            <label class="field">
              <span>動画ファイル</span>
              <input ref="uploadFileInput" type="file" accept="video/*" required @change="selectUploadFile">
            </label>
            <button type="submit" :disabled="uploading || !uploadTitle.trim() || !uploadFile" class="button button-primary">
              {{ uploading ? 'アップロード中...' : 'アップロード' }}
            </button>
          </form>
        </section>

        <section class="panel">
          <div class="section-heading library-heading">
            <h2>動画ライブラリ</h2>
            <div class="library-filters">
              <label class="check-field"><input v-model="unusedOnly" type="checkbox">未使用のみ</label>
              <input v-model="search" type="search" aria-label="動画を検索" placeholder="動画を検索...">
            </div>
          </div>
          <table class="video-table">
            <thead>
              <tr><th scope="col">動画名</th><th scope="col">サイズ</th><th scope="col">状態</th><th scope="col" class="actions">操作</th></tr>
            </thead>
            <tbody>
              <tr v-if="videosLoading"><td colspan="4" class="state-message muted" role="status">動画一覧を読み込み中...</td></tr>
              <tr v-else-if="videosError"><td colspan="4" class="state-message error" role="alert">{{ videosError }}</td></tr>
              <tr v-else-if="filteredVideos.length === 0"><td colspan="4" class="state-message muted">{{ unusedOnly || search ? '条件に一致する動画がありません。' : '動画が登録されていません。' }}</td></tr>
              <tr v-for="video in !videosLoading && !videosError ? filteredVideos : []" :key="video.id" class="video-row">
                <td class="item-title">{{ video.title }}</td>
                <td data-label="サイズ" class="metadata">{{ (video.sizeBytes / (1024 * 1024)).toFixed(1) }} MiB</td>
                <td data-label="状態"><span class="badge badge-neutral">{{ video.isUnused ? '未使用' : '予定あり' }}</span></td>
                <td class="actions">
                  <button v-if="video.canDelete && video.isUnused" class="button button-danger button-small" :disabled="deletingVideoId !== null" :aria-label="`${video.title}を削除`" @click="deleteVideo(video)">
                    {{ deletingVideoId === video.id ? '削除中...' : '削除' }}
                  </button>
                  <span v-else-if="video.canDelete" class="help">予定あり</span>
                  <span v-else class="help">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>

      <template v-else-if="activeTab === 'schedule'">
        <section class="panel">
          <div class="section-heading"><h2>スケジュール</h2><span class="help">{{ schedulesLoading || schedulesError ? '—' : schedules.length }} 件</span></div>
          <p v-if="schedulesLoading" class="state-message muted" role="status">スケジュールを読み込み中...</p>
          <p v-else-if="schedulesError" class="state-message error" role="alert">{{ schedulesError }}</p>
          <p v-else-if="schedules.length === 0" class="state-message muted">スケジュールがありません。「予定を追加」から登録できます。</p>
          <div v-else class="schedule-list">
            <div v-for="item in schedules" :key="item.id" class="schedule-row">
              <time :datetime="item.startsAt">{{ formatDateTime(item.startsAt) }}</time>
              <span class="item-title">{{ videoTitle(item.videoId) }}</span>
              <div class="row-actions">
                <span class="badge">{{ item.status }}</span>
                <button class="button button-small" :aria-label="`${videoTitle(item.videoId)}の予約をキャンセル`" @click="cancelSchedule(item.id)">キャンセル</button>
              </div>
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="activeTab === 'users' && canManageUsers">
        <section class="panel">
          <div class="section-heading"><h2>ユーザーを登録</h2></div>
          <form class="user-form" @submit.prevent="addUser">
            <label class="field"><span>メールアドレス</span><input v-model="newUserEmail" type="email" required maxlength="254" placeholder="メンバーのメールアドレス"></label>
            <label class="field">
              <span>役割</span>
              <select v-model="newUserRole"><option value="producer">動画制作担当</option><option value="operator">運用担当</option><option value="admin">管理者</option></select>
            </label>
            <button :disabled="savingUser" class="button button-primary">{{ savingUser ? '登録中...' : '登録' }}</button>
          </form>
          <p class="help access-help">ログイン許可には、Cloudflare Accessの許可リストへの追加も必要です。</p>
        </section>
        <section class="panel">
          <div class="section-heading"><h2>登録済みユーザー</h2><button class="text-button" @click="void loadUsers()">再読み込み</button></div>
          <p v-if="usersLoading" class="state-message muted" role="status">読み込み中...</p>
          <p v-else-if="usersError" class="state-message error" role="alert">{{ usersError }}</p>
          <div v-else class="user-list">
            <div v-for="user in managedUsers" :key="user.id" class="user-row">
              <span class="item-title">{{ user.email }}</span>
              <select :value="user.role" :aria-label="`${user.email}の役割`" @change="changeUserRole(user, $event)"><option value="producer">動画制作担当</option><option value="operator">運用担当</option><option value="admin">管理者</option></select>
            </div>
            <p v-if="!managedUsers.length" class="state-message muted">ユーザーがいません。</p>
          </div>
        </section>
      </template>

      <footer class="page-footer">Video Control · Cloudflareに保存 · 10G超えた状態で1ヶ月以上放置したらお金がかかります</footer>
    </div>

    <dialog ref="scheduleDialog" class="schedule-dialog" aria-labelledby="schedule-heading" @close="showAddSchedule = false" @cancel="scheduleSaving && $event.preventDefault()" @click="dismissScheduleBackdrop" @keydown="keepScheduleFocus">
      <div class="section-heading">
        <h2 id="schedule-heading">再生予定を追加</h2>
        <button class="icon-button" aria-label="再生予定の追加を閉じる" :disabled="scheduleSaving" @click="showAddSchedule = false">×</button>
      </div>
      <div v-if="notice" class="notice" :class="{ 'notice-error': noticeIsError }" :role="noticeIsError ? 'alert' : 'status'">{{ notice }}</div>
      <form class="schedule-form" @submit.prevent="addSchedule">
        <label class="field">
          <span>動画</span>
          <select v-model="selectedVideo" required :disabled="videosLoading || videos.length === 0 || scheduleSaving">
            <option value="" disabled>動画を選択してください</option>
            <option v-for="video in videos" :key="video.id" :value="video.id">{{ video.title }}</option>
          </select>
          <span v-if="videosError" class="help error">{{ videosError }}</span>
        </label>
        <div class="date-time-fields">
          <label class="field"><span>日付</span><input v-model="selectedDate" type="date" required :disabled="scheduleSaving"></label>
          <label class="field"><span>開始時刻</span><input v-model="selectedTime" type="time" required :disabled="scheduleSaving"></label>
        </div>
        <p class="help playback-help">開始時刻に、メインページを開いている端末で全画面再生します。ブラウザーによっては、最初に再生操作が必要です。</p>
        <div class="dialog-actions">
          <button type="button" :disabled="scheduleSaving" class="button" @click="showAddSchedule = false">戻る</button>
          <button type="submit" :disabled="scheduleSaving || videos.length === 0" class="button button-primary">{{ scheduleSaving ? '保存中...' : '予定を追加' }}</button>
        </div>
      </form>
    </dialog>
  </main>
</template>

<style scoped>
.admin-page {
  --admin-background: #f7f8fa;
  --admin-surface: #fff;
  --admin-text: #1f2937;
  --admin-muted: #4b5563;
  --admin-border: #d1d5db;
  --admin-blue: #1d4ed8;
  color-scheme: light;
  min-height: 100dvh;
  background: var(--admin-background);
  color: var(--admin-text);
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
.admin-shell { max-width: 1200px; margin: 0 auto; padding: 28px 32px; }
.page-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
h1 { font-size: 24px; font-weight: 600; line-height: 1.4; }
h2 { font-size: 18px; font-weight: 600; line-height: 1.5; }
.page-header p { margin-top: 4px; }
.muted, .help, .metadata { color: var(--admin-muted); }
.help { font-size: 12px; line-height: 1.65; }
.error { color: #b91c1c; }
.admin-page :where(button, input, select) { font: inherit; color-scheme: light; }
.admin-page input:not([type='checkbox']), .admin-page select {
  display: block; width: 100%; min-width: 0; height: 40px; padding: 8px 10px;
  color: var(--admin-text); background: var(--admin-surface);
  border: 1px solid var(--admin-border); border-radius: 6px;
}
.admin-page input::placeholder { color: #6b7280; opacity: 1; }
.admin-page input:disabled, .admin-page select:disabled { background: #f3f4f6; color: var(--admin-muted); cursor: not-allowed; opacity: 1; }
.admin-page input[type='file'] { padding: 5px; font-size: 12px; }
.admin-page input[type='file']::file-selector-button { margin-right: 8px; padding: 4px 8px; border: 0; border-radius: 4px; background: #eef2f6; color: var(--admin-text); font: inherit; cursor: pointer; }
.admin-page input[type='checkbox'] { appearance: auto; width: 16px; height: 16px; margin: 0; accent-color: var(--admin-blue); background: white; flex-shrink: 0; }
.admin-page :is(button, input, select):focus-visible { outline: 2px solid var(--admin-blue); outline-offset: 3px; }
.admin-page button { cursor: pointer; }
.admin-page button:disabled { cursor: not-allowed; }
.button { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 8px 14px; border: 1px solid var(--admin-border); border-radius: 6px; background: var(--admin-surface); color: var(--admin-text); font-weight: 500; white-space: nowrap; }
.button:hover:not(:disabled) { background: #f3f4f6; }
.button-primary { background: var(--admin-blue); border-color: var(--admin-blue); color: white; }
.button-primary:hover:not(:disabled) { background: #1e40af; border-color: #1e40af; }
.button:disabled { background: #eef2f6; border-color: var(--admin-border); color: #6b7280; }
.button-small { min-height: 32px; padding: 5px 10px; font-size: 12px; }
.button-danger { color: #b91c1c; }
.button-danger:hover:not(:disabled) { background: #fef2f2; }
.text-button { color: var(--admin-blue); background: transparent; border: 0; font-weight: 500; }
.text-button:hover { text-decoration: underline; text-underline-offset: 3px; }
.icon-button { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex-shrink: 0; border-radius: 6px; background: transparent; color: var(--admin-muted); font-size: 22px; }
.icon-button:hover:not(:disabled) { background: #eef2f6; }
.admin-tabs { display: flex; gap: 24px; margin-bottom: 20px; border-bottom: 1px solid var(--admin-border); overflow-x: auto; }
.admin-tabs button { position: relative; padding: 10px 0 12px; flex-shrink: 0; background: transparent; color: var(--admin-muted); border-bottom: 2px solid transparent; font-weight: 500; }
.admin-tabs button.active { color: var(--admin-blue); border-bottom-color: var(--admin-blue); }
.admin-tabs button:hover { color: var(--admin-blue); }
.admin-tabs button:focus-visible { outline-offset: -3px; }
.panel { padding: 18px 20px; border: 1px solid var(--admin-border); border-radius: 8px; background: var(--admin-surface); }
.panel + .panel { margin-top: 16px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; }
.section-heading .help { margin-top: 3px; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 20px; padding: 16px 0; border: 1px solid var(--admin-border); border-radius: 8px; background: var(--admin-surface); }
.stats article { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 0 20px; border-right: 1px solid var(--admin-border); }
.stats article:last-child { border-right: 0; }
.stats strong { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.3; }
.stats small { font-size: 12px; font-weight: 400; color: var(--admin-muted); }
.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.field > span:first-child { font-weight: 500; }
.upload-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 14px; align-items: end; }
.library-filters { display: flex; gap: 16px; align-items: center; }
.check-field { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.library-filters input[type='search'] { width: 240px; }
.video-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.video-table th { padding: 8px 12px 8px 0; text-align: left; color: var(--admin-muted); font-weight: 400; font-size: 12px; border-bottom: 1px solid var(--admin-border); }
.video-table th:first-child { width: 55%; }
.video-table th:last-child { width: 100px; }
.video-table td { padding: 10px 12px 10px 0; border-bottom: 1px solid #e5e7eb; vertical-align: middle; }
.video-table tr:last-child td { border-bottom: 0; }
.video-table .actions { padding-right: 0; text-align: right; }
.item-title { min-width: 0; overflow-wrap: anywhere; font-weight: 500; }
.metadata { font-variant-numeric: tabular-nums; white-space: nowrap; }
.badge { display: inline-flex; align-items: center; height: auto; min-height: 24px; padding: 2px 7px; background: #eff6ff; color: var(--admin-blue); border: 0; border-radius: 4px; font-size: 12px; white-space: nowrap; }
.badge-neutral { background: #f3f4f6; color: var(--admin-muted); }
.state-message { padding: 24px 0 !important; text-align: center; overflow-wrap: anywhere; }
.schedule-row { display: grid; grid-template-columns: 155px minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
.schedule-row:last-child { border-bottom: 0; }
.schedule-row time { font-size: 13px; color: var(--admin-muted); font-variant-numeric: tabular-nums; }
.row-actions { display: flex; align-items: center; gap: 12px; }
.user-form { display: grid; grid-template-columns: minmax(0, 1fr) 180px auto; gap: 14px; align-items: end; }
.access-help { margin-top: 10px; }
.user-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
.user-row:last-child { border-bottom: 0; }
.user-row select { width: 180px; flex-shrink: 0; }
.notice { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; padding: 10px 12px; border: 1px solid #bfdbfe; border-radius: 6px; background: #eff6ff; color: #1e40af; overflow-wrap: anywhere; }
.notice-error { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }
.page-footer { margin-top: 24px; color: var(--admin-muted); font-size: 11px; }
.schedule-dialog { width: min(460px, calc(100% - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 20px; overflow-y: auto; border: 1px solid var(--admin-border); border-radius: 8px; background: var(--admin-surface); color: var(--admin-text); box-shadow: 0 12px 40px #11182726; }
.schedule-dialog::backdrop { background: #11182766; }
.schedule-form { display: flex; flex-direction: column; gap: 16px; }
.date-time-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.playback-help { padding-top: 12px; border-top: 1px solid #e5e7eb; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }
@media (max-width: 767px) {
  .admin-shell { padding: 20px 16px; }
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 0; }
  .stats article { padding: 14px 16px; }
  .stats article:nth-child(2) { border-right: 0; }
  .stats article:nth-child(-n+2) { border-bottom: 1px solid var(--admin-border); }
  .upload-form, .user-form { grid-template-columns: minmax(0, 1fr); }
  .upload-form > .button, .user-form > .button { justify-self: start; }
  .video-table th:first-child { width: 45%; }
  .schedule-row { grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; }
  .schedule-row time { grid-column: 1 / -1; }
}
@media (max-width: 600px) {
  .panel { padding: 16px; }
  .admin-tabs { gap: 12px; }
  .library-heading, .library-filters { align-items: stretch; width: 100%; }
  .library-filters { flex-wrap: wrap; gap: 12px; }
  .library-filters input[type='search'] { width: 100%; }
  .video-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .video-table tbody { display: block; }
  .video-table tr { display: block; padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
  .video-table tr:last-child { border-bottom: 0; }
  .video-table td { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0; border: 0; }
  .video-table td.item-title { display: block; margin-bottom: 6px; }
  .video-table td[data-label]::before { content: attr(data-label); color: var(--admin-muted); font-size: 12px; }
  .video-table td.actions { justify-content: flex-end; }
  .video-table td.state-message { display: block; }
  .schedule-row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .schedule-row time { grid-column: auto; }
  .row-actions { justify-content: space-between; }
  .user-row { align-items: flex-start; flex-direction: column; gap: 8px; }
  .user-row select { width: 100%; }
}
@media (max-width: 359px) {
  .admin-tabs { gap: 6px; font-size: 12px; }
  .page-header { align-items: flex-start; flex-direction: column; }
  .date-time-fields { grid-template-columns: minmax(0, 1fr); }
}
</style>
