<script setup lang="ts">
import dayjs from 'dayjs'
import 'dayjs/locale/ja'
import { calcLimitDays, calcRatio } from '~/utils/calc-report'
import type { SharedSettings } from '~/composables/useSharedSettings'

dayjs.locale('ja')

const props = defineProps<{
  settings: SharedSettings
  horizontalBannerUrl: string | null
  verticalBannerUrl: string | null
  pendingHorizontalBannerUrl?: string | null
  pendingVerticalBannerUrl?: string | null
}>()

const now = ref(dayjs())
let clockInterval: number | undefined

onMounted(() => {
  clockInterval = window.setInterval(() => {
    now.value = dayjs()
  }, 1000)
})

onBeforeUnmount(() => {
  if (clockInterval !== undefined) window.clearInterval(clockInterval)
})

const nextEvent = computed(() => {
  const events = [
    ...props.settings.countdownDates.map((event) => ({
      eventDate: dayjs(event.date).endOf('day'),
      label: event.label,
    })),
    ...props.settings.yearlyCountdownDates.map((event) => ({
      eventDate: dayjs(`${now.value.year()}-${event.date}`).endOf('day'),
      label: event.label,
    })),
  ]

  return events
    .filter(event => event.eventDate.isValid() && !event.eventDate.isBefore(now.value))
    .sort((a, b) => a.eventDate.valueOf() - b.eventDate.valueOf())[0] ?? null
})

const countdownDays = computed(() => nextEvent.value
  ? Math.max(0, Math.floor(calcLimitDays(nextEvent.value.eventDate, now.value)))
  : null)
const countdownProgress = computed(() => nextEvent.value
  ? Math.min(100, Math.max(0, calcRatio(nextEvent.value.eventDate, now.value)))
  : 0)
const countdownIsToday = computed(() => nextEvent.value !== null
  && countdownDays.value !== null
  && calcLimitDays(nextEvent.value.eventDate, now.value) < 1)
const countdownIsUrgent = computed(() => nextEvent.value !== null
  && calcLimitDays(nextEvent.value.eventDate, now.value) <= 4)
const countdownRemainingTime = computed(() => {
  const remainingDays = nextEvent.value ? calcLimitDays(nextEvent.value.eventDate, now.value) : null
  if (!nextEvent.value || remainingDays === null || remainingDays > 4 || remainingDays < 1) return null
  const seconds = Math.floor(Math.max(0, nextEvent.value.eventDate.diff(now.value)) / 1000)
  return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds % 3600 / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
})

const activeHorizontalBanner = computed(() => props.pendingHorizontalBannerUrl || props.horizontalBannerUrl)
const activeVerticalBanner = computed(() => props.pendingVerticalBannerUrl || props.verticalBannerUrl)
</script>

<template>
  <section class="dashboard-preview" aria-label="共有設定の画面プレビュー">
    <div class="preview-caption">
      <span>編集中の設定を反映した横長画面（1280px以上）の表示イメージ</span>
      <span class="preview-silent">音声なし</span>
    </div>

    <div class="preview-screen">
      <div v-if="settings.isBannerVisible && activeHorizontalBanner" class="preview-horizontal-banner">
        <span>宣伝</span>
        <img :src="activeHorizontalBanner" alt="横型バナーのプレビュー">
      </div>

      <aside class="preview-status" aria-label="センサー表示のサンプル">
        <p>室温</p>
        <strong>—<small>°C</small></strong>
        <p>室内湿度</p>
        <strong>—<small>%</small></strong>
        <p>気圧</p>
        <strong>—<small>hPa</small></strong>
        <p>外気温*</p>
        <strong>—<small>°C</small></strong>
        <span>センサー値は端末で表示</span>
      </aside>

      <div class="preview-clock-area">
        <div class="preview-clock">{{ now.format('HH:mm:ss') }}</div>
        <div class="preview-date">{{ now.format('YYYY年MM月DD日(ddd)') }}</div>
        <div class="preview-weather">天気・センサー情報は端末の設定を表示</div>
      </div>

      <aside class="preview-side-area" aria-label="カウントダウンまたは縦型バナー">
        <div v-if="settings.isVerticalBanner" class="preview-vertical-banner">
          <img v-if="activeVerticalBanner" :src="activeVerticalBanner" alt="縦型バナーのプレビュー">
          <span v-else>縦型バナーは未登録です</span>
        </div>
        <div v-else class="preview-countdown">
          <p>{{ nextEvent?.label ? `${nextEvent.label}まで` : 'カウントダウン予定なし' }}</p>
          <div
            class="preview-countdown-ring"
            :class="{ urgent: countdownIsUrgent, today: countdownIsToday }"
            :style="{ '--progress': `${countdownProgress}%` }"
          >
            <strong>{{ countdownDays ?? '—' }}<small v-if="countdownDays !== null">日</small></strong>
          </div>
          <span v-if="countdownIsToday" class="preview-today">本日開催！</span>
          <span v-else-if="nextEvent" class="preview-countdown-label">次の予定まで</span>
          <span v-if="countdownRemainingTime" class="preview-countdown-time">残り時間 {{ countdownRemainingTime }}</span>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.dashboard-preview {
  margin-top: 14px;
  overflow: hidden;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #f7f8fa;
}

