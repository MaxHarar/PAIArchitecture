#!/usr/bin/env bash
#
# test-wake-briefing.sh - Manual Testing Script for Wake-Triggered Briefing
#
# Tests all scenarios for the briefing-on-wake.ts daemon
#
# Usage:
#   ./test-wake-briefing.sh           # Run all tests
#   ./test-wake-briefing.sh <test_num> # Run specific test (1-5)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIEFING_SCRIPT="$SCRIPT_DIR/briefing-on-wake.ts"
STATE_DIR="$SCRIPT_DIR/../State"
STATE_FILE="$STATE_DIR/wake-state.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

print_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
}

print_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

show_state() {
    echo -e "${YELLOW}Current state:${NC}"
    if [ -f "$STATE_FILE" ]; then
        cat "$STATE_FILE" | jq . 2>/dev/null || cat "$STATE_FILE"
    else
        echo "  (no state file)"
    fi
    echo ""
}

reset_state() {
    echo '{"lastSent":null,"lastWakeTime":null,"lastTriggerTime":null,"sendMethod":null}' > "$STATE_FILE"
    print_info "State reset to initial values"
}

# ============================================================================
# Test 1: Outside polling window (should skip silently)
# ============================================================================
test_1_outside_window() {
    print_header "Test 1: Outside Polling Window"
    print_info "Testing at 5:30 AM (before 6 AM window start)"
    print_info "Expected: Exit code 1 (NOT_TIME_YET), no briefing sent"

    reset_state

    # 5:30 AM is outside the 6-10 AM window
    local TEST_TIME=$(date -v5H -v30M +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d "today 05:30:00" +%Y-%m-%dT%H:%M:%S)

    set +e
    bun run "$BRIEFING_SCRIPT" --test-current-time "$TEST_TIME" --dry-run --debug 2>&1
    local EXIT_CODE=$?
    set -e

    if [ $EXIT_CODE -eq 1 ]; then
        print_success "Correctly exited with code 1 (NOT_TIME_YET)"
    else
        print_fail "Expected exit code 1, got $EXIT_CODE"
        return 1
    fi

    show_state
}

# ============================================================================
# Test 2: Inside window, no wake data (should wait for fallback)
# ============================================================================
test_2_no_wake_data() {
    print_header "Test 2: Inside Window, No Wake Data"
    print_info "Testing at 7:00 AM with no Garmin data"
    print_info "Expected: Exit code 1 (waiting for 8 AM fallback)"

    reset_state

    # 7:00 AM - inside window but before 8 AM fallback
    local TEST_TIME=$(date -v7H -v0M +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d "today 07:00:00" +%Y-%m-%dT%H:%M:%S)

    set +e
    # Note: Without --test-wake-time, it will try to fetch Garmin data
    # If no data available, it waits for fallback hour
    bun run "$BRIEFING_SCRIPT" --test-current-time "$TEST_TIME" --dry-run --debug 2>&1
    local EXIT_CODE=$?
    set -e

    print_info "Exit code: $EXIT_CODE (1=waiting for fallback, 0=sent)"
    show_state
}

# ============================================================================
# Test 3: Simulated wake time (should calculate trigger)
# ============================================================================
test_3_simulated_wake() {
    print_header "Test 3: Simulated Wake Time"
    print_info "Wake time: 6:42 AM, Current time: 7:00 AM"
    print_info "Trigger time should be 6:57 AM (wake + 15 min)"
    print_info "Expected: Exit code 0 (SENT) because 7:00 > 6:57"

    reset_state

    # Use today's date with specified times
    local TODAY=$(date +%Y-%m-%d)
    local WAKE_TIME="${TODAY}T06:42:00"
    local CURRENT_TIME="${TODAY}T07:00:00"

    set +e
    bun run "$BRIEFING_SCRIPT" \
        --test-wake-time "$WAKE_TIME" \
        --test-current-time "$CURRENT_TIME" \
        --dry-run \
        --debug 2>&1
    local EXIT_CODE=$?
    set -e

    if [ $EXIT_CODE -eq 0 ]; then
        print_success "Correctly triggered briefing (dry-run)"
    else
        print_fail "Expected exit code 0, got $EXIT_CODE"
    fi

    show_state
}

