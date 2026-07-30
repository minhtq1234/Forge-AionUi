# Creative Studio provider contract

Creative Studio runs generation remotely. WePrompt does not bundle Open-Sora
weights, Python, PyTorch, CUDA, a GPU runtime, FFmpeg, or a local inference
server. Provider credentials remain in the existing WePrompt provider service.
Studio persists only the provider-row ID, adapter ID, selected model, sanitized
capabilities, and validation time.

Adapters, credentials, provider responses, remote job IDs, temporary output
URLs, and resolved local inputs stay in the main process. The renderer receives
only sanitized route and job DTOs; job DTOs omit both the remote job ID and
submission idempotency key.

## BytePlus ModelArk Seedance

Create a BytePlus ModelArk custom provider row, use the exact base URL
`https://ark.ap-southeast.bytepluses.com/api/v3`, and explicitly bind the row
and model to the `byteplus-seedance-v1` adapter. Lookalike hosts, extra paths,
credentials embedded in the URL, query strings, fragments, and unofficial
model IDs are rejected.

The MVP supports this Studio-safe intersection:

| Model ID                       | Whole-second duration | Resolution  | Aspect ratios             |
| ------------------------------ | --------------------- | ----------- | ------------------------- |
| `seedance-1-0-pro-250528`      | 2–12                  | 720p, 1080p | 16:9, 9:16, 1:1, 4:3, 3:4 |
| `seedance-1-5-pro-251215`      | 4–12                  | 720p, 1080p | 16:9, 9:16, 1:1, 4:3, 3:4 |
| `dreamina-seedance-2-0-260128` | 4–15                  | 720p, 1080p | 16:9, 9:16, 1:1, 4:3, 3:4 |

Intelligent duration (`-1`) is not supported. Connection validation is a
finite, non-chargeable authenticated task-list request; it never creates a
generation:

```text
GET https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks
```

All calls use `Authorization: Bearer <provider api key>` in the main process:

```text
POST   /contents/generations/tasks
GET    /contents/generations/tasks/{id}
DELETE /contents/generations/tasks/{id}
```

The canonical request is:

```json
{
  "model": "seedance-1-5-pro-251215",
  "content": [
    {
      "type": "text",
      "text": "A lantern rises over a quiet harbor"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/png;base64,..."
      },
      "role": "first_frame"
    }
  ],
  "ratio": "16:9",
  "duration": 6,
  "resolution": "720p",
  "watermark": false,
  "return_last_frame": true,
  "generate_audio": false
}
```

The optional first-frame entry is resolved from the managed Studio media store
and bounded in the main process. It is never a renderer-supplied byte string,
filesystem path, or arbitrary URL. Only one first frame is sent.
`generate_audio: false` is sent for Seedance 1.5 Pro and 2.0 to preserve the
silent MVP. The field is omitted for Seedance 1.0.

An accepted task returns a bounded task ID and a queued, pending, running, or
processing status. A completed response uses the documented content shape:

```json
{
  "id": "task-id",
  "status": "succeeded",
  "content": {
    "video_url": "https://temporary.example/video.mp4",
    "last_frame_url": "https://temporary.example/poster.png"
  }
}
```

`video_url` becomes the primary video output. `last_frame_url`, when present,
becomes a poster image output. Output URLs must be valid HTTPS URLs without
embedded credentials and must not exceed 16 KiB. They remain ephemeral and
main-process-only until the job layer downloads and verifies them.

Queued Seedance tasks may be deleted. Already-cancelled tasks are treated
idempotently as cancelled. Running, succeeded, failed, and expired tasks return
a typed cancellation refusal instead of a false success.

## WePrompt Media Gateway v1

Open-Sora and other self-hosted engines connect only through an explicitly
validated `weprompt-media-gateway-v1` binding. WePrompt never infers gateway
support from an arbitrary custom provider URL.

The gateway uses the base URL and API key from the selected WePrompt provider
row. Remote gateways must use HTTPS. Plain HTTP is allowed only for an exact
IP-literal loopback host (`127.0.0.1` or `[::1]`) or an IPv4 address in
`10.0.0.0/8`, `172.16.0.0/12`, or `192.168.0.0/16`. Hostnames, wildcard
listener addresses, link-local and metadata addresses, CGNAT, and public HTTP
addresses are rejected. The base URL cannot contain user information, a query,
or a fragment. Redirects are rejected for every credentialed gateway request.
Every request receives:

```text
Authorization: Bearer <provider api key>
Content-Type: application/json
```

The version 1 routes are:

```text
GET  /v1/capabilities
POST /v1/generations
GET  /v1/generations/{id}
POST /v1/generations/{id}/cancel
```

### Capabilities

Connection validation calls `GET /v1/capabilities` with a finite deadline. A
canonical response is:

```json
{
  "schema_version": 1,
  "media_kinds": ["video"],
  "models": ["open-sora-model"],
  "video": {
    "audio_modes": ["none"],
    "aspect_ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"],
    "resolutions": ["720p", "1080p"],
    "min_duration_seconds": 2,
    "max_duration_seconds": 30,
    "supports_first_frame": true,
    "cancellation": true
  }
}
```

