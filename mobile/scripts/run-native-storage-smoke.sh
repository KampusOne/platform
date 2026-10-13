#!/usr/bin/env bash
set -euo pipefail
mkdir -p native-storage-proof
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell pm clear app.kampusone.mobile >/dev/null
for phase in WRITE RESTART; do
  adb shell am force-stop app.kampusone.mobile
  adb shell am start -W -n app.kampusone.mobile/.MainActivity >/dev/null
  success=0
  for attempt in $(seq 1 45); do
    rm -f "native-storage-proof/${phase}.xml"
    adb shell uiautomator dump /sdcard/native-storage-proof.xml >/dev/null 2>&1 || true
    adb pull /sdcard/native-storage-proof.xml "native-storage-proof/${phase}.xml" >/dev/null 2>&1 || true
    if grep -q "NATIVE_STORAGE_${phase}_PASS" "native-storage-proof/${phase}.xml"; then success=1; break; fi
    if grep -q 'NATIVE_STORAGE_FAIL' "native-storage-proof/${phase}.xml"; then break; fi
    # A first-boot Quickstep ANR can cover an already-running smoke app.
    # Dismiss only that named system-launcher dialog; app errors still fail.
    launcher_close=$(python3 - "native-storage-proof/${phase}.xml" <<'PY'
import sys,re,xml.etree.ElementTree as ET
try:
    root=ET.parse(sys.argv[1]).getroot()
    title=next((n.get('text','') for n in root.iter('node') if n.get('resource-id')=='android:id/alertTitle'),'')
    if title=="Quickstep isn't responding":
        close=next(n for n in root.iter('node') if n.get('resource-id')=='android:id/aerr_close')
        x1,y1,x2,y2=map(int,re.findall(r'\d+',close.get('bounds','')))
        print((x1+x2)//2,(y1+y2)//2)
except (OSError,ET.ParseError,StopIteration,ValueError):
    pass
PY
)
    if [ -n "$launcher_close" ]; then
      echo "$phase: dismissed the emulator Quickstep launcher ANR" >> native-storage-proof/system-launcher-dialog.log
      read -r launcher_x launcher_y <<< "$launcher_close"
      adb shell input tap "$launcher_x" "$launcher_y"
      adb shell am start -W -n app.kampusone.mobile/.MainActivity >/dev/null
    fi
    sleep 1
  done
  adb exec-out screencap -p > "native-storage-proof/${phase}.png"
  if [ "$success" != 1 ]; then
    cat "native-storage-proof/${phase}.xml" || true
    adb logcat -d -s ReactNativeJS AndroidRuntime > "native-storage-proof/${phase}-errors.log"
    exit 1
  fi
done
node -e 'require("fs").writeFileSync("native-storage-proof/receipt.json",JSON.stringify({sourceSha:process.env.SOURCE_SHA,androidApi:35,runtime:"Hermes / installed Expo native modules",checks:["reproduced prior Android bridge failure","verified encrypted DM and Kira saves","cold process restart and OS key recovery","account and campus isolation","authenticated corruption rejection and retention"],passed:true},null,2))'