.preview-caption {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  color: #4b5563;
  font-size: 12px;
}

.preview-silent {
  flex-shrink: 0;
  color: #166534;
  font-weight: 600;
}

.preview-screen {
  position: relative;
  container-type: size;
  display: grid;
  grid-template-columns: 20% minmax(0, 1fr) 15%;
  align-items: center;
  gap: 1%;
  aspect-ratio: 16 / 9;
  min-height: 260px;
  max-height: 520px;
  padding: 1.2%;
  overflow: hidden;
  background: #f8fafc;
  color: #172033;
}

.preview-status,
.preview-side-area {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  text-align: center;
}

.preview-status {
  align-self: start;
  transform: translateY(6cqh);
  justify-content: center;
  min-height: 55%;
  border-right: 1px solid #cbd5e1;
  padding-right: 6%;
}

.preview-side-area {
  align-self: start;
  justify-content: flex-start;
  height: 100%;
  padding-top: 1.2%;
}

.preview-status p {
  margin: 8px 0 0;
  color: #64748b;
  font-size: clamp(10px, 1vw, 15px);
}

.preview-status strong {
  font-size: clamp(22px, 3vw, 44px);
  line-height: 1;
}

.preview-status small {
  font-size: 0.45em;
}

.preview-status span {
  margin-top: 10px;
  color: #64748b;
  font-size: clamp(8px, 0.75vw, 11px);
}

.preview-clock-area {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(6px, 1cqw, 12px);
  text-align: center;
}

.preview-clock {
  font-size: clamp(34px, 13cqw, 140px);
  font-weight: 700;
  letter-spacing: -0.055em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.preview-date {
  font-size: clamp(12px, 5cqw, 42px);
  white-space: nowrap;
}

.preview-weather {
  color: #64748b;
  font-size: clamp(8px, 1.4cqw, 14px);
}

.preview-horizontal-banner {
  position: absolute;
  z-index: 1;
  top: 1.2%;
  left: 52.5%;
  transform: translateX(-50%);
  display: flex;
  width: max-content;
  max-width: 65%;
  height: 17%;
  align-items: center;
  overflow: hidden;
  border: 3px solid #475569;
  border-radius: 12px;
  background: #1f2937;
}

.preview-horizontal-banner span {
  flex: 0 0 auto;
  padding: 0.5cqw;
  color: white;
  font-size: clamp(8px, 1.6cqw, 18px);
  writing-mode: vertical-rl;
}

.preview-horizontal-banner img {
  display: block;
  width: auto;
  max-width: calc(100% - 2.5cqw);
  height: 100%;
  max-height: 100%;
  object-fit: contain;
}

.preview-countdown {
  display: flex;
  width: max-content;
  max-width: 100%;
  align-self: flex-end;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.preview-countdown > p {
  margin: 0;
  color: #334155;
  font-size: clamp(10px, 1.1cqw, 18px);
  font-weight: 600;
  white-space: nowrap;
}

.preview-countdown-ring {
  position: relative;
  display: grid;
  width: min(100%, 150px);
  aspect-ratio: 1;
  place-items: center;
  border-radius: 50%;
  color: #1d4ed8;
}

.preview-countdown-ring::before {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(#2563eb var(--progress), #dbeafe var(--progress));
  content: '';
  mask: radial-gradient(farthest-side, transparent calc(100% - 10px), #000 calc(100% - 9px));
}

.preview-countdown-ring strong {
  position: relative;
  font-size: clamp(17px, 2.5vw, 34px);
  font-weight: 700;
}

.preview-countdown-ring small {
  margin-left: 2px;
  font-size: 0.55em;
}

.preview-countdown-ring.urgent {
  color: #dc2626;
}

.preview-countdown-ring.urgent::before {
  background: conic-gradient(#dc2626 var(--progress), #fee2e2 var(--progress));
}

.preview-countdown-ring.today {
  color: #d97706;
}

.preview-countdown-ring.today::before {
  background: conic-gradient(#f59e0b var(--progress), #fef3c7 var(--progress));
}

.preview-countdown-label,
.preview-today {
  color: #64748b;
  font-size: clamp(8px, 0.9vw, 12px);
}

.preview-today {
  color: #b45309;
  font-weight: 700;
}

.preview-countdown-time {
  color: #dc2626;
  font-size: clamp(9px, 1.1cqw, 15px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.preview-vertical-banner {
  display: grid;
  width: 100%;
  height: 45%;
  place-items: center;
  color: #64748b;
  font-size: clamp(9px, 1vw, 14px);
  text-align: center;
}

.preview-vertical-banner img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

@media (max-width: 600px) {
  .preview-screen {
    min-height: 220px;
    grid-template-columns: 16% minmax(0, 1fr) 22%;
    gap: 1%;
  }

  .preview-status {
    padding-right: 2%;
  }

  .preview-weather {
    display: none;
  }
}
</style>
