#!/bin/bash
# Wolfram|Alpha LLM API query script
# Usage: ./query.sh "your query" [--appid APP_ID] [--maxchars N]

set -euo pipefail

# Defaults
APP_ID="${WOLFRAM_APP_ID:-}"
MAX_CHARS=6000
QUERY=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --appid)
            APP_ID="$2"
            shift 2
            ;;
        --maxchars)
            MAX_CHARS="$2"
            shift 2
            ;;
        *)
            if [[ -z "$QUERY" ]]; then
                QUERY="$1"
            else
                QUERY="$QUERY $1"
            fi
            shift
            ;;
    esac
done

# Validate
if [[ -z "$QUERY" ]]; then
    echo "Usage: $0 \"your query\" [--appid APP_ID] [--maxchars N]" >&2
    echo "Set WOLFRAM_APP_ID env var or pass --appid" >&2
    exit 1
fi

if [[ -z "$APP_ID" ]]; then
    echo "Error: No Wolfram App ID provided." >&2
    echo "Get one free at: https://developer.wolframalpha.com/" >&2
    echo "Then: export WOLFRAM_APP_ID=your-app-id" >&2
    exit 1
fi

# URL encode the query
encode_url() {
    local string="$1"
    python3 -c "import urllib.parse; print(urllib.parse.quote('''$string'''))"
}

ENCODED_QUERY=$(encode_url "$QUERY")

# Make the request
URL="https://www.wolframalpha.com/api/v1/llm-api?input=${ENCODED_QUERY}&appid=${APP_ID}&maxchars=${MAX_CHARS}"

RESPONSE=$(curl -s --max-time 30 "$URL")

# Check for errors
if [[ "$RESPONSE" == *"Error"* && "$RESPONSE" == *"Invalid appid"* ]]; then
    echo "Error: Invalid Wolfram App ID" >&2
    exit 1
fi

if [[ -z "$RESPONSE" ]]; then
    echo "Error: Empty response from Wolfram|Alpha" >&2
    exit 1
fi

# Output the result
echo "$RESPONSE"
