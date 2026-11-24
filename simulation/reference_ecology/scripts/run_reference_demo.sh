#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT/src${PYTHONPATH:+:$PYTHONPATH}"
python -m unittest discover -s tests -v
python -m living_atlas.cli --minutes "${1:-180}" --seed "${2:-17}" --interaction "${3:-greeting}"
