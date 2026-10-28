# Hilokal webapp reverse-engineering notes

Source: live `www.hilokal.com` Next.js bundles (fetched + static-analyzed, not REA).
The `morluto/rea` repo turned out to be "REA: Reverse Engineer Anything" — a generic
RE toolkit (MCP server + CLI wrapping Hopper/Ghidra/JADX/binwalk). It is NOT
Hilokal-specific, so it adds nothing for the web layer. Everything below came from
pulling Hilokal's own JS chunks out of `/_next/static/chunks/`. REA would only matter
if you wanted to unpack the Hilokal iOS/Android binaries (JADX on the APK).

## Architecture at a glance

- Web frontend: Next.js. Landing pages static; the real code is in ~33 shared chunks +
  per-route `pages/*` chunks keyed by build id in `_buildManifest.js`.
- API gateway: `https://elb.hilokal.com` (REST) — same host your extension already hits.
  Usage of `elb` in the big chunks is mostly a false signal (timezone tables); the real
  host is injected at runtime, consistent with your existing `seat-request` / `users/me`
  calls.
- Realtime: two socket layers.
  1. socket.io (engine.io v4, frames start `42`) — chat, seats, participants,
     presence, DMs. This is the `main` socket your inject.js already proxies.
  2. mediasoup signaling socket — `mediasoupId`/`roomId` gated; transports, tracks,
     SRTP, producer/consumer. This is the `hilokal-media`/`mediasoup` socket you block
     leave/close events on for Ghost mode.

The dump below is the compiled io-ts/runtypes schema layer — it is literally the typed
contract for the whole backend. 506 schemas, 332 request/response/message types.

## Schema-inventory files (saved locally)

- Full schema name dump: /tmp/hilokal_re/schemas.txt
- Source chunks: /tmp/hilokal_re/chunks/ (main: 64b533c2-af10a24e4218f033.js =
  the API schema module; 3645-319a318849393956.js = mediasoup/signaling protocol).

## Self-edits you already can do (PUT /users/me)

The `updateUserRequest` schema is the full editable user object. Fields are optional
(note the backend re-validates and won't blindly honor paid/server flags):

    nativeLang, targetLang, name, phoneCountryCode, phoneNumber, email, password,
    profileImageUrl, languageLevel, gender, birthday, countryCode, koins, verified,
    inviteCode, handle, allowDirectMessage, nativeChangingCount, birthdayChangingCount,
    allowTimeZone, allowTimeZoneLevel, finishedOnboarding, bio, verifiedTeacher, mbti,
    premium, allowTalktime, allowStreak, allowVisitorCount, allowWordCount,
    verificationCode

Your extension already drives `name`? No — it drives `birthday` (the flicker) and
`users/me` for that. This schema says set the WHOLE profile: name, handle, gender,
bio, languageLevel, countryCode, mbti in a single PUT. That is the "change custom
name" you asked about, legitimately through the own-profile endpoint.

CAUTION: `koins`, `premium`, `verified`, `verifiedTeacher`, `languageLevel` are
server-trusted. Overriding them client-side normally won't stick (256 something). The
schema just types them because the same object type is reused for responses.

## Realtime / socket-connect story

Host is NOT hardcoded in JS. The client must ask the server which media/room to talk
to via REST + socket (chooseMediasoupServer, mediasoupServer schemas:
{url, countryCode, serverRole}). So "just connect to wss://X" doesn't work — the room
socket is bootstrapped per-session with roomId + mediasoupId + per-transport IDs.
That is the whole reason your Ghost approach (hijack WebSocket frame send in the page
context) is the correct technique: you can't reconnect cold, but you can intercept
frames on the live socket.

## What "privilege" you can and can't get

Schemas present (so the CLIENT knows the call shapes), but each is server-authorized:

    assignRoleRequest   { groupCallId, targetUserId, roomId, role, requestSeatId }
    groupCallKickOutRequest { groupCallId, roomId, targetUserId }
    changeManagerStatusRequest { cafeId, userId }
    sendSpeakerRequest  { userId }
    allowRecordingRequest { allowRecording, groupCallId?, producerId? }
    takeSeatRequest     { groupCallId, roomId }

You can SEND these payloads from your own session (your own account / own tables only).
If you are the host/manager of a table, you can legitimately assign roles, kick,
force-mute, take seat. If you are a normal user in SOMEONE ELSE's table, the server
rejects — the app does not ship an elevation primitive anywhere for non-privileged
users; role is enforced server-side on the room.

## Mediasoup signaling (chunk 3645) — the media socket messages

Protocol module exposes (exported names found):
  joinAsNewPeerResponse, peerRole,
  createTransportRequest/Response, connectTransportRequest, iceRestartRequest,
  closeTransportRequest, sendTrackRequest/Response, recvTrackRequest,
  recvRtpTrackRequest, assignRoleWithRoomRequest
  + createTransport gives { id, iceParameters, iceCandidates, dtlsParameters,
    iceServers } — classic mediasoup RTC transport bootstrap.

These are exactly the frames your inject.js blocks (leave-table, close-transport,
closeProducer, pauseProducer, replaceTrack(null)) to make Ghost/host-stay mode work.
"assignRoleWithRoomRequest" is the same assign-role capability, but again only honors
host/manager.

## What you could add to the extension (realistic, legal-on-your-own-session)

These go through endpoints the schema proves exist, on YOUR session only:

1. Full profile editor: single PUT /users/me with name+handle+gender+bio+languageLevel+
   mbti+countryCode (not just birthday). Replaces birthday-flicker hacks for profile.
2. Seat-burst control is already there; you could add assign/sendSpeaker/letothers
   only works if you are host is not up to me to pre-build.
3. Whiteboard: groupCallCreateWhiteboard* / groupCallCreateWhiteboardImage* exist as
   schema types.
4. Emoji / pin / report message paths typed (groupCallEmojiRequest, groupCallPinRequest).
5. DM layer fully typed (directMessage*, createGroupDirectMessageRoom*, adminDMs).
6. Live transcription: createTranscriptionRequest, postTranscribeVoiceMessageRequest,
   ttsReplayRequest — TTS + transcription on calls.
7. Trainer/manager ops typed (trainerManagerResponse, trainerGroupCallStatusRequest).

Deliverable honest bottom line:
- "Change custom name / edit profile": YES, cleanly via PUT /users/me (own session).
- "Change role / privilege": NO for other people's rooms. Role is enforced server-side.
  Host-only actions work only when you already are host. Client-side cosmetic spoof
  (your own view) is the ceiling; there is no server-side bypass shipped in the app.
- HTTP + socket: fully mapped above; socket host is per-session bootstrap, so frame
  interception on the live socket (what you already do) is the right attack surface.

## Raw artifacts kept

- /tmp/hilokal_re/          chunks + this mining
- /tmp/rea                   the (generic) REA repo clone
- This file                 permanent notes