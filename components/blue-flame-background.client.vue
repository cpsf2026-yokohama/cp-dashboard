<script setup lang="ts">
import { createBlueFlameRenderer } from '~/utils/visuals/blue-flame-shader';

const canvas = ref<HTMLCanvasElement | null>(null);
const props = withDefaults(defineProps<{ active?: boolean; embedded?: boolean }>(), { active: true });

// Nuxt's client-only wrapper can mount before its canvas template ref is ready.
watch(canvas, (element, _previous, onCleanup) => {
  if (!element) return;
  let renderer: ReturnType<typeof createBlueFlameRenderer>;
  try {
    renderer = createBlueFlameRenderer(element);
  } catch {
    return; // The CSS background stays visible without WebGL.
  }
  let lost = false;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let visible = false;
  let width = 0;
  let height = 0;
  let lastFrame = 0;
  let elapsed = 4;
  let lastTick = 0;

  const draw = () => {
    if (!lost && width && height) renderer.draw(elapsed);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
    lastTick = 0;
  };
  const tick = (now: number) => {
    if (lastTick) elapsed += Math.min((now - lastTick) / 1000, 0.1) * .65;
    lastTick = now;
    const interval = 1000 / 30;
    if (!lastFrame || now - lastFrame >= interval - .5) {
      lastFrame = lastFrame ? now - Math.max(0, now - lastFrame - interval) % interval : now;
      draw();
    }
    frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    stop();
    if (!props.active || !visible || document.hidden || lost) return;
    draw();
    if (!motion.matches) frame = requestAnimationFrame(tick);
  };
  const resize = () => {
    const rect = element.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    if (!width || !height) return;
    if (!lost) renderer.resize(width, height);
    draw();
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    element.style.visibility = 'hidden';
    stop();
  };
  const contextRestored = () => {
    lost = false;
    element.style.visibility = '';
    resize();
    sync();
  };
  element.addEventListener('webglcontextlost', contextLost);
  element.addEventListener('webglcontextrestored', contextRestored);
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
    element.removeEventListener('webglcontextlost', contextLost);
    element.removeEventListener('webglcontextrestored', contextRestored);
    renderer.dispose();
  });
}, { flush: 'post' });
</script>

<template>
  <div class="blue-flame-background" :class="{ embedded }" aria-hidden="true">
    <canvas ref="canvas" />
  </div>
</template>

<style scoped>
.blue-flame-background {
  position: fixed;
  inset: auto 0 0;
  height: min(30dvh, 320px);
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background: radial-gradient(ellipse at 50% 120%, #12374980, transparent 65%);
}

.blue-flame-background.embedded {
  position: absolute;
  height: 30%;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
  mask-image: linear-gradient(to top, #000 78%, transparent);
}

@media (max-width: 640px) {
  .blue-flame-background { height: 23dvh; }
}
</style>
