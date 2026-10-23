<script setup lang="ts">
type ChangeRequest = { id: string; kind: string; summary: string; payload: Record<string, unknown>; requesterEmail: string; createdAt: string; isMine: boolean }
type ScheduleEvent = { date: string; label: string; color?: string }
type ScheduleDiff = {
  key: string
  label: string
  beforeKnown: boolean
  added: ScheduleEvent[]
  removed: ScheduleEvent[]
  updated: Array<{ before: ScheduleEvent; after: ScheduleEvent }>
  unchanged: number
  proposed: ScheduleEvent[]
}
const api = useVideoApiBase()
const requests = ref<ChangeRequest[]>([])
const canReview = ref(false)
const loading = ref(true)
const error = ref('')
const busyId = ref('')
const failedImages = ref(new Set<string>())
const route = useRoute()
const appBase = String(useRuntimeConfig().app.baseURL || '/').replace(/\/?$/, '/')

function appPath(path: string) {
  return `${appBase}${path.replace(/^\/+/, '')}`
}

async function loadRequests() {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch(`${api}/change-requests`)
    if (response.status === 401 && route.query.accessRetry !== '1') {
      window.location.replace(`${appPath('admin')}?returnTo=mentor&accessRetry=1`)
      return
    }
    if (!response.ok) {
      throw new Error(response.status === 403
        ? '申請一覧を表示する権限が必要です。'
        : response.status === 401
          ? '認証を確認できません。管理画面でログインし直してください。'
          : `HTTP ${response.status}`)
    }
    const data = await response.json() as { requests: ChangeRequest[]; canReview?: boolean }
    requests.value = data.requests
    canReview.value = data.canReview === true
    failedImages.value = new Set()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '申請を読み込めませんでした。'
    requests.value = []
  } finally { loading.value = false }
}

async function decide(item: ChangeRequest, action: 'approve' | 'reject') {
  if (!canReview.value) return
  if (!window.confirm(`「${item.summary}」を${action === 'approve' ? '承認して反映' : '却下'}しますか？`)) return
  busyId.value = item.id; error.value = ''
  try {
    const response = await fetch(`${api}/change-requests/${encodeURIComponent(item.id)}/${action}`, { method: 'POST' })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error || `HTTP ${response.status}`)
    }
    await loadRequests()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '処理に失敗しました。' }
  finally { busyId.value = '' }
}

