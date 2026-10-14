# Campus Dashboard

[日本語](README.md) | English

A web application for campus displays that brings together a large clock, timer, weather, and event countdowns. This repository extends CoreNion's dashboard with event video uploads, scheduled playback, and user management.

[Display](https://cp-dashboard-13x.pages.dev/) · [Video administration](https://cp-dashboard-13x.pages.dev/admin/) · [Dashboard wiki](https://github.com/CoreNion/cp-dashboard/wiki)

![Dashboard example from 2024](public/ogp.png)

## Features

- Large digital clock, countdown timer, chimes, advance bells, and event countdowns.
- Weather, outdoor temperature, and pressure from the Japan Meteorological Agency. Connected sensors provide indoor temperature, humidity, pressure, and recording.
- Scrolling announcements, banner images, themes, fonts, custom audio, and screen effects.
- PWA support and layouts that adapt to the display width.
- Video library, playback scheduled by date and time, unused video deletion, and staff permissions.

The clock and timer run in the browser. Video features require an API and storage on Cloudflare.

| Page | Purpose |
| --- | --- |
| `/` | Dashboard and scheduled video playback |
| `/admin` | Video, schedule, and user administration |
| `/player` | Development page for playback and seeking checks; loading the video list requires authentication |

## Using the dashboard

Open the home page on the display device and click the screen once. This loads audio, attempts to keep the screen awake, and plays a short confirmation sound. Audio playback and wake lock behavior depend on the browser and device.

Use “+5分”, “+1分”, or “+10秒” to add time, then “スタート” to start the timer. “一時停止” pauses it and “clear” resets it. Settings let you change chime times and audio, the weather location, events, fonts, banners, and other display options.

Sensor features require compatible hardware and a browser supporting Web Serial. See the [sensor technical guide](https://github.com/CoreNion/cp-dashboard/wiki/測定センサーの技術的情報) and `arduino-sender/`.

## Operating the video system

### Sign in and permissions

Open [video administration](https://cp-dashboard-13x.pages.dev/admin/) and sign in with Google through Cloudflare Access. The linked campus deployment uses school `@nnn.ed.jp` accounts. Both Access permission and an application user record are required. Other deployments should use their own Access policies.

| Role | Administrative permissions |
| --- | --- |
| `producer` | Upload videos and delete unused videos they uploaded |
| `operator` | Add and cancel playback schedules |
| `admin` | All of the above, deletion of other users' unused videos, user registration, and role changes |

All roles can view the video and schedule lists. The “ユーザー管理” tab is for administrators. Registering someone there does not automatically add them to the Cloudflare Access allowlist.

### Upload a video

1. Open “動画ライブラリ” (Video library).
2. Enter a title that staff can recognize, for example `20261014_stage_opening_v1`. Use a clear source filename too.
3. Choose a file under “動画ファイル” and check its size and format. **The limit is 100 MiB per file.** The API rejects empty files and files whose MIME type does not start with `video/`.
4. Click “アップロード” (Upload) and wait for completion.
5. Confirm the video appears in the library. Check both picture and sound on the device that will display it.

Uploads are not transcoded. Supported formats and codecs depend on the display device's browser.

### Schedule playback

1. Open “スケジュール” (Schedule) and click “＋ 予定を追加” (Add schedule).
2. Select the video, date, and start time, then save with “予定を追加”.
3. Confirm the title and time in the list. Input is interpreted in the operator device's timezone; the list displays Japan time (`Asia/Tokyo`). Set operator devices to Japan time when operating in Japan.
4. Keep `/` open on each display device. When a schedule is detected, the video fills the dashboard viewport. The regular dashboard returns when playback ends. If autoplay is blocked, press “再生を開始する” (Start playback).

Each occurrence needs its own schedule. Recurring schedules, device-specific targeting, and device health monitoring are not implemented. Each display checks schedules roughly every two seconds and accepts schedules up to 60 seconds after their start time. A longer network interruption or sleep can cause a schedule to be missed; playback is not guaranteed to start simultaneously across devices.

### Remove schedules and videos

“キャンセル” deletes that schedule. Before deleting a video, remove every schedule referring to it, including past schedules; these are not removed automatically.

Filter the library to unused videos and delete those no longer needed. Deletion cannot be undone. If the interface reports that the stored file could not be deleted, an administrator should check for the remaining object in R2.

## Authentication and stored data

Administrative API routes validate the Cloudflare Access JWT signature, issuer, application audience, and expiration, then enforce the role recorded in D1. Pages Functions forwards Access authentication and video Range headers to the API Worker.

The API itself does not require authentication for `GET /api/schedule` or `GET /api/stream/videos/:id/stream` (also available through the compatibility route `/api/videos/:id/stream`). Someone who knows a streaming URL can retrieve the video. Deployment-level Access policies may further restrict access, but upload only videos suitable for public distribution.

| Storage | Main contents |
| --- | --- |
| Display device localStorage and OPFS | Dashboard settings, custom audio, fonts, banners, and sensor recordings |
| Cloudflare R2 | Uploaded video files |
| Cloudflare D1 | User emails and roles, video metadata, playback schedules, and administrative operation logs |

Weather, fonts, and other external services also require network requests. Clearing browser site data removes local settings and files.

### Storage and charges

**Check file sizes and registered storage before uploading.** The administration total is the sum of registered video sizes, not a Cloudflare bill or a measurement of all stored objects. There is no automatic upload cutoff when the free allowance is reached.

As checked on October 14, 2026, R2 Standard storage includes **10 GB-month per month** free. Storage usage accounts for the time data is stored, and read/write requests have separate monthly allowances. Usage beyond the allowances is billed under Cloudflare's pricing terms. Remove unnecessary videos and check actual usage in Cloudflare. See the [R2 pricing page](https://developers.cloudflare.com/r2/pricing/) for current terms.

## Local development

Use Yarn 4.4.1 for the frontend and npm for the Worker. Frontend CI uses Node.js 20, but the locked Wrangler 4.149.0 requires **Node.js 22 or newer**. The following example uses a Node.js 24 container for both.

### Start the frontend

Run from the repository root:

```sh
docker run --rm -it --name cp-dashboard-dev \
  -p 127.0.0.1:3000:3000 -p 127.0.0.1:8787:8787 \
  -v "$PWD":/workspace -w /workspace node:24-bookworm-slim bash

# Inside the container
corepack enable
yarn install --immutable
yarn dev --host 0.0.0.0
```

Open `http://localhost:3000`. The default development video API is `http://localhost:8787/api`.

### Start the local video API

Create `cloudflare/video-api/.dev.vars` with the following local-only settings. This file is ignored by Git. See [Wrangler's local environment variable documentation](https://developers.cloudflare.com/workers/local-development/environment-variables/).

```dotenv
LOCAL_AUTH_BYPASS="true"
ACCESS_TEAM_DOMAIN=""
ACCESS_AUD=""
```

From a second host terminal, enter the same container and initialize the local database:

```sh
docker exec -it cp-dashboard-dev bash
cd /workspace/cloudflare/video-api
npm ci
npx wrangler d1 migrations apply event-videos-db --local
npx wrangler d1 execute event-videos-db --local --command \
  "INSERT OR IGNORE INTO users (id, email, role) VALUES ('local-test-admin', 'local-test-admin@example.invalid', 'admin');"
npm run cf-typegen
npm run dev -- --ip 0.0.0.0
```

Use `http://localhost:3000/admin` to check the interface. `--local` targets the local database. Authentication is bypassed only when `LOCAL_AUTH_BYPASS=true`, both Access settings are empty, the request URL uses a loopback hostname, and the fixed local administrator record exists. Do not enable this in production.

### Build and validation

| Working directory | Command | Purpose |
| --- | --- | --- |
| Root | `yarn build` | Production build |
| Root | `yarn preview` | Preview the build |
| Root | `yarn generate` | Generate static files |
| `cloudflare/video-api/` | `npm test -- --run` | Run Vitest with the Cloudflare test plugin |
| `cloudflare/video-api/` | `npm run cf-typegen` | Generate Wrangler binding types |

The frontend has no automated test suite or lint script, and automatic Nuxt type checking is disabled. Check display sizes, timer behavior, audio, and settings after reloading when changing the UI. For video changes, check each role's permissions and scheduled playback on display devices.

## Deployment architecture

The frontend is a client-rendered Nuxt 3 application (`ssr: false`). The static dashboard can be hosted on its own. Video features require these connections:

1. Configure the D1 (`DB`) and R2 (`VIDEO_BUCKET`) resources in `cloudflare/video-api/wrangler.jsonc` for your deployment.
2. Apply the D1 migrations and register the first administrator's Access login email in `users` with role `admin`. **`0002_update_schedules.sql` recreates the schedule table and deletes existing schedules.** Review the migration and back up an existing database before applying it.
3. Set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` on the API Worker to match the Access application, and configure Access policies for the administrative page and API.
4. Run `npm run deploy` from `cloudflare/video-api/` to deploy the Worker. Deploy to Cloudflare Pages with `functions/` included, and connect the `VIDEO_API` service binding to the API Worker (default name `video-api`). Configure required bindings for preview deployments too.

Static output is generated in `.output/public/`. Set `NUXT_PUBLIC_VIDEO_API_BASE` when generating the frontend to choose the API URL; production builds default to `/api`. `BASE_URL` sets the application path, for example `BASE_URL=/cp-dashboard/ yarn generate`. Hosting video features on GitHub Pages or another static host requires a separate API connection; a different API origin also needs matching CORS and authentication configuration.

## Repository layout

```text
pages/                 Dashboard, administration, playback checks
components/            Clock, timer, settings
composables/           Shared state and API base URL
plugins/ · workers/    Clock, timer, weather, sensor processing
utils/                 Date calculations, file storage, sensor records
public/                Icons, PWA assets, audio
cloudflare/video-api/  API Worker, D1 migrations, tests
functions/api/         Cloudflare Pages proxy to the Worker
arduino-sender/        Sensor sender firmware
```

See [AGENTS.md](AGENTS.md) and the [Worker guide](cloudflare/video-api/AGENTS.md) for contribution guidelines.

## Project history and bug reports

- 2024: CoreNion developed the clock, timer, weather, sensors, and event display, with improvements to initial audio activation, mobile layouts, and PWA support.
- October 2026: This repository added video streaming, scheduled playback, and role management ([03b5ce8](https://github.com/cpsf2026-yokohama/cp-dashboard/commit/03b5ce8bc2e2b4de59c18ce2f6f75fdec270529a)). Demonstration-only device status cards were removed from administration ([00000d3](https://github.com/cpsf2026-yokohama/cp-dashboard/commit/00000d38aea860d99f37cefa2c86d3098b4fb3e2)).
- October 14, 2026: Fixed the direction of the timer's rolling number animation ([7c2c470](https://github.com/cpsf2026-yokohama/cp-dashboard/commit/7c2c47048c35e5ff7a72f8a23333837d4fa7096a)).

Report operational bugs to the operating team's contact on Slack, with reproduction steps, browser/device details, and expected behavior. Do not attach authentication tokens or personal information.

## License and credits

- Application source: [MIT License](LICENCE). Copyright © 2024 CoreNion.
- Weather data: [Japan Meteorological Agency](https://www.jma.go.jp/bosai/); see its [web service terms](https://www.jma.go.jp/jma/kishou/info/coment.html).
- Fonts: Inter (Copyright 2020 The Inter Project Authors) and M PLUS Rounded 1c, under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL).
- Bundled sound effects: [OtoLogic](https://otologic.jp/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
