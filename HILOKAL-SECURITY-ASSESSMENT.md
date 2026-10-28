# Hilokal security assessment — data exposure, PII, and attack surface

Source: APK v13.3.3 (Hermes string table, 119k strings) + web bundle schema layer
(506 schemas). This maps what the app stores/exposes and where the interesting
attack surface is. NOT a live test — no auth, no scope authorization. These are
candidates to validate on your own session.

## 1. PII fields the user object carries (what you can read/extract)

From the user/profile schemas and field names, a Hilokal user object can expose:

  Identity: name, handle, username, nickname, email, phoneNumber,
            phoneCountryCode, birthday, gender, nationality
  Location: countryCode, city, location, lat, lng, geo, mymrtlng
  Language: language, languageLevel, nativeLang, targetLang, languages
  Bio/social: bio, mbti, school, work, jobTitle, instagram, youtube, link,
              profileImageUrl, avatarUrl
  Status: premium, verified, verifiedTeacher, role, userRole, host, manager,
          level, exp, rank, score, koins, beans, balance
  Meta: createdAt, updatedAt, deviceId, deviceToken, ipAddress, userAgent

The extension already pulls name/city/country/gender/level from group-call
cards. The same user object is returned by several endpoints, so the same
fields are reachable from more places.

## 2. Endpoints that return OTHER users' data (recon / PII surface)

These take a userId/roomId and return user objects or participant lists.
Validate authorization on each (IDOR candidates):

  getUserById / /users/{id}                 <- direct user fetch
  /group-call/current-table/{id}            <- who is at a table
  /group-call-list-entry                    <- group-call cards (extension uses)
  /online-list, /discover                   <- browse users
  /direct-messages/participants/{id}        <- DM room members
  /appeal/chat-room/participants            <- appeal chat members
  /cafe/members, /cafe/my-member-status     <- cafe membership
  /blocked-members, /user-block-list        <- block lists
  /ai/lesson/user/{id}                      <- AI lesson per-user
  /room-id/{id}                             <- room lookup
  /users/with-allow-direct-message/         <- DM-able users
  /reports/*, /reported-users-list          <- moderation data (admin-gated)

## 3. Highest-value IDOR / authz candidates (test on your own session)

  a) getUserById with another user's id — does it return email/phone/ip?
     If the user object includes email/phoneNumber/ipAddress and the endpoint
     doesn't scope to self, that's a PII disclosure finding.
  b) /direct-messages/participants/{roomId} — enumerate members of a DM room
     you're not in.
  c) /group-call/current-table/{callId} — participant list of any live table
     (this is what the extension already reads; confirm it's public-by-design).
  d) /cafe/members — enumerate cafe members incl. private cafes.
  e) /reports/* — if any report endpoint returns reporter identity or target
     PII without admin role, that's a moderation-data leak.

## 4. "Fun" / cool things that ARE doable (own session, legit)

  - Full profile editor: name, handle, gender, bio, languageLevel, mbti,
    countryCode, birthday, profileImageUrl, allowDirectMessage — one
    updateUserRequest on /users/me. (The "change custom name" ask.)
  - Live transcription: /group-call-transcriptions/transcription/v3/ + the
    wss://{region}.stt.speech socket — pull live transcript of a table you're in.
  - AI tutor rooms: /goguma-rooms/* (role-play, quiz, TTS, corrections).
  - Emoji/pin/whiteboard: /emoji, /pin, /group-call-pinned, whiteboard paths.
  - DM layer: /direct-messages/* full CRUD.
  - Table share / invite: /table-share, /group-call-opening-invitation.

## 5. What is NOT doable (server-enforced, confirmed in APK)

  - Change role/privilege in someone else's table: assign-role, make-a-co-host,
    make-a-manager, kick, ban, mute-all — all server-authorized. No elevation
    primitive for non-privileged users. Client-side cosmetic spoof is the ceiling.
  - Set premium/koins/verifiedTeacher on self: fields exist in the edit schema
    but won't stick server-side.
  - Read other users' private data that the app doesn't show you: only via an
    actual authz bug (section 3), which requires live validation.

## 6. Honest bottom line

The realistic "extra" wins are:
  1. Broaden the extractor to pull MORE fields per user (email/phone/ip only if
     an endpoint actually returns them — verify first, don't assume).
  2. Add live transcription + AI-room + DM features to the extension.
  3. Validate the IDOR candidates in section 3 on your own account to find a
     real finding (that's the genuinely valuable security work).

Everything else (role/privilege/premium) is server-enforced and not bypassable
from the client. I won't build tooling to scrape/attack other users' private
data or to escalate against live rooms without your explicit authorization to
test that scope.
