#!/usr/bin/env bash
# Run against a dedicated emulator; installs the preview APK without clearing data.
# Usage: bash test/android-launch.sh [APK path] [diagnostics directory]
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
apk=${1:-"$script_dir/../app/build/outputs/apk/release/app-release.apk"}
artifacts=${2:-"$script_dir/../android-launch-results"}
package=app.samt.android
activity="$package/.MainActivity"
remote_xml=/sdcard/samt-launch-window.xml

for tool in adb timeout python3; do
    command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
[[ -f "$apk" ]] || { echo "APK not found: $apk" >&2; exit 1; }
mkdir -p "$artifacts"

fail() { echo "Android launch smoke failed: $*" >&2; exit 1; }
device() { timeout 15s adb "$@"; }
pid() { device shell pidof "$package" 2>/dev/null | tr -d '\r'; }

capture() {
    local result=$?
    trap - EXIT
    set +e
    timeout 10s adb logcat -d -v threadtime > "$artifacts/logcat.txt" 2>&1
    timeout 10s adb shell dumpsys activity activities > "$artifacts/activities.txt" 2>&1
    timeout 10s adb shell dumpsys window windows > "$artifacts/windows.txt" 2>&1
    timeout 10s adb shell dumpsys webviewupdate > "$artifacts/webview-provider.txt" 2>&1
    timeout 10s adb exec-out screencap -p > "$artifacts/screen.png" 2>/dev/null
    if [[ $result -ne 0 ]]; then
        echo "Launch diagnostics: $artifacts" >&2
        grep -E -A 30 'FATAL EXCEPTION|Process: app\.samt\.android|chromium.*(ERROR|Uncaught)|WebViewFactory' "$artifacts/logcat.txt" >&2 || true
        tail -n 100 "$artifacts/logcat.txt" >&2
    fi
    exit "$result"
}
trap capture EXIT

timeout 45s adb wait-for-device
device shell getprop ro.build.version.sdk > "$artifacts/api-level.txt"
device shell getprop ro.build.fingerprint > "$artifacts/device.txt"
timeout 60s adb install -r "$apk" > "$artifacts/install.txt" 2>&1
device shell am force-stop "$package"
device shell input keyevent KEYCODE_WAKEUP
device shell wm dismiss-keyguard >/dev/null 2>&1 || true
# Older emulator images can refuse log-buffer clearing; it is optional.
device logcat -c >/dev/null 2>&1 || true
timeout 45s adb shell am start -W -n "$activity" > "$artifacts/start.txt" 2>&1
if grep -Eq 'Error:|Exception|Status: timeout' "$artifacts/start.txt"; then
    cat "$artifacts/start.txt" >&2
    fail "MainActivity did not start."
fi

app_pid=$(pid) || fail "The app process exited during startup."
[[ -n "$app_pid" ]] || fail "The app process exited during startup."
printf '%s\n' "$app_pid" > "$artifacts/pid.txt"

# A live process alone also passes a blank WebView. Require the rendered home
# screen from the real WebView accessibility tree, not native Activity metadata.
deadline=$((SECONDS + 60))
rendered=false
while (( SECONDS < deadline )); do
    current_pid=$(pid) || fail "The app process exited before rendering Today."
    [[ "$current_pid" == "$app_pid" ]] || fail "The app process restarted before rendering Today."
    if timeout 8s adb shell uiautomator dump "$remote_xml" > "$artifacts/uiautomator.txt" 2>&1 &&
       device exec-out cat "$remote_xml" > "$artifacts/window.xml" 2>/dev/null &&
       python3 - "$artifacts/window.xml" "$package" <<'PY'
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
package = sys.argv[2]
webviews = [node for node in root.iter("node")
            if node.get("class") == "android.webkit.WebView"
            and node.get("package") == package]
visible = any(node.get("text") == "Today" or node.get("content-desc") == "Today"
              for webview in webviews for node in webview.iter("node"))
sys.exit(0 if visible else 1)
PY
    then
        rendered=true
        break
    fi
    sleep 1
done
[[ "$rendered" == true ]] || fail "Today did not render in the WebView within 60 seconds."

# Keep observing after rendering: startup crashes can occur in native bridge
# callbacks after the first frame. An automatic process restart is also failure.
for ((second=0; second<10; second++)); do
    sleep 1
    current_pid=$(pid) || fail "The app process exited after rendering Today."
    [[ "$current_pid" == "$app_pid" ]] || fail "The app process restarted after rendering Today."
done
device shell dumpsys activity activities > "$artifacts/foreground.txt"
grep -Eq 'mResumedActivity:.*app\.samt\.android/\.MainActivity|topResumedActivity=.*app\.samt\.android/\.MainActivity' \
    "$artifacts/foreground.txt" || fail "MainActivity is no longer in the foreground."

echo "Android launch smoke passed: Today rendered and MainActivity stayed alive (PID $app_pid)."