async function cancel(item: ChangeRequest) {
  if (!window.confirm(`「${item.summary}」の申請を取り消しますか？`)) return
  busyId.value = item.id; error.value = ''
  try {
    const response = await fetch(`${api}/change-requests/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error || `HTTP ${response.status}`)
    }
    await loadRequests()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '申請を取り消せませんでした。' }
  finally { busyId.value = '' }
}

function formatDate(value: string) { return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)) }
function kindLabel(kind: string) {
  return ({ settings: '共有設定', 'schedule.create': '予定の追加', 'schedule.delete': '予定の削除', 'video.delete': '動画の削除', 'video.upload': '動画の追加', 'banner.upload': 'バナー画像の変更', 'banner.delete': 'バナーの削除' } as Record<string, string>)[kind] ?? '変更リクエスト'
}
function bannerKind(item: ChangeRequest) {
  const kind = item.payload.kind
  return kind === 'horizontal' || kind === 'vertical' ? kind : null
}
function currentBannerUrl(item: ChangeRequest) {
  const kind = bannerKind(item)
  return kind ? `${api}/banners/${kind}` : ''
}
function pendingBannerUrl(item: ChangeRequest) {
  return `${api}/change-requests/${encodeURIComponent(item.id)}/preview`
}
function hideUnavailableImage(event: Event, key: string) {
  if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.style.display = 'none'
  failedImages.value = new Set([...failedImages.value, key])
}
function eventList(value: unknown): ScheduleEvent[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    if (typeof record.date !== 'string' || typeof record.label !== 'string') return []
    return [{ date: record.date, label: record.label, ...(typeof record.color === 'string' ? { color: record.color } : {}) }]
  })
}
function scheduleDate(value: string) {
  const recurring = value.match(/^(\d{2})-(\d{2})$/)
  if (recurring) return `${Number(recurring[1])}月${Number(recurring[2])}日`
  const exact = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (exact) return `${exact[1]}年${Number(exact[2])}月${Number(exact[3])}日`
  return value
}
function scheduleDescription(event: ScheduleEvent) {
  return `${scheduleDate(event.date)} · ${event.label}${event.color ? `（${event.color}）` : ''}`
}
function scheduleDiffs(item: ChangeRequest): ScheduleDiff[] {
  if (!item.payload.changes || typeof item.payload.changes !== 'object') return []
  const changes = item.payload.changes as Record<string, { before?: unknown; after?: unknown; beforeKnown?: boolean }>
  const labels: Record<string, string> = { countdownDates: '日付指定の予定', yearlyCountdownDates: '毎年繰り返す予定' }
  return Object.entries(labels).flatMap(([key, label]) => {
    const change = changes[key]
    if (!change) return []
    const beforeKnown = change.beforeKnown !== false && Array.isArray(change.before)
    const before = eventList(change.before)
    const proposed = eventList(change.after)
    if (!beforeKnown) return [{ key, label, beforeKnown, added: [], removed: [], updated: [], unchanged: 0, proposed }]

    const matchedBefore = new Set<number>()
    const added: ScheduleEvent[] = []
    const updated: ScheduleDiff['updated'] = []
    let unchanged = 0
    for (const after of proposed) {
      const beforeIndex = before.findIndex((candidate, index) => !matchedBefore.has(index) && candidate.date === after.date)
      if (beforeIndex < 0) {
        added.push(after)
        continue
      }
      matchedBefore.add(beforeIndex)
      const previous = before[beforeIndex]!
      if (previous.label !== after.label || previous.color !== after.color) updated.push({ before: previous, after })
      else unchanged++
    }
    const removed = before.filter((_, index) => !matchedBefore.has(index))
    return [{ key, label, beforeKnown, added, removed, updated, unchanged, proposed }]
  })
}
function details(item: ChangeRequest) {
  const payload = item.payload
  const rows: Array<[string, string]> = []
  const labels: Record<string, string> = { isBannerVisible: '横バナー', isVerticalBanner: '縦バナー', isChimeEnabled: 'チャイム', isPreChimeEnabled: '予鈴', countdownDates: 'カウントダウン予定', yearlyCountdownDates: '毎年の予定', userChimeTimes: 'チャイム時刻' }
  const valueText = (value: unknown) => {
    if (typeof value === 'boolean') return value ? '有効' : '無効'
    if (Array.isArray(value)) {
      const contents = value.map(entry => typeof entry === 'object' && entry !== null ? JSON.stringify(entry) : String(entry)).join('、')
      return value.length ? `${value.length}件: ${contents}` : '0件'
    }
    if (value === undefined) return '未設定'
    if (typeof value === 'object' && value !== null) return JSON.stringify(value)
    return String(value)
  }
  if (payload.changes && typeof payload.changes === 'object') {
    for (const [key, value] of Object.entries(payload.changes as Record<string, { before?: unknown; after?: unknown; beforeKnown?: boolean }>)) {
      if (key in labels && !['countdownDates', 'yearlyCountdownDates'].includes(key)) rows.push([labels[key], `${value.beforeKnown === false ? '変更前不明' : valueText(value.before)} → ${valueText(value.after)}`])
    }
  }
  if (payload.applyChanges && typeof payload.applyChanges === 'object') {
    for (const [key, value] of Object.entries(payload.applyChanges as Record<string, { before?: boolean; after?: boolean }>)) {
      if (key in labels) rows.push([`${labels[key]}のサイト反映`, `${value.before ? '有効' : '無効'} → ${value.after ? '有効' : '無効'}`])
    }
  }
  if (typeof payload.videoTitle === 'string' || typeof payload.title === 'string') rows.push(['動画', String(payload.videoTitle ?? payload.title)])
  if (typeof payload.startsAt === 'string') rows.push(['予定時刻', formatDate(payload.startsAt)])
  if (typeof payload.kind === 'string') rows.push(['バナー', payload.kind === 'horizontal' ? '横バナー' : '縦バナー'])
  if (item.kind === 'settings' && rows.length === 0) rows.push(['差分', '現在の設定との差分はありません（先に反映された可能性があります）'])
  return rows
}
onMounted(() => void loadRequests())
</script>

<template>
  <main class="mentor-page">
    <header><div><p class="eyebrow">MENTOR REVIEW</p><h1>変更リクエスト</h1><p>{{ canReview ? '承認されるまで、申請内容はサイトや再生端末に反映されません。' : '申請待ちの内容を確認できます。自分の申請は取り消せます。承認・却下はできません。' }}</p></div><nav><a href="/admin">管理画面</a><button @click="void loadRequests()">再読み込み</button></nav></header>
    <p v-if="error" class="error" role="alert">{{ error }} <a v-if="error.includes('認証')" :href="appPath('admin')">管理画面で認証</a></p>
    <p v-if="loading" class="empty" role="status">申請を読み込み中...</p>
    <p v-else-if="!error && requests.length === 0" class="empty">申請待ちはありません。</p>
    <section v-else-if="!error && requests.length > 0" class="request-list" aria-label="承認待ち">
      <article v-for="item in requests" :key="item.id" class="request-card">
        <div class="request-header"><div><h2>{{ item.summary }}</h2><p>{{ item.requesterEmail }} · {{ formatDate(item.createdAt) }}</p></div><span>{{ kindLabel(item.kind) }}</span></div>
        <section v-for="diff in scheduleDiffs(item)" :key="diff.key" class="schedule-diff" :aria-label="`${diff.label}の差分`">
          <div class="schedule-diff-heading"><h3>{{ diff.label }}の変更</h3><span v-if="diff.beforeKnown">{{ diff.added.length }}件追加 · {{ diff.removed.length }}件削除 · {{ diff.updated.length }}件変更</span></div>
          <p v-if="!diff.beforeKnown" class="diff-baseline-note">変更前の内容が記録されていないため、申請された予定を表示しています。</p>
          <div v-if="!diff.beforeKnown" class="diff-group diff-proposed"><strong>申請後の予定（{{ diff.proposed.length }}件）</strong><ul><li v-for="(event, index) in diff.proposed" :key="`${event.date}-${event.label}-${index}`">{{ scheduleDescription(event) }}</li></ul></div>
          <div v-else class="schedule-diff-groups">
            <div v-if="diff.added.length" class="diff-group diff-added"><strong>追加</strong><ul><li v-for="(event, index) in diff.added" :key="`${event.date}-${event.label}-${index}`">{{ scheduleDescription(event) }}</li></ul></div>
            <div v-if="diff.removed.length" class="diff-group diff-removed"><strong>削除</strong><ul><li v-for="(event, index) in diff.removed" :key="`${event.date}-${event.label}-${index}`">{{ scheduleDescription(event) }}</li></ul></div>
            <div v-if="diff.updated.length" class="diff-group diff-updated"><strong>内容変更</strong><ul><li v-for="change in diff.updated" :key="`${change.before.date}-${change.before.label}`">{{ scheduleDate(change.after.date) }}: {{ change.before.label }}{{ change.before.color ? `（${change.before.color}）` : '' }} → {{ change.after.label }}{{ change.after.color ? `（${change.after.color}）` : '' }}</li></ul></div>
            <p v-if="diff.unchanged" class="diff-unchanged">変更なし {{ diff.unchanged }}件</p>
            <p v-if="!diff.added.length && !diff.removed.length && !diff.updated.length" class="diff-baseline-note">予定の内容に差分はありません。</p>
          </div>
        </section>
        <div v-if="bannerKind(item) && (item.kind === 'banner.upload' || item.kind === 'banner.delete')" class="banner-comparison" aria-label="バナー画像の変更比較">
          <figure><figcaption>現在</figcaption><img v-if="!failedImages.has(`${item.id}:current`)" :src="currentBannerUrl(item)" :alt="`${bannerKind(item) === 'horizontal' ? '横' : '縦'}バナーの現在の画像`" @error="hideUnavailableImage($event, `${item.id}:current`)"><p v-else class="image-result">現在の画像を読み込めません</p></figure>
          <div class="change-arrow" aria-hidden="true">→</div>
          <figure><figcaption>変更後</figcaption><img v-if="item.kind === 'banner.upload' && !failedImages.has(`${item.id}:pending`)" :src="pendingBannerUrl(item)" :alt="`${bannerKind(item) === 'horizontal' ? '横' : '縦'}バナーの申請画像`" @error="hideUnavailableImage($event, `${item.id}:pending`)"><p v-else-if="item.kind === 'banner.upload'" class="image-result">申請画像を読み込めません</p><p v-else class="image-result">画像なし（削除）</p></figure>
        </div>
        <details v-if="details(item).length" open><summary>申請内容</summary><dl><template v-for="([label, value], index) in details(item)" :key="`${label}-${index}`"><dt>{{ label }}</dt><dd>{{ value }}</dd></template></dl></details>
        <div class="actions"><template v-if="item.isMine"><button class="reject" :disabled="busyId !== ''" @click="void cancel(item)">{{ busyId === item.id ? '処理中...' : '自分の申請を取り消す' }}</button></template><template v-else-if="canReview"><button class="reject" :disabled="busyId !== ''" @click="void decide(item, 'reject')">却下</button><button class="approve" :disabled="busyId !== ''" @click="void decide(item, 'approve')">{{ busyId === item.id ? '処理中...' : '承認して反映' }}</button></template></div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.mentor-page{max-width:960px;margin:0 auto;padding:40px 24px 80px;color:#182230;font-family:system-ui,sans-serif}.mentor-page header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:32px}.eyebrow{font-size:12px;letter-spacing:.12em;color:#64748b;font-weight:700}.mentor-page h1{margin:4px 0 8px;font-size:32px}.mentor-page header p{color:#64748b}.mentor-page nav{display:flex;gap:12px;align-items:center}.mentor-page button,.mentor-page a{border:1px solid #cbd5e1;border-radius:8px;padding:9px 14px;background:#fff;color:inherit;text-decoration:none;font:inherit;cursor:pointer}.request-list{display:grid;gap:16px}.request-card{border:1px solid #dbe2ea;border-radius:14px;padding:20px;background:#fff;box-shadow:0 3px 10px #0f172a0a}.request-header{display:flex;justify-content:space-between;gap:16px}.request-header h2{font-size:19px;margin:0 0 6px}.request-header p,.request-header span{font-size:13px;color:#64748b}.request-header span{background:#f1f5f9;padding:4px 8px;border-radius:99px;height:max-content}.banner-comparison{display:grid;grid-template-columns:minmax(0,1fr) 32px minmax(0,1fr);align-items:center;gap:12px;margin-top:18px}.banner-comparison figure{margin:0;min-width:0}.banner-comparison figcaption{margin-bottom:7px;font-size:13px;font-weight:650;color:#475569}.banner-comparison img{display:block;width:100%;height:180px;object-fit:contain;background:repeating-conic-gradient(#f1f5f9 0% 25%,#fff 0% 50%) 50%/20px 20px;border:1px solid #dbe2ea;border-radius:8px}.change-arrow{text-align:center;color:#64748b;font-size:24px}.image-result{display:grid;place-items:center;height:180px;margin:0;border:1px dashed #cbd5e1;border-radius:8px;background:#f8fafc;color:#64748b}.request-card details{margin:18px 0;color:#475569}.request-card dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:12px 0 0;padding:14px;background:#f8fafc;border-radius:8px;font-size:14px}.request-card dt{font-weight:600}.request-card dd{margin:0}.actions{display:flex;justify-content:flex-end;gap:10px}.actions .approve{background:#166534;color:white;border-color:#166534}.actions .reject{color:#b91c1c}.mentor-page button:disabled{opacity:.5;cursor:wait}.empty{padding:40px;text-align:center;color:#64748b;background:#f8fafc;border-radius:12px}.error{padding:12px;background:#fee2e2;color:#991b1b;border-radius:8px}@media(max-width:600px){.mentor-page header{display:block}.mentor-page nav{margin-top:18px}.banner-comparison{grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr);gap:6px}.banner-comparison img,.image-result{height:130px}}
.schedule-diff{margin:18px 0;padding:16px;border:1px solid #dbe2ea;border-radius:10px;background:#fbfdff}.schedule-diff-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.schedule-diff-heading h3{margin:0;font-size:15px}.schedule-diff-heading>span{color:#64748b;font-size:12px}.schedule-diff-groups{display:grid;gap:8px}.diff-group{padding:10px 12px;border-radius:8px}.diff-group strong{display:block;margin-bottom:4px;font-size:13px}.diff-group ul{display:grid;gap:4px;margin:0;padding-left:20px;font-size:14px}.diff-added{border:1px solid #a7f3d0;background:#ecfdf5;color:#065f46}.diff-removed{border:1px solid #fecaca;background:#fef2f2;color:#991b1b}.diff-updated{border:1px solid #fde68a;background:#fffbeb;color:#92400e}.diff-proposed{border:1px solid #bfdbfe;background:#eff6ff;color:#1e40af}.diff-baseline-note,.diff-unchanged{margin:8px 0 0;color:#64748b;font-size:13px}.diff-unchanged{text-align:right}
@media(max-width:600px){.schedule-diff{padding:12px}.schedule-diff-heading{align-items:flex-start;flex-direction:column;gap:4px}}
</style>