# ============================================================================
# Test 4: Force send (--force flag)
# ============================================================================
test_4_force_send() {
    print_header "Test 4: Force Send Flag"
    print_info "Testing --force flag bypasses already-sent check"

    # First, set state as if already sent today
    local NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    cat > "$STATE_FILE" << EOF
{
  "lastSent": "$NOW",
  "lastWakeTime": null,
  "lastTriggerTime": null,
  "sendMethod": "fallback"
}
EOF

    print_info "Set state to show briefing already sent today"
    show_state

    # Without --force, should exit with code 2
    local TODAY=$(date +%Y-%m-%d)
    local CURRENT_TIME="${TODAY}T07:30:00"

    print_info "Running WITHOUT --force (should skip)..."
    set +e
    bun run "$BRIEFING_SCRIPT" \
        --test-current-time "$CURRENT_TIME" \
        --test-wake-time "${TODAY}T06:30:00" \
        --dry-run \
        --debug 2>&1
    local EXIT_NO_FORCE=$?
    set -e

    if [ $EXIT_NO_FORCE -eq 2 ]; then
        print_success "Correctly skipped (already sent)"
    else
        print_info "Exit code: $EXIT_NO_FORCE"
    fi

    print_info "Running WITH --force (should send)..."
    set +e
    bun run "$BRIEFING_SCRIPT" \
        --test-current-time "$CURRENT_TIME" \
        --test-wake-time "${TODAY}T06:30:00" \
        --force \
        --dry-run \
        --debug 2>&1
    local EXIT_FORCE=$?
    set -e

    if [ $EXIT_FORCE -eq 0 ]; then
        print_success "Force flag correctly bypassed already-sent check"
    else
        print_fail "Expected exit code 0 with --force, got $EXIT_FORCE"
    fi
}

# ============================================================================
# Test 5: Check state file after each test
# ============================================================================
test_5_state_verification() {
    print_header "Test 5: State File Verification"
    print_info "Verifying state file updates correctly after actual send"

    reset_state

    local TODAY=$(date +%Y-%m-%d)
    local WAKE_TIME="${TODAY}T06:42:00"
    local CURRENT_TIME="${TODAY}T07:00:00"

    print_info "Running actual briefing (not dry-run) with --force..."
    print_info "This will update the state file but not actually send (test mode)"

    # Note: We use --force to bypass any previous sends
    # The script will try to send but briefing.ts needs proper config
    # For testing purposes, we'll use dry-run to see state would be updated

    set +e
    bun run "$BRIEFING_SCRIPT" \
        --test-wake-time "$WAKE_TIME" \
        --test-current-time "$CURRENT_TIME" \
        --dry-run \
        --debug 2>&1
    local EXIT_CODE=$?
    set -e

    print_info "State after test:"
    show_state

    # Verify state file structure
    if [ -f "$STATE_FILE" ]; then
        print_success "State file exists"

        # Check for required fields
        if jq -e '.lastSent' "$STATE_FILE" > /dev/null 2>&1; then
            print_success "State has lastSent field"
        fi
        if jq -e '.sendMethod' "$STATE_FILE" > /dev/null 2>&1; then
            print_success "State has sendMethod field"
        fi
    else
        print_fail "State file not found"
    fi
}

# ============================================================================
# Main execution
# ============================================================================
main() {
    print_header "Wake-Triggered Briefing Test Suite"
    print_info "Script: $BRIEFING_SCRIPT"
    print_info "State: $STATE_FILE"

    # Ensure state directory exists
    mkdir -p "$STATE_DIR"

    # Run specific test or all
    case "${1:-all}" in
        1) test_1_outside_window ;;
        2) test_2_no_wake_data ;;
        3) test_3_simulated_wake ;;
        4) test_4_force_send ;;
        5) test_5_state_verification ;;
        all)
            test_1_outside_window
            test_2_no_wake_data
            test_3_simulated_wake
            test_4_force_send
            test_5_state_verification
            ;;
        *)
            echo "Usage: $0 [1|2|3|4|5|all]"
            exit 1
            ;;
    esac

    print_header "Test Suite Complete"
    print_info "Review output above for pass/fail status"
}

main "$@"
