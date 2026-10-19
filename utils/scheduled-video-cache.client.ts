const cacheName = 'cp-dashboard-scheduled-video-v1'
const maxCachedVideos = 1
const maxVideoBytes = 100 * 1024 * 1024

/** Download the complete scheduled video into browser storage before playback. */
export async function loadScheduledVideoBlob(url: string): Promise<Blob> {
  const request = new Request(url, { method: 'GET' })
  let videoCache: Cache | null = null
  try {
    if ('caches' in window) videoCache = await caches.open(cacheName)
  } catch (error) {
    console.warn('Browser video storage is unavailable; using a temporary download:', error)
  }

  const storedResponse = await videoCache?.match(request).catch(() => undefined)
  if (storedResponse) return storedResponse.blob()

  const response = await fetch(request, { cache: 'no-store' })
  if (!response.ok || response.status !== 200) {
    throw new Error(`Scheduled video download failed (${response.status})`)
  }

  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxVideoBytes) {
    throw new Error('Scheduled video exceeds the local cache limit')
  }

  if (!videoCache) return response.blob()

  try {
    const existingKeys = await videoCache.keys()
    const staleKeys = existingKeys
      .filter(key => key.url !== request.url)
      .slice(0, Math.max(0, existingKeys.length - (maxCachedVideos - 1)))
    await Promise.all(staleKeys.map(key => videoCache.delete(key)))
    await videoCache.put(request, response.clone())
    const cached = await videoCache.match(request)
    if (cached) return cached.blob()
  } catch (error) {
    console.warn('Could not persist scheduled video in browser storage:', error)
  }

  return response.blob()
}
