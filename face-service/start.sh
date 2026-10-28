#!/usr/bin/env bash
# Start the PQ-ZKVote Face Recognition Service
# Run from the face-service/ directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d "venv" ]; then
  echo "🔧 Creating Python virtual environment..."
  python3 -m venv venv
fi

echo "📦 Step 1/2 — Installing core dependencies..."
venv/bin/pip install -r requirements.txt --quiet

# facenet-pytorch 2.6.0 pins Pillow<10.3.0 which has no wheel for Python 3.13.
# Installing with --no-deps bypasses that constraint safely — the Pillow API
# used by facenet-pytorch hasn't changed in the relevant versions.
echo "📦 Step 2/2 — Installing facenet-pytorch (no-deps)..."
venv/bin/pip install facenet-pytorch==2.6.0 --no-deps --quiet

echo "🚀 Starting PQ-ZKVote Face Service on http://localhost:8000"
venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload
