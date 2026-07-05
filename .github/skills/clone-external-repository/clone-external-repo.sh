#!/bin/bash
#
# Clone External Repository Helper
# Clone, search, and view external GitHub repositories for code reference
#
# Usage:
#   ./clone-external-repo.sh clone <org/repo>           - Clone repository
#   ./clone-external-repo.sh find <filename>            - Find file in cloned repo
#   ./clone-external-repo.sh view <filepath>            - View file contents
#   ./clone-external-repo.sh workflow <org/repo> <file> - Full workflow
#
# Prerequisites:
#   - In GitHub Actions: GIAM_HOST + GIAM_ROLE + id-token: write permission (token fetched automatically)
#   - Locally: gh CLI authenticated via `gh auth login`
#   - For public repositories: No authentication required
#
# Authentication flow (mirrors bby-corp/tplat-gha-configure-github-credentials):
#   1. In GitHub Actions: Exchange GitHub OIDC token for GIAM token via POST /v1/ghapi/token
#   2. Locally: Use `gh auth token` (gh CLI session)
#   3. Fallback: Unauthenticated (public repos only)
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default clone directory (/tmp keeps workspace clean)
CLONE_DIR="${EXTERNAL_REPO_DIR:-/tmp}"

# GIAM configuration (mirrors tplat-gha-configure-github-credentials inputs)
GIAM_HOST="${GIAM_HOST:-giam.tools.bestbuy.com}"
GIAM_ROLE="${GIAM_ROLE:-org-read}"

# Resolved token (set by fetch_giam_token, used by clone_repo)
RESOLVED_TOKEN=""

print_usage() {
    echo "Usage: $0 <command> [arguments]"
    echo ""
    echo "Commands:"
    echo "  clone <org/repo>              Clone an external repository"
    echo "  find <filename>               Find a file in cloned repositories"
    echo "  view <filepath>               View file contents"
    echo "  workflow <org/repo> <file>    Full workflow: clone, find, view"
    echo ""
    echo "Examples:"
    echo "  $0 clone spring-projects/spring-boot"
    echo "  $0 clone bby-corp/mp-return-consumer"
    echo "  $0 find RestController.java"
    echo "  $0 view spring-boot/src/main/java/.../RestController.java"
    echo "  $0 workflow apache/kafka KafkaConsumer.java"
    echo ""
    echo "Environment:"
    echo "  GIAM_HOST           - GIAM server hostname (default: giam.tools.bestbuy.com)"
    echo "  GIAM_ROLE           - GIAM role to assume (default: org-read)"
    echo "  EXTERNAL_REPO_DIR   - Directory to clone into (default: /tmp)"
    echo ""
    echo "Authentication (in order of preference):"
    echo "  1. GIAM_TOKEN env var   - Pre-configured in GitHub Actions workflows"
    echo "  2. GitHub Actions OIDC  - Automatic when ACTIONS_ID_TOKEN_REQUEST_URL is set"
    echo "     Requires: id-token: write permission in the workflow job"
    echo "  3. gh CLI               - Run 'gh auth login' locally"
    echo "  4. Public repos only    - No authentication (unauthenticated fallback)"
}

# --- Helpers ---

err()         { echo -e "${RED}\u274c $*${NC}" >&2; return 1; }  # soft error (return, not exit — allows fallback)
die()         { echo -e "${RED}\u274c $*${NC}" >&2; exit 1; }    # hard error (exit immediately)
warn()        { echo -e "${YELLOW}\u26a0\ufe0f  $*${NC}"; }
info()        { echo -e "${BLUE}$*${NC}"; }
success()     { echo -e "${GREEN}\u2713 $*${NC}"; }
require_arg() { [ -n "$1" ] || { echo -e "${RED}\u274c $2${NC}" >&2; echo "Usage: $0 $3" >&2; exit 1; }; }

# Run a git clone/pull using gh CLI with an explicit token.
# gh handles credential setup internally — no tempfiles, no GIT_ASKPASS needed.
gh_clone() { GH_TOKEN="$RESOLVED_TOKEN" gh repo clone "$@"; }
gh_pull()  { GH_TOKEN="$RESOLVED_TOKEN" gh repo sync "$@" 2>/dev/null || \
             GH_TOKEN="$RESOLVED_TOKEN" git -C "$1" pull; }

# Validate that GIAM_HOST is a trusted bestbuy.com domain (prevents open-redirect of OIDC token)
validate_giam_host() {
    [[ "$GIAM_HOST" =~ ^[a-zA-Z0-9._-]+\.bestbuy\.com$ ]] || \
        err "GIAM_HOST '${GIAM_HOST}' is not a trusted *.bestbuy.com hostname\n   Set GIAM_HOST to a valid bestbuy.com subdomain (e.g. giam.tools.bestbuy.com)"
}

