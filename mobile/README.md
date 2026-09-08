# Physics Platform — Mobile App (Expo + React Native + TypeScript)

## What's implemented

- **Navigation**: Expo Router with an `(auth)` group (login/register) and a
  `(tabs)` group (Home, Courses, AI Assistant, Profile), gated by
  `components/AuthGate.tsx` based on whether a JWT is stored.
- **Auth**: register/login screens backed by `context/AuthContext.tsx`,
  token persisted with `expo-secure-store`.
- **Courses / Lessons**: list → detail → lesson screens wired to the backend.
- **Student Progress**: lesson screen marks progress via `PUT /api/v1/progress`;
  Home screen shows overall completion.
- **AI Physics Assistant**: chat UI (`app/(tabs)/assistant.tsx`) that calls
  the backend's `/api/v1/ai/ask` — **never Qwen directly**, per the plan's
  security rule — and renders any `visualization` payload via
  `components/visualizations/VisualizationRenderer.tsx`.
- **Chat history**: sessions are tracked by `session_id`;
  `getChatHistory()` in `lib/api.ts` is ready to hydrate a past thread.
- **Profile/Settings**: shows the user + plan, log out.

## Run it

```bash
cd mobile
npm install
cp .env.example .env
# edit .env — on a physical device/emulator, "localhost" won't reach your
# dev machine; use your machine's LAN IP, e.g.:
#   EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:8000

npm start
# then press "a" for Android emulator, "i" for iOS simulator (macOS only),
# or scan the QR code with the Expo Go app on your phone
```

Make sure the backend (`../backend`) is running first — see its README.

## Project layout

```
app/
  _layout.tsx          # root layout: providers + AuthGate + top-level Stack
  (auth)/               # login, register
  (tabs)/               # Home, Courses, AI Assistant, Profile
    courses/            # course list -> course detail (nested stack)
  lessons/[id].tsx       # lesson detail (video/content), pushed from courses
components/
  AuthGate.tsx           # redirects between (auth) and (tabs)
  visualizations/        # renders AI-returned visualization payloads
context/
  AuthContext.tsx         # auth state + token persistence
lib/
  api.ts, config.ts, types.ts   # typed API client for the FastAPI backend
```

## Next steps toward the full plan

- Add a real chart/SVG library (react-native-svg, victory-native, or similar)
  behind `VisualizationRenderer.tsx` — it currently renders numeric summaries
  as a placeholder for each visualization `type`.
- Add a proper video player (expo-av / expo-video) in the lesson screen.
- Track real watch/scroll-based progress instead of "100% on open".
- Add a chat history / session list screen using `getChatHistory()`.
- Add push notifications, offline caching, etc. as needed.
