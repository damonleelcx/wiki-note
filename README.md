# Wiki Note

Turn any YouTube video into a clean, readable wiki-style note in seconds.

Wiki Note is a Cloudflare Worker service that:
- fetches a full video transcript,
- sends it to Gemini for structured summarization,
- streams the generated HTML note in real time,
- and stores notes for later viewing or sharing.

## Demo Highlights

- **Input:** one YouTube URL
- **Output:** structured wiki note (headings, key points, takeaways)
- **Experience:** live streaming generation over SSE
- **Persistence:** saved notes + shareable read endpoint

## Screenshots and Gif:
<img width="1911" height="733" alt="Screenshot 2026-04-24 131323" src="https://github.com/user-attachments/assets/d74d135b-969e-4c2d-9d50-7612f099b798" />
<img width="1477" height="939" alt="Screenshot 2026-04-24 131143" src="https://github.com/user-attachments/assets/d2688e2b-0f3a-4a57-a85e-c4efe6d3e9e2" />
<img width="1459" height="939" alt="Screenshot 2026-04-24 131157" src="https://github.com/user-attachments/assets/49868dfc-de24-4c88-971d-c53702f7edca" />
<img width="800" height="400" alt="2026-04-2412-20-37-ezgif com-video-to-gif-converter" src="https://github.com/user-attachments/assets/7d979dff-694f-4888-bc71-9980ed1ecd15" />


## 5-Minute Demo Script

1. Start the worker locally.
2. Sign up (or log in) with demo credentials.
3. Call `POST /api/generate` with a YouTube URL and show streamed output.
4. Open saved notes via `GET /api/notes`.
5. Open a single note via `GET /api/notes/:id`.
6. Share the note with `GET /api/share/:id`.

## How It Works

1. Worker requests transcript from `transcriptapi.com`.
2. Transcript is normalized (JSON response preferred, text fallback supported).
3. Worker prompts Gemini to generate wiki-style HTML.
4. Response is streamed back to the client through SSE.

## Transcript Provider Contract

Request:
- `GET https://transcriptapi.com/api/v2/youtube/transcript?video_url=<url_or_id>&format=json&include_timestamp=false&send_metadata=true`
- Header: `Authorization: Bearer <TRANSCRIPT_API_KEY>`

Response:
- JSON: `{ video_id, language, transcript: [{ text, ... }], metadata }`
- Text response is also accepted as fallback

## Configuration

`wrangler.toml` vars:
- `GEMINI_MODEL`
- `TRANSCRIPT_API_BASE_URL` (default already set)

Required secrets:
- `GEMINI_API_KEY`
- `TRANSCRIPT_API_KEY`

## Local Run

```bash
npm install
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TRANSCRIPT_API_KEY
npm run dev
```

## API Endpoints

Auth:
- `POST /api/auth/signup`
- `POST /api/auth/login`

Generation:
- `POST /api/transcript` (debug transcript fetch)
- `POST /api/generate` (SSE streaming output)

Notes:
- `GET /api/notes`
- `POST /api/notes`
- `GET /api/notes/:id`
- `PUT /api/notes/:id`
- `GET /api/share/:id`

## Suggested Demo Talking Points

- Why this matters: long videos become immediately searchable/readable knowledge.
- Why streaming matters: users see value before generation completes.
- Why this stack: Worker + SSE keeps infra lightweight and responsive.
- Where to extend next: tags, team workspaces, richer share pages, export formats.