# Validate repo argument is in safe owner/repo format (prevents URL injection)
validate_repo() {
    [[ "$1" =~ ^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$ ]] || \
        err "Invalid repository format: '$1'\n   Expected format: owner/repo (e.g. bby-corp/my-service)"
}

# Create a GIT_ASKPASS helper script that handles username/password prompts correctly.
# Returns the script path. Token is passed via GIT_CREDENTIAL_TOKEN env var (not embedded).
create_askpass_script() {
    local script_path
    script_path=$(mktemp)
    # Set restrictive permissions before writing any secrets
    chmod 600 "$script_path"
    cat > "$script_path" << 'EOF'
#!/bin/sh
# GIT_ASKPASS helper: return appropriate credential based on git's prompt
case "$1" in
    *Username*|*username*) echo "x-access-token" ;;
    *) echo "$GIT_CREDENTIAL_TOKEN" ;;
esac
EOF
    chmod 700 "$script_path"  # Make executable (still owner-only)
    echo "$script_path"
}

# Fetch a GitHub token from GIAM using GitHub Actions OIDC.
# Mirrors the logic in bby-corp/tplat-gha-configure-github-credentials/index.js:
#   1. Request a GitHub OIDC JWT via ACTIONS_ID_TOKEN_REQUEST_URL
#   2. POST to https://${GIAM_HOST}/v1/ghapi/token with:
#        Authorization: Bearer <oidc_token>
#        Assume-Role: <role>
#   3. Parse the returned {"token": "..."} and export RESOLVED_TOKEN
fetch_giam_token() {
    [ -n "$ACTIONS_ID_TOKEN_REQUEST_URL" ] && [ -n "$ACTIONS_ID_TOKEN_REQUEST_TOKEN" ] || return 1
    command -v jq &>/dev/null || err "'jq' is required for GIAM auth — install: brew install jq (macOS) or apt-get install jq (Linux)"
    validate_giam_host || return 1
    info "🔑 Fetching GIAM token via GitHub OIDC (role: ${GIAM_ROLE})..."
    local oidc_token
    oidc_token=$(curl -sf -H "Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
        "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${GIAM_HOST}" | jq -r '.value // empty') \
        || err "Failed to fetch GitHub OIDC token"
    [ -n "$oidc_token" ] || err "OIDC token response did not contain a value"
    local token
    token=$(curl -sf -X POST \
        -H "Authorization: Bearer ${oidc_token}" \
        -H "Assume-Role: ${GIAM_ROLE}" \
        -H "Content-Type: application/json" \
        "https://${GIAM_HOST}/v1/ghapi/token" | jq -r '.token // empty') \
        || err "GIAM token request failed (host: ${GIAM_HOST}, role: ${GIAM_ROLE})"
    [ -n "$token" ] || err "GIAM response did not contain a token"
    RESOLVED_TOKEN="$token"
    success "GIAM token acquired (TTL: ~60 min)"
}

check_auth() {
    # Priority 1: GIAM_TOKEN environment variable (pre-fetched token in GitHub Actions)
    if [ -n "$GIAM_TOKEN" ]; then
        RESOLVED_TOKEN="$GIAM_TOKEN"
        success "Using GIAM_TOKEN from environment"
        return 0
    fi
    # Priority 2: Fetch GIAM token via GitHub OIDC (if available)
    if fetch_giam_token; then return 0; fi
    # Priority 3: Fall back to gh CLI token
    if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
        RESOLVED_TOKEN=$(gh auth token 2>/dev/null || true)
        [ -n "$RESOLVED_TOKEN" ] && { success "Using gh CLI authentication"; return 0; }
    fi
    warn "No authentication available - can only clone public repositories"
    warn "In GitHub Actions: ensure 'id-token: write' permission is set"
    warn "Locally: run 'gh auth login'"
    return 1
}

