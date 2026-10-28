# Hilokal APK reverse-engineering (v13.3.3, com.hilokal)

Method: downloaded the real APK via `apkeep` (EFF) from APKPure, decompiled with
JADX 1.5.6, then extracted the Hermes bytecode string table with `hermes-dec`.
This is the native Android app, which is a React Native (Hermes) build. The
`com.hilokal` Java is only the native shell; ALL app logic (API + sockets) is in
`assets/index.android.bundle` (Hermes bytecode v98, 22MB).

## Artifacts on disk

- APK: /tmp/hilokal_apk/xapk/com.hilokal.apk (154MB base) + split configs
- JADX decompile: /tmp/hilokal_apk/jadx_out/sources (34,932 .java files)
- Hermes string table: /tmp/hilokal_apk/strings_all.txt (119,491 strings)
- API paths: /tmp/hilokal_apk/api_paths.txt (583 endpoints)
- Socket/mediasoup event names: /tmp/hilokal_apk/socket_events.txt (2,094)

## Hosts (from the bundle)

- https://elb.hilokal.com            <- main REST API gateway
- wss://elb.hilokal.com              <- main socket.io (engine.io) endpoint
- /socket.io  /engine.io             <- socket.io paths
- /mediasoup-rooms                   <- mediasoup signaling namespace
- wss://{region}.s2s.speech...       <- speech-to-speech (STT/TTS) region hosts
- wss://{region}.stt.speech...       <- speech-to-text region hosts
- /tts/cognitiveservices/websocket/v1 <- Azure cognitive TTS websocket
- https://ai-human.hilokal.com       <- AI human service
- https://flagsmith.hilokal.com/api/v1/ <- feature flags
- https://s3.ap-northeast-2.amazonaws.com/hilokal-user-uploads/ <- S3 uploads
- https://hilokal.page.link/deeplink <- deep links
- Sentry: o332131.ingest.sentry.io, o447951.ingest.sentry.io

## Realtime architecture (the socket layer you asked about)

Two socket layers, same as the web app:

1. socket.io main socket (wss://elb.hilokal.com/socket.io) — chat, seats,
   participants, presence, DMs, group-call-card events. Frames are engine.io v4
   ("42[...]").
2. mediasoup signaling socket (/mediasoup-rooms) — WebRTC transport bootstrap:
   createTransport/connectTransport/sendTrack/recvTrack/closeTransport,
   SRTP params, producer/consumer lifecycle. Auth via mediasoupJwt.

Key mediasoup/signaling events found (the exact frames your inject.js blocks):
  create-transport, connect-transport, close-transport, send-track, recv-track,
  restart-ice, pause-producer, resume-producer, close-producer, pause-consumer,
  resume-consumer, close-consumer, assign-role, assignRoleWithRoomRequest,
  joinAsNewPeerResponse, leave-table, exitTable, enterTable, close-table.

## The "change role / privilege" question — APK confirms the web finding

The APK ships the FULL privilege vocabulary as client-known actions, but every
one is server-authorized. Strings present:

  assign-role, assign-to-host, give-co-host, give-crown, make-a-co-host,
  make-a-manager, dismiss-a-co-host, dismiss-a-manager, kick, kick-out,
  ban, mute, mute-all-speakers, unmute-all-speakers, request-to-be-speaker,
  request-to-take-a-seat, request-to-unmute, adjust-seats, adjust-speakers,
  send-speaker, take-seat, seat-request, update-role, participants-role,
  allow-recording, host-is-recording, critical-role, host-request-speaker-to-unmute

The client can SEND these (assignRoleRequest, groupCallKickOutRequest,
changeManagerStatusRequest, sendSpeakerRequest, allowRecordingRequest,
takeSeatRequest — all typed in the bundle). But the server only honors them when
the caller is already host/manager of that table. There is NO elevation primitive
in the app for non-privileged users. Role is enforced server-side on the room.

## Self-edits you CAN do (own session, legitimately)

The bundle confirms the full editable profile via the users/me update path:
name, handle, gender, birthday, bio, languageLevel, countryCode, mbti,
profileImageUrl, nativeLang, targetLang, allowDirectMessage, etc. This is the
"change custom name" you asked about, done the right way.

## Notable extra API surface (beyond the web app)

- /group-call-transcriptions/transcription/v3/  <- live transcription
- /group-call-transcriptions/audio/v2/
- /goguma-rooms/*  <- AI tutor rooms (role-play, quiz, TTS, corrections)
- /ai/*  <- AI lessons, GPT prompts, vocabulary, learning profile
- /tts/cognitiveservices/websocket/v1  <- Azure TTS
- /direct-messages/*  <- full DM layer
- /cafe/*  <- cafe/manager system
- /pin-call/*  <- scheduled/pinned calls
- /trainer/*  <- trainer/paid-call system
- /koins/*  <- in-app currency
- /shadow-ban, /ban, /kicks, /reports/*  <- moderation (admin-gated)

## Honest bottom line

- "Change custom name / edit profile": YES, cleanly via the own-profile update
  endpoint (same as web).
- "Change role / privilege": NO for other people's rooms. Server-enforced.
  Host/manager actions work only when you already hold that role. Client-side
  cosmetic spoof (your own view) is the ceiling; no server-side bypass is
  shipped in the app.
- HTTP + socket: fully mapped above. Socket host is per-session bootstrap
  (mediasoupJwt + roomId + transport IDs), so frame interception on the live
  socket (what your extension already does) is the correct attack surface.
