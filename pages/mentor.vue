<script setup lang="ts">
type ChangeRequest = { id: string; kind: string; summary: string; payload: Record<string, unknown>; requesterEmail: string; createdAt: string }
const api = useVideoApiBase()
const requests = ref<ChangeRequest[]>([])
const loading = ref(true)
const error = ref('')
const busyId = ref('')

async function loadRequests() {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch(`${api}/change-requests`)
    if (!response.ok) throw new Error(response.status === 403 ? 'メンター権限が必要です。' : `HTTP ${response.status}`)
    requests.value = (await response.json() as { requests: ChangeRequest[] }).requests
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '申請を読み込めませんでした。'
  } finally { loading.value = false }
}

async function decide(item: ChangeRequest, action: 'approve' | 'reject') {
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

function formatDate(value: string) { return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)) }
function kindLabel(kind: string) {
  return ({ settings: '共有設定', 'schedule.create': '予定の追加', 'schedule.delete': '予定の削除', 'video.delete': '動画の削除', 'video.upload': '動画の追加', 'banner.upload': 'バナー画像の変更', 'banner.delete': 'バナーの削除' } as Record<string, string>)[kind] ?? '変更リクエスト'
}
function details(item: ChangeRequest) {
  const payload = item.payload
  const rows: Array<[string, string]> = []
  if (typeof payload.videoTitle === 'string' || typeof payload.title === 'string') rows.push(['動画', String(payload.videoTitle ?? payload.title)])
  if (typeof payload.startsAt === 'string') rows.push(['予定時刻', formatDate(payload.startsAt)])
  if (typeof payload.kind === 'string') rows.push(['バナー', payload.kind === 'horizontal' ? '横バナー' : '縦バナー'])
  if (payload.settings && typeof payload.settings === 'object') {
    const labels: Record<string, string> = { isBannerVisible: '横バナー', isVerticalBanner: '縦バナー', isChimeEnabled: 'チャイム', isPreChimeEnabled: '予鈴', countdownDates: 'カウントダウン予定', yearlyCountdownDates: '毎年の予定', userChimeTimes: 'チャイム時刻' }
    for (const [key, value] of Object.entries(payload.settings as Record<string, unknown>)) if (key in labels) rows.push([labels[key], typeof value === 'boolean' ? (value ? '有効' : '無効') : Array.isArray(value) ? `${value.length}件` : '更新'])
  }
  if (payload.apply && typeof payload.apply === 'object') {
    const labels: Record<string, string> = { isBannerVisible: '横バナー', isVerticalBanner: '縦バナー', isChimeEnabled: 'チャイム', isPreChimeEnabled: '予鈴', countdownDates: 'カウントダウン予定', yearlyCountdownDates: '毎年の予定', userChimeTimes: 'チャイム時刻' }
    for (const [key, value] of Object.entries(payload.apply as Record<string, unknown>)) if (key in labels) rows.push([`${labels[key]}のサイト反映`, value ? '有効' : '無効'])
  }
  return rows
}
onMounted(() => void loadRequests())
</script>

<template>
  <main class="mentor-page">
    <header><div><p class="eyebrow">MENTOR REVIEW</p><h1>変更リクエスト</h1><p>承認されるまで、申請内容はサイトや再生端末に反映されません。</p></div><nav><a href="/admin">管理画面</a><button @click="void loadRequests()">再読み込み</button></nav></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="empty" role="status">申請を読み込み中...</p>
    <p v-else-if="requests.length === 0" class="empty">承認待ちの申請はありません。</p>
    <section v-else class="request-list" aria-label="承認待ち">
      <article v-for="item in requests" :key="item.id" class="request-card">
        <div class="request-header"><div><h2>{{ item.summary }}</h2><p>{{ item.requesterEmail }} · {{ formatDate(item.createdAt) }}</p></div><span>{{ kindLabel(item.kind) }}</span></div>
        <details v-if="details(item).length"><summary>申請内容</summary><dl><template v-for="([label, value], index) in details(item)" :key="`${label}-${index}`"><dt>{{ label }}</dt><dd>{{ value }}</dd></template></dl></details>
        <div class="actions"><button class="reject" :disabled="busyId !== ''" @click="void decide(item, 'reject')">却下</button><button class="approve" :disabled="busyId !== ''" @click="void decide(item, 'approve')">{{ busyId === item.id ? '処理中...' : '承認して反映' }}</button></div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.mentor-page{max-width:960px;margin:0 auto;padding:40px 24px 80px;color:#182230;font-family:system-ui,sans-serif}.mentor-page header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:32px}.eyebrow{font-size:12px;letter-spacing:.12em;color:#64748b;font-weight:700}.mentor-page h1{margin:4px 0 8px;font-size:32px}.mentor-page header p{color:#64748b}.mentor-page nav{display:flex;gap:12px;align-items:center}.mentor-page button,.mentor-page a{border:1px solid #cbd5e1;border-radius:8px;padding:9px 14px;background:#fff;color:inherit;text-decoration:none;font:inherit;cursor:pointer}.request-list{display:grid;gap:16px}.request-card{border:1px solid #dbe2ea;border-radius:14px;padding:20px;background:#fff;box-shadow:0 3px 10px #0f172a0a}.request-header{display:flex;justify-content:space-between;gap:16px}.request-header h2{font-size:19px;margin:0 0 6px}.request-header p,.request-header span{font-size:13px;color:#64748b}.request-header span{background:#f1f5f9;padding:4px 8px;border-radius:99px;height:max-content}.request-card details{margin:18px 0;color:#475569}.request-card dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:12px 0 0;padding:14px;background:#f8fafc;border-radius:8px;font-size:14px}.request-card dt{font-weight:600}.request-card dd{margin:0}.actions{display:flex;justify-content:flex-end;gap:10px}.actions .approve{background:#166534;color:white;border-color:#166534}.actions .reject{color:#b91c1c}.mentor-page button:disabled{opacity:.5;cursor:wait}.empty{padding:40px;text-align:center;color:#64748b;background:#f8fafc;border-radius:12px}.error{padding:12px;background:#fee2e2;color:#991b1b;border-radius:8px}@media(max-width:600px){.mentor-page header{display:block}.mentor-page nav{margin-top:18px}}
</style>
