# Push Activity API

`POST /api/push/activity`

Push a GPX, TCX, or FIT file from a watch or remote client.

---

## Authentication

**Header:** `Authorization: Bearer <api_key>`

API keys are managed in the settings UI. Returns `401` if missing or invalid.

---

## Request formats

### Raw body (recommended for scripts)

```bash
curl -X POST https://coach.example.com/api/push/activity \
  -H "Authorization: Bearer coach_xxx" \
  -H "Content-Type: application/gpx+xml" \
  --data-binary @activity.gpx
```

Supported `Content-Type` values and how they map:

| Content-Type | Treated as |
|---|---|
| `application/gpx+xml` / `application/gpx` | GPX |
| `application/vnd.garmin.tcx+xml` / `application/tcx` / `application/tcx+xml` | TCX |
| `application/xml` / `text/xml` | Auto-detected by content |
| `application/octet-stream` / `application/x-fit` / `application/fit` | FIT |

### Multipart form

```bash
curl -X POST https://coach.example.com/api/push/activity \
  -H "Authorization: Bearer coach_xxx" \
  -F "file=@activity.fit"
```

---

## Query string overrides (optional)

| Param | Type | Description |
|---|---|---|
| `name` | string | Override auto-detected activity name |
| `type` | string | Override activity type. One of: `run`, `ride`, `swim`, `hike`, `walk`, `workout`, `other` |
| `externalId` | string | Override the deduplication key (default: auto-generated from filename + date + random) |

---

## Duplicate handling

Before inserting, the API checks for an existing `watch_push` activity from the same user that matches on **all** of:

| Check | Tolerance |
|---|---|
| Same `type` | Exact |
| Start time | ±2 minutes |
| Duration | Within 5% |
| Distance | Within 5% (if both have it) |
| Not already merged | `mergedIntoId IS NULL` |

If a match is found, the existing record is **updated in-place** with the new data (the retransmission may carry richer GPS/HR data) — no new row is created.

---

## Responses

### `200 OK`

```json
{
  "success": true,
  "message": "Imported 1 new activity, updated 1 duplicate",
  "activities": [
    {
      "id": "uuid",
      "name": "Morning Run",
      "type": "run",
      "startDate": "2026-07-13T06:30:00.000Z",
      "durationSeconds": 3720,
      "distanceMeters": 10500.5,
      "hasTrackPoints": true,
      "trackPointCount": 1842
    }
  ],
  "updated": [
    {
      "id": "uuid",
      "name": "Evening Ride",
      "type": "ride",
      "startDate": "2026-07-12T18:00:00.000Z",
      "durationSeconds": 5400,
      "distanceMeters": 42195.0,
      "hasTrackPoints": true,
      "trackPointCount": 2100
    }
  ]
}
```

| Field | Always present? | Notes |
|---|---|---|
| `success` | Always | `true` on success |
| `message` | Always | Human-readable summary |
| `activities` | Always | Array of newly created records (may be empty) |
| `updated` | Only if duplicates found | Array of existing records that were updated in-place |

### `422 Unprocessable`

```json
{
  "success": false,
  "error": "Could not parse any activities from the file. Ensure it's a valid GPX, TCX, or FIT file."
}
```

### `401 Unauthorized`

```json
{
  "error": "Missing Authorization header. Use: Bearer <api_key>"
}
```

or

```json
{
  "error": "Invalid or revoked API key"
}
```

### `500 Internal Error`

```json
{
  "success": false,
  "error": "Failed to process file: <error details>"
}
```

---

## Example scripts

**Push a FIT file (multipart):**
```bash
curl -X POST https://coach.example.com/api/push/activity \
  -H "Authorization: Bearer coach_xxx" \
  -F "file=@today_run.fit"
```

**Push a GPX file (raw body):**
```bash
curl -X POST https://coach.example.com/api/push/activity \
  -H "Authorization: Bearer coach_xxx" \
  -H "Content-Type: application/gpx+xml" \
  --data-binary @morning_walk.gpx
```

**Push with overrides:**
```bash
curl -X POST 'https://coach.example.com/api/push/activity?name=Track+Workout&type=run&externalId=coros-watch-123' \
  -H "Authorization: Bearer coach_xxx" \
  -F "file=@sprint_intervals.fit"
```