clone_repo() {
    require_arg "$1" "Repository not specified" "clone <org/repo>"
    local repo="$1"
    validate_repo "$repo" || die "Invalid repository: $repo"
    
    local target_dir="${CLONE_DIR}/$(basename "$repo")"
    local askpass_script=""
    
    # Ensure cleanup of askpass script even if git commands fail (due to set -e)
    cleanup_askpass() {
        [ -n "$askpass_script" ] && rm -f "$askpass_script"
    }
    trap cleanup_askpass RETURN
    
    # If repo already exists, pull latest
    if [ -d "$target_dir/.git" ]; then
        warn "Repository already exists at $target_dir — pulling latest..."
        if [ -n "$RESOLVED_TOKEN" ]; then
            # Use GIT_ASKPASS for pulls; capture stderr so we can surface failures before fallback
            local pull_output
            askpass_script=$(create_askpass_script)
            
            if ! pull_output=$(GIT_CREDENTIAL_TOKEN="$RESOLVED_TOKEN" GIT_ASKPASS="$askpass_script" git -C "$target_dir" pull 2>&1); then
                warn "Authenticated git pull failed — falling back to fresh clone"
                echo "$pull_output" >&2
                # Fallback: fresh clone using GIT_ASKPASS to avoid token in .git/config
                if GIT_CREDENTIAL_TOKEN="$RESOLVED_TOKEN" GIT_ASKPASS="$askpass_script" git clone "https://github.com/${repo}.git" "${target_dir}.tmp"; then
                    rm -rf "$target_dir" && mv "${target_dir}.tmp" "$target_dir"
                else
                    # Fallback clone failed - clean up and abort
                    rm -rf "${target_dir}.tmp"
                    die "Failed to pull or clone repository: $repo"
                fi
            fi
        else
            git -C "$target_dir" pull || die "Failed to pull repository: $repo"
        fi
        success "Updated: $target_dir"
        echo "$target_dir"
        return 0
    fi
    
    # Clone fresh repository
    info "📦 Cloning $repo to $target_dir..."
    if [ -n "$RESOLVED_TOKEN" ]; then
        # Use GIT_ASKPASS for auth to avoid token leakage in .git/config
        askpass_script=$(create_askpass_script)
        GIT_CREDENTIAL_TOKEN="$RESOLVED_TOKEN" GIT_ASKPASS="$askpass_script" git clone "https://github.com/${repo}.git" "$target_dir"
    else
        warn "No authentication — attempting public clone"
        git clone "https://github.com/${repo}.git" "$target_dir"
    fi
    success "Cloned: $target_dir"
    echo "$target_dir"
}

find_file() {
    require_arg "$1" "Filename not specified" "find <filename>"
    local filename="$1"
    info "🔍 Searching for $filename in $CLONE_DIR..."
    local results
    results=$(find "$CLONE_DIR" -name "$filename" -type f 2>/dev/null)
    if [ -z "$results" ]; then
        warn "No exact match found — trying partial match..."
        results=$(find "$CLONE_DIR" -name "*$filename*" -type f 2>/dev/null | head -20)
    fi
    [ -n "$results" ] || die "File not found: $filename\nTry a broader pattern or check the repo is cloned"
    success "Found:"
    echo "$results"
}

view_file() {
    require_arg "$1" "Filepath not specified" "view <filepath>"
    local filepath="$1"
    [[ "$filepath" = /* ]] || filepath="$CLONE_DIR/$filepath"
    [ -f "$filepath" ] || die "File not found: $filepath"
    info "📄 Contents of $filepath:"
    echo "─────────────────────────────────────────────────────────"
    cat "$filepath"
    echo ""
    echo "─────────────────────────────────────────────────────────"
    success "End of file"
}

workflow() {
    require_arg "$1" "Repository and filename required" "workflow <org/repo> <filename>"
    require_arg "$2" "Filename required" "workflow <org/repo> <filename>"
    local repo="$1" filename="$2"
    info "🚀 Starting repository exploration workflow..."
    echo ""
    info "Step 1: Clone repository"
    clone_repo "$repo"
    echo ""
    info "Step 2: Find file"
    local found_files
    found_files=$(find "$CLONE_DIR/$(basename "$repo")" -name "$filename" -type f 2>/dev/null | head -1)
    if [ -z "$found_files" ]; then
        warn "Exact match not found — searching broadly..."
        found_files=$(find "$CLONE_DIR/$(basename "$repo")" -name "*${filename%.*}*" -type f 2>/dev/null | head -5)
        echo "Possible matches:"; echo "$found_files"
        echo ""
        warn "Run 'view' with the correct path to inspect a file"
        return 0
    fi
    success "Found: $found_files"
    echo ""
    info "Step 3: View contents"
    view_file "$found_files"
    echo ""
    success "✅ Repository exploration workflow complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Analyze the code structure and patterns"
    echo "  2. Identify relevant implementations for your use case"
    echo "  3. Adapt patterns to your specific requirements"
    echo "  4. Document the source repository in your commits"
}

# Main
case "$1" in
    clone)
        check_auth || true  # Continue even if no auth (for public repos)
        clone_repo "$2"
        ;;
    find)
        find_file "$2"
        ;;
    view)
        view_file "$2"
        ;;
    workflow)
        check_auth || true  # Continue even if no auth (for public repos)
        workflow "$2" "$3"
        ;;
    -h|--help|help)
        print_usage
        ;;
    *)
        echo -e "${RED}❌ Unknown command: $1${NC}"
        echo ""
        print_usage
        exit 1
        ;;
esac