The selected model must appear in `models`, `media_kinds` must include
`video`, and `video.audio_modes` must include `none`. Version 1 accepts only
Studio aspect ratios shown above, 720p or 1080p, and whole-second duration
bounds from 1 through 60. `aspect_ratios`, `resolutions`,
`min_duration_seconds`, and `max_duration_seconds` are required so WePrompt
never guesses broader paid-generation support than the gateway declares.
`supports_first_frame` and `cancellation` are optional and default to false.

For compatibility, the same fields may be nested under a top-level
`capabilities` object. New gateways should emit the canonical root shape.
WePrompt sanitizes and persists only the supported fields; unknown capability
data is not exposed to the renderer.

### Submit request

`POST /v1/generations` receives:

```json
{
  "model": "open-sora-model",
  "prompt": "A lantern rises over a quiet harbor",
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "duration_seconds": 6,
  "idempotency_key": "opaque-request-id",
  "audio_mode": "none",
  "inputs": [
    {
      "role": "first_frame",
      "mime_type": "image/png",
      "data_base64": "..."
    }
  ]
}
```

`audio_mode` is always `none` in the MVP. `inputs` is empty when there is no
reference. A first frame must be JPEG, PNG, or WebP and is capped at 30 MiB
before base64 expansion. The gateway never receives a local path, managed
asset URL, or renderer-provided reference URL.

`idempotency_key` is opaque and stable for one logical submission. The gateway
should bind it to the selected model and normalized request, avoid creating a
second generation on retry, and return the existing task or completed result.

### Submit and poll responses

A gateway may complete synchronously:

```json
{
  "status": "succeeded",
  "outputs": [
    {
      "url": "https://temporary.example/video.mp4",
      "mime_type": "video/mp4"
    }
  ]
}
```

Or it may acknowledge a remote task:

```json
{
  "id": "job-id",
  "status": "queued"
}
```

`GET /v1/generations/{id}` returns one of:

```json
{
  "id": "job-id",
  "status": "running",
  "progress": 42
}
```

```json
{
  "id": "job-id",
  "status": "succeeded",
  "outputs": [
    {
      "url": "https://temporary.example/video.mp4",
      "mime_type": "video/mp4"
    }
  ]
}
```

```json
{
  "id": "job-id",
  "status": "failed"
}
```

Canonical statuses are `queued`, `running`, `succeeded`, `failed`,
`cancelled`, and `expired`. Progress is optional, finite, and from 0 through 100. A succeeded response must contain at least one usable output object with a
`url` and an explicit `mime_type` of `video/mp4` or `video/webm`; WePrompt does
not infer a media type from a temporary URL. Job IDs
must be 1–512 ASCII URL-unreserved characters, start with an alphanumeric
character, and contain only letters, numbers, `.`, `_`, `~`, or `-` after that.
URLs, path separators, query or fragment syntax, whitespace, percent-encoded
segments, and token-bearing query strings are rejected before persistence or
polling.

Output URLs must be HTTP or HTTPS, contain no embedded credentials, and be at
most 16 KiB. Public output URLs must use HTTPS. Plain HTTP is usable only at
the exact configured RFC1918 gateway origin; the downstream media downloader
revalidates the origin, redirects, size, and media signature before persistence.
Temporary output URLs must not be logged or returned to the renderer. The
loopback API exception does not relax the media policy: loopback output URLs are
rejected.

### Cancellation and errors

When `video.cancellation` is true, the gateway should implement an idempotent:

```text
POST /v1/generations/{id}/cancel
```

A successful cancellation may return `204 No Content` or another 2xx response.
Repeated cancellation should remain successful. An unsupported, unknown, or
non-cancellable task should return a non-2xx response; WePrompt reports a
sanitized `cancellation_refused` result.

WePrompt maps provider failures by HTTP status and never persists the response
body:

| Gateway result                       | WePrompt category      |
| ------------------------------------ | ---------------------- |
| 401                                  | `auth`                 |
| 429                                  | `rate_limited`         |
| 5xx                                  | `provider_unavailable` |
| request abort or validation deadline | `timeout`              |
| malformed/non-JSON success response  | `invalid_response`     |
| succeeded without a usable URL       | `no_output`            |
| unsupported capabilities or request  | `unsupported`          |
| other non-2xx/terminal failure       | `unknown`              |

Error bodies may follow the gateway's own schema, but WePrompt does not parse,
log, persist, or expose their messages.

## Minimal external Open-Sora mapping

Keep Open-Sora behind a small service implementing the four gateway routes:

1. `GET /v1/capabilities` reports the exact model and silent-video limits.
2. `POST /v1/generations` validates the request and enqueues the model job.
3. `GET /v1/generations/{id}` maps queue state to the version 1 status schema.
4. `POST /v1/generations/{id}/cancel` cancels safely when supported.
5. Completed media is hosted at a short-lived URL for WePrompt's main-process
   downloader.

The gateway owns model access, inference configuration, GPU lifecycle,
queueing, idempotency records, cancellation, and temporary media hosting.
WePrompt remains a lightweight storyboard, request, and managed-media client.
