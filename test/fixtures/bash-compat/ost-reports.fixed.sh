#!/bin/bash
#
# Page through OST loop reports. The inbox, independent of macOS entirely.
#
#   ost-reports              the newest report
#   ost-reports -n 5         the 5 newest
#   ost-reports --list       every report, one line each, newest first
#   ost-reports 3            the 3rd-newest report in full
#   ost-reports --undelivered  reports that were archived but never got on screen
#
# Notification Center is the nicer surface when it works. This is the one that always
# works, and it is what makes "I never saw it" answerable rather than a guess.
set -uo pipefail

ARCHIVE_DIR="$HOME/Library/Logs/ost-reports-archive"
SPOOL_DIR="$HOME/Library/Logs/ost-reports-spool"

[ -d "$ARCHIVE_DIR" ] || { echo "No reports yet — the loops have not reported since the archive was set up."; exit 0; }

# Newest first. Spelled with a read loop rather than `mapfile`, which is bash 4+ and this
# machine's /bin/bash is 3.2 — the script parsed fine and died at its first real line.
FILES=()
while IFS= read -r line; do [ -n "$line" ] && FILES+=("$line"); done < <(ls -1 "$ARCHIVE_DIR"/*.txt 2>/dev/null | sort -r)
COUNT=${#FILES[@]}
[ "$COUNT" -gt 0 ] || { echo "No reports yet."; exit 0; }

pretty_stamp() {
  # 20260803T152334Z -> 2026-08-03 15:23 UTC
  local b; b="$(basename "$1" .txt)"
  local s="${b%%-*}"
  printf '%s-%s-%s %s:%s UTC' "${s:0:4}" "${s:4:2}" "${s:6:2}" "${s:9:2}" "${s:11:2}"
}

show() {
  local f="$1" idx="$2"
  printf '\033[1m[%d] %s\033[0m  \033[2m%s\033[0m\n' "$idx" "$(head -1 "$f")" "$(pretty_stamp "$f")"
  tail -n +2 "$f" | fold -s -w 88 | sed 's/^/  /'
  printf '\n'
}

case "${1:-}" in
  --list|-l)
    printf 'OST loop reports — %d total, newest first\n\n' "$COUNT"
    for i in "${!FILES[@]}"; do
      printf '\033[1m%3d\033[0m  %s  \033[2m%s\033[0m\n    %s\n' \
        "$((i+1))" "$(pretty_stamp "${FILES[$i]}")" "$(head -1 "${FILES[$i]}")" \
        "$(tail -n +2 "${FILES[$i]}" | tr '\n' ' ' | cut -c1-96)…"
    done
    ;;
  --undelivered)
    # A file still in the spool is a report the app never posted — the exact evidence
    # that separates "notifications are broken" from "I missed it".
    PENDING=$(ls -1 "$SPOOL_DIR"/*.txt 2>/dev/null | wc -l | tr -d ' ')
    if [ "$PENDING" = "0" ]; then
      # Deliberately hedged. macOS does NOT raise an AppleScript error when notification
      # permission is denied — `display notification` returns cleanly and shows nothing.
      # So an empty spool proves the app ran, not that anything reached the screen, and
      # claiming otherwise would recreate the exact blind spot this channel exists to close.
      echo "Every report was handed to OST Reports.app and it ran without error."
      echo
      echo "That does NOT prove anything appeared on screen: macOS denies notification"
      echo "permission silently, with no error the app can see. If you saw nothing, check"
      echo "System Settings > Notifications > OST Reports before suspecting the loops."
    else
      printf '%s report(s) were archived but NEVER posted to the screen:\n\n' "$PENDING"
      for f in "$SPOOL_DIR"/*.txt; do printf '  %s  %s\n' "$(pretty_stamp "$f")" "$(head -1 "$f")"; done
      printf '\nThat means OST Reports.app could not post — almost always notification permission.\n'
    fi
    ;;
  -n)
    N="${2:-1}"
    for i in $(seq 0 $((N-1))); do [ "$i" -lt "$COUNT" ] && show "${FILES[$i]}" "$((i+1))"; done
    ;;
  ''|--latest)
    show "${FILES[0]}" 1
    [ "$COUNT" -gt 1 ] && printf '\033[2m%d older report(s). `ost-reports --list` to see them.\033[0m\n' "$((COUNT-1))"
    ;;
  *[!0-9]*)
    echo "usage: ost-reports [--list | --undelivered | -n COUNT | INDEX]" >&2; exit 2 ;;
  *)
    IDX="$1"
    [ "$IDX" -ge 1 ] && [ "$IDX" -le "$COUNT" ] || { echo "No report $IDX — there are $COUNT." >&2; exit 1; }
    show "${FILES[$((IDX-1))]}" "$IDX" ;;
esac
