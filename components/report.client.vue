<script setup lang="ts">
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import 'dayjs/locale/ja';

dayjs.extend(duration);
dayjs.locale("ja");

// 現在時刻
const timeState = time();
// 画面サイズ
const wSize = widthScreenSize();

// カウントダウン名
const countdownName = useState('countdownName', () => 'レポート日数');

// イベントまでの残り時間 (ms)
const countdownLimit = useState('countdownLimit', () => 0);
// イベントまでの残り日数
const countdownLimitDays = useState('countdownLimitDays', () => 0);
// 赤くするかどうか
const needCountdownAlert = useState('needCountdownAlert', () => false);

// 消費した日数の割合
const countdownRatio = useState('countdownRatio', () => 0);
const isEventDay = computed(() => countdownLimit.value > 0 && countdownLimitDays.value < 1);

/// イベントカウントダウンのステータスを更新
function refleshReportStatus(djs: dayjs.Dayjs = dayjs()) {
  // 一回限りのイベントと年間定期のイベントを取得
  const onceDates = countdownDates().value;
  const yearlyDates = yearlyCountdownDates().value.map<CountdownData>((d) => {
    return {
      date: `${djs.year()}-${d.date}`,
      label: d.label,
      color: d.color,
      type: "yearly",
    };
  });
  // 一回限りのイベントと年間定期のイベントを結合
  const allDates = <CountdownData[]>[...onceDates, ...yearlyDates].sort((a, b) => {
    return a.date < b.date ? -1 : 1;
  });

  // 全イベントの差分時間を取得しながら、一番近い今後のイベントと最後に行われたイベントを見つける
  let nearEvent = null;
  let lastEvent = null;
  let minFutureDiffTime = Infinity;
  let maxPastDiffTime = -Infinity;

  for (const d of allDates) {
    // 現在時刻との差分を取得
    const eventDate = dayjs(d.date).hour(23).minute(59).second(59);
    const diffTime = eventDate.diff(djs);

    if (diffTime >= 0) {
      // 差分時刻の記録が小さい場合、一番近い今後のイベントを更新
      if (diffTime < minFutureDiffTime) {
        minFutureDiffTime = diffTime;
        nearEvent = d;
      }
    } else {
      // 差分時刻の記録が大きい場合(差の値はマイナスになるため逆)、最後に行われたイベントを更新
      if (diffTime > maxPastDiffTime) {
        maxPastDiffTime = diffTime;
        lastEvent = d;
      }
    }
  }
  if (nearEvent == null) return;

  const nearEventDate = dayjs(nearEvent.date).hour(23).minute(59).second(59);
  // 前回のイベントがない場合は1月1日とする
  const lastEventDate = dayjs(lastEvent ? lastEvent.date : `${djs.year()}-01-01`).hour(23).minute(59).second(59);

  // カウントダウンのステータスを更新
  countdownName.value = nearEvent.label + "まで";
  countdownLimit.value = calcLimit(nearEventDate, djs);
  countdownLimitDays.value = calcLimitDays(nearEventDate, djs);
  needCountdownAlert.value = needAlert(nearEventDate, djs);
  countdownRatio.value = calcRatio(nearEventDate, djs, lastEventDate);
}

// イベント期限の割合を更新
onMounted(() => {
  refleshReportStatus(dayjs(timeState.value));
  setInterval(() => {
    refleshReportStatus(dayjs(timeState.value));
  }, 1000);
});

// 縦型バナー宣伝画像の表示の切り替え
const verticalBannerVisible = isVerticalBanner();
// 縦バナーのソース
const verticalBanner = verticalBannerSource();
</script>

<template>
  <div v-if="!verticalBannerVisible" class="m-2 min-w-full flex flex-col items-end">
    <div class="flex flex-col items-center">
      <h2 class="text-[2vw] max-2xl:text-4xl mb-3 font-medium">{{ countdownName }}</h2>
      <div
        :class="['radial-progress', 'text-[4vw]', 'max-2xl:text-6xl', 'font-bold', needCountdownAlert && !isEventDay ? 'text-red-600' : 'text-primary', isEventDay ? 'event-day-progress' : '']"
        :style="{ '--value': countdownRatio, '--size': wSize >= 1536 ? '15vw' : '220px', '--thickness': wSize >= 1536 ? '2vw' : '30px' }">
        <span>{{ Math.floor(countdownLimitDays) }}日</span>
      </div>
      <div v-if="isEventDay" class="event-day-celebration" role="status" aria-live="polite">
        <span aria-hidden="true">✦</span>
        <strong>本日開催！</strong>
        <span aria-hidden="true">✦</span>
      </div>
      <div v-if="needCountdownAlert && dayjs.duration(countdownLimit).asHours() >= 24" class="mt-3 flex flex-col items-center">
        <span class="text-[1.6vw]">残り時間</span>
        <div class="countdown text-[2.5vw] font-bold text-red-600">
          <span :style="{ '--value': Math.floor(dayjs.duration(countdownLimit).asHours()) }"></span>:
          <span :style="{ '--value': dayjs.duration(countdownLimit).minutes() }"></span>:
          <span :style="{ '--value': dayjs.duration(countdownLimit).seconds() }"></span>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="m-2">
    <img v-if="verticalBanner != null" class="max-h-[45vh] border" :src="verticalBanner" />
  </div>
</template>

<style scoped>
.event-day-progress {
  animation: event-day-glow 1.8s ease-in-out infinite;
}

.event-day-celebration {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6em;
  color: #d97706;
  font-size: clamp(1rem, 1.5vw, 1.75rem);
  animation: event-day-pop 700ms cubic-bezier(0.2, 1.4, 0.4, 1) both;
}

.event-day-celebration span {
  animation: event-day-sparkle 1.4s ease-in-out infinite alternate;
}

.event-day-celebration span:last-child {
  animation-delay: 350ms;
}

@keyframes event-day-glow {
  50% { filter: drop-shadow(0 0 16px rgb(245 158 11 / 55%)); }
}

@keyframes event-day-pop {
  from { opacity: 0; transform: translateY(8px) scale(0.9); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes event-day-sparkle {
  from { opacity: 0.5; transform: scale(0.75) rotate(-20deg); }
  to { opacity: 1; transform: scale(1.2) rotate(20deg); }
}

@media (prefers-reduced-motion: reduce) {
  .event-day-progress,
  .event-day-celebration,
  .event-day-celebration span {
    animation: none;
  }
}
</style>
