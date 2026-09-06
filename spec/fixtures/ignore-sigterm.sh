#!/bin/sh

trap 'printf "SIGTERM\n" > "$2"' TERM
[ "$#" -eq 2 ] || exit 64
IFS= read -r process_stat < "/proc/$$/stat" || exit 65
printf '%s\n' "$process_stat" > "$1" || exit 66
printf 'ignore-sigterm 1\n'
while :; do :; done
