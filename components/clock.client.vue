<script setup lang="ts">
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import 'dayjs/locale/ja';

dayjs.extend(duration);
dayjs.locale("ja");

// 横幅の画面サイズ
const wScreen = widthScreenSize();

// 現在時刻
const timeState = time();
// シンプルな時刻表示
const clockEffectState = clockEffect();
// タイマーの残り時間
const timerState = timer();
const rollingDown = ref(timerState.value !== null);

watch(timerState, (remainingTime) => {
  if (remainingTime !== null) {
    rollingDown.value = true;
  }
});

const mainClock = computed(() => {
  const currentTime = timerState.value ?? [
    dayjs(timeState.value).hour(),
    dayjs(timeState.value).minute(),
    dayjs(timeState.value).second(),
  ];

  return currentTime.map((value) => value.toString().padStart(2, "0"));
});
const mainClockText = computed(() => mainClock.value.join(":"));

// 設定されているフォントサイズオフセット
const fontSizeOffset = fontSize();
// 時計の文字サイズ
const mainClockSize = ref(`${13 * fontSizeOffset.value}vw`);
// 日付のフォントサイズ
const subClockSize = ref(`${4 * fontSizeOffset.value}vw`);

// 情報スクロールの有効化
const isInfoScrollEnabledSt = isInfoScrollEnabled();
// 情報スクロールに表示する文字列
const infoScrollTextSt = infoScrollText();

// 天気
const weatherState = weather();

// バナー宣伝画像の表示の切り替え
const bannerVisible = isBannerVisible();
// バナーのソース
const banner = bannerSource();

watch(fontSizeOffset, (newVal) => {
  if (wScreen.value >= 1280) {
    mainClockSize.value = `${13 * newVal}vw`;
    subClockSize.value = `${5 * newVal}vw`;
  } else {
    mainClockSize.value = `${19 * newVal}vw`;
    subClockSize.value = `${9 * newVal}vw`;
  }
});

watch(wScreen, () => {
  const o = fontSizeOffset.value;
  if (wScreen.value >= 1280) {
    mainClockSize.value = `${13 * o}vw`;
    subClockSize.value = `${5 * o}vw`;
  } else {
    mainClockSize.value = `${19 * o}vw`;
    subClockSize.value = `${9 * o}vw`;
  }
});
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3">
    <!-- メイン表示 -->
    <h1
      v-if="clockEffectState == 'シンプル' || clockEffectState == '自動 (端末に最適化)' && ($device.isSafari || $device.isFirefox)"
      class="main-clock font-bold leading-none tabular-nums">
      {{ mainClockText }}
    </h1>
    <h1 v-else class="main-clock font-bold leading-none tabular-nums rolling-clock" :aria-label="mainClockText">
      <template v-for="(value, index) in mainClock" :key="index">
        <span v-if="index > 0" aria-hidden="true">:</span>
        <span class="rolling-digit" aria-hidden="true">
          <Transition :name="rollingDown ? 'roll-down' : 'roll-up'">
            <span :key="value">{{ value }}</span>
          </Transition>
        </span>
      </template>
    </h1>

    <!-- サブ表示 -->
    <h2>
      <div v-if="timerState != null" class="flex flex-row items-center">
        <span class="sub-clock mr-3"> {{ dayjs(timeState).format('MM/DD (ddd)') }} </span>
        <div class="sub-clock font-mono">
          <span> {{ dayjs(timeState).format("HH:mm:ss") }}</span>
        </div>
      </div>

      <div v-else-if="isInfoScrollEnabledSt" class="flex flex-row items-center">
        <span class="shrink sub-clock mr-3 whitespace-nowrap"> {{ dayjs(timeState).format('MM/DD(ddd)')
          }} </span>
        <div class="scrolling-text sub-clock font-bold text-primary border-2">
          <span
            :style="{ 'animation-duration': `${infoScrollTextSt.length <= 10 ? 4 : infoScrollTextSt.length * 0.4}s` }">
            {{ infoScrollTextSt }}</span>
        </div>
      </div>
      <span v-else class="sub-clock max-w-full">
        {{ dayjs(timeState).format(wScreen >= 1280 ? 'YYYY年MM月DD日(ddd)' : 'MM/DD (ddd)') }}
        <Icon :name="weatherState != null ? weatherState : 'system-uicons:cloud-disconnect'"
          class="stat-value m-auto leading-none" :size="subClockSize" />*
      </span>
    </h2>

    <!-- 上部の宣伝画像エリア -->
    <div v-if="bannerVisible && widthScreenSize().value >= 1280" class="fixed top-0 m-3 z-10">
      <div v-if="banner != null" class="bg-neutral flex flex-row items-center rounded-xl border-4 overflow-hidden">
        <span class="p-2 text-neutral-content text-3xl [writing-mode:vertical-rl]">宣伝</span>
        <img :src="banner!" class="h-[17vh]">
      </div>
    </div>
  </div>
</template>

<style scoped>
.main-clock {
  font-size: v-bind(mainClockSize);
}

.rolling-clock {
  display: inline-flex;
  line-height: 1;
}

.rolling-digit {
  position: relative;
  display: inline-grid;
  width: 2ch;
  height: 1em;
  overflow: hidden;
  vertical-align: top;
}

.rolling-digit > span {
  grid-area: 1 / 1;
  display: inline-block;
  width: 2ch;
  text-align: center;
  transition: transform 1s cubic-bezier(1, 0, 0, 1);
}

.roll-up-enter-from {
  transform: translateY(100%);
}

.roll-up-leave-active,
.roll-down-leave-active {
  position: absolute;
}

.roll-up-leave-to {
  transform: translateY(-100%);
}

.roll-down-enter-from {
  transform: translateY(-100%);
}

.roll-down-leave-to {
  transform: translateY(100%);
}

.sub-clock {
  font-size: v-bind(subClockSize);
}

.scrolling-text {
  white-space: nowrap;
  overflow: hidden;

  width: 35vw;
}

.scrolling-text span {
  display: inline-block;
  padding-left: 100%;
  animation: scroll 8s linear infinite;
}

@keyframes scroll {
  0% {
    transform: translateX(0);
  }

  100% {
    transform: translateX(-100%);
  }
}
</style>
