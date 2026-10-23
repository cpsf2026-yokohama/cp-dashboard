<script setup lang="ts">
type ChangeRequest = { id: string; kind: string; summary: string; payload: Record<string, unknown>; requesterEmail: string; createdAt: string; isMine: boolean }
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
      if (key in labels) rows.push([labels[key], `${value.beforeKnown === false ? '変更前不明' : valueText(value.before)} → ${valueText(value.after)}`])
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
    <header><div><p class="eyebrow">MENTOR REVIEW</p><h1>変更リクエスト</h1><p>{{ canReview ? '承認されるまで、申請内容はサイトや再生端末に反映されません。' : '申請待ちの内容を確認できます。自分の申請は取り消せますが、承認・却下はできません。' }}</p></div><nav><a href="/admin">管理画面</a><button @click="void loadRequests()">再読み込み</button></nav></header>
    <p v-if="error" class="error" role="alert">{{ error }} <a v-if="error.includes('認証')" :href="appPath('admin')">管理画面で認証</a></p>
    <p v-if="loading" class="empty" role="status">申請を読み込み中...</p>
    <p v-else-if="!error && requests.length === 0" class="empty">申請待ちはありません。</p>
    <section v-else-if="!error && requests.length > 0" class="request-list" aria-label="承認待ち">
      <article v-for="item in requests" :key="item.id" class="request-card">
        <div class="request-header"><div><h2>{{ item.summary }}</h2><p>{{ item.requesterEmail }} · {{ formatDate(item.createdAt) }}</p></div><span>{{ kindLabel(item.kind) }}</span></div>
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
</style>
