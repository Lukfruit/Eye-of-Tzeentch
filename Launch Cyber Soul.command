#!/bin/zsh

set -e
SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR"
exec python3 cyber_soul_gui.py "$@"
