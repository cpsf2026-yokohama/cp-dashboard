/**
 * Return the video API base URL configured for this build.
 * Local Nuxt development uses the local Worker; deployed builds use
 * NUXT_PUBLIC_VIDEO_API_BASE or same-origin /api by default.
 */
export function useVideoApiBase() {
  const config = useRuntimeConfig()
  const base = String(config.public.videoApiBase || '/api').trim()

  return base.replace(/\/+$/, '')
}
