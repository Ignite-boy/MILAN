# MILAN video delivery and playback

## Current playback path

1. The app renders a video card and observes it before it approaches the viewport.
2. The authenticated `GET /api/records/:id/media/playback-url` route checks current record visibility and returns a time-limited Supabase Storage signed URL. The video element then requests bytes directly from Storage instead of proxying the full video through the app API.
3. The server reuses signed URLs in a bounded, process-local cache keyed by reader DID, bucket, and exact object path. Authorization still runs before each cache lookup. The cache's default soft lifetime is 50 minutes, below the 60-minute signed URL lifetime.
4. New uploads use a content-addressed object path (SHA-256 prefix) and persist the exact bucket/path with the record. Updating or repairing a video gets a new object path rather than reusing an old CDN cache key.
5. The client keeps signed URLs in page memory only, keyed by session scope, record ID, and media version. A URL failure gets one fresh signed-URL attempt with playback position restored after metadata loads, then the existing repair/authenticated-proxy fallback remains available.

## Bounded preloading policy

- Only the most-visible video and next video in feed order are assigned `preload=auto` on ordinary connections.
- Other feed videos retain `preload=metadata`.
- If `navigator.connection.saveData` is true or effective connection type is 2G/slow-2G, preloading returns to metadata-only.
- Direct URL lookup starts before a video reaches the viewport (the existing 700px IntersectionObserver margin) and preconnects to the signed storage URL's origin once per page.
- Browser support for preload hints varies; this is a bandwidth budget, not a guarantee that a browser will fully buffer a video.

## Security and operational notes

- Do not make the media bucket public as a performance workaround. Private/shared content must still pass the record access check and use signed URLs.
- Signed URL cache entries are per-process, bounded to 500 entries, and are not shared between serverless instances. Cache wins can therefore vary by instance.
- Existing upload cache-control remains 3600 seconds. Content-addressed paths avoid stale objects after a replacement; the implementation does not set long-lived cache headers for private videos.
- Supabase Smart CDN behavior and cache-hit rate depend on the deployed plan, storage configuration, region, and URL. Repository code alone cannot certify a CDN HIT or measure live buffering.
- This change does not create HLS playlists or 360p/480p/720p/1080p renditions. Adaptive-bitrate HLS remains a follow-up if measured results warrant it.

## Verification

Run:

```bash
npm run test:video
npm run build
```

For a real signed URL, use the browser Network panel on a test account and inspect the media request's status, `Content-Range`, and `cf-cache-status` when present. Never paste a signed URL or its `token` query into tickets or logs; it is a temporary bearer credential. Compare first-play time and rebuffering across the same test clips and connection conditions before and after deployment.
