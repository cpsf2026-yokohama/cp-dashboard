<script setup lang="ts">
import { drawBlueFlame } from '~/utils/visuals/blue-flame';

const canvas = ref<HTMLCanvasElement | null>(null);
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });

// Nuxt's client-only wrapper can mount before its canvas template ref is ready.
watch(canvas, (element, _previous, onCleanup) => {
  const ctx = element?.getContext('2d');
  if (!element || !ctx) return;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let visible = false;
  let width = 0;
  let height = 0;
  let lastFrame = 0;
  let elapsed = 0;

  const draw = () => drawBlueFlame(ctx, width, height, elapsed);
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
  };
  const tick = (now: number) => {
    if (now - lastFrame >= 1000 / 30) {
      // Resume without a jump after a hidden tab or a scheduled video.
      if (lastFrame) elapsed += Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;
      draw();
    }
    frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    stop();
    if (!props.active || !visible || document.hidden) return;
    draw();
    if (!motion.matches) frame = requestAnimationFrame(tick);
  };
  const resize = () => {
    const rect = element.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    if (!width || !height) return;
    const scale = Math.min(window.devicePixelRatio || 1, 1.5, 1920 / width);
    element.width = Math.round(width * scale);
    element.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    draw();
  };
  const observer = new ResizeObserver(resize);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    sync();
  });
  observer.observe(element);
  intersection.observe(element);
  document.addEventListener('visibilitychange', sync);
  motion.addEventListener('change', sync);
  const stopActiveWatch = watch(() => props.active, sync);
  resize();

  onCleanup(() => {
    stop();
    stopActiveWatch();
    observer.disconnect();
    intersection.disconnect();
    document.removeEventListener('visibilitychange', sync);
    motion.removeEventListener('change', sync);
  });
}, { flush: 'post' });
</script>

<template>
  <div class="blue-flame-background" aria-hidden="true">
    <canvas ref="canvas" />
  </div>
</template>

<style scoped>
.blue-flame-background {
  position: fixed;
  inset: auto 0 0;
  height: 32dvh;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background: radial-gradient(ellipse at 50% 120%, #12374980, transparent 65%);
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
