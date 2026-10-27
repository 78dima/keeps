#!/usr/bin/env python3
"""Exercise the signed APK through Android's accessibility tree on the CI emulator."""
import pathlib
import re
import subprocess
import time
import xml.etree.ElementTree as ET

OUT = pathlib.Path(__file__).resolve().parents[1] / "dist"


def adb(*args):
    return subprocess.check_output(["adb", *args], timeout=30)


def tree():
    adb("shell", "uiautomator", "dump", "/data/local/tmp/monokeep-release-ui.xml")
    return ET.fromstring(adb("shell", "cat", "/data/local/tmp/monokeep-release-ui.xml"))


def find(label, *, contains=False):
    for _ in range(5):
        matches = []
        for node in tree().iter("node"):
            labels = [node.get("text", "").casefold(), node.get("content-desc", "").casefold()]
            if any(label.casefold() in value if contains else label.casefold() == value for value in labels):
                bounds = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
                if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
                    matches.append(bounds)
        if matches:
            return min(matches, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        time.sleep(1)
    screenshot("ui-failure")
    print(ET.tostring(tree(), encoding="unicode"))
    raise AssertionError(f"Android accessibility node not found: {label}")


def tap_bounds(bounds):
    x1, y1, x2, y2 = bounds
    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
    time.sleep(1)


def tap(label, *, contains=False):
    tap_bounds(find(label, contains=contains))


def form_fields():
    # Flutter sends hints through AccessibilityNodeInfo.hintText, which the
    # Android uiautomator XML dumper omits. The form has Title/body/tag fields;
    # the search field is outside this ScrollView. Do not search hint labels.
    for node in tree().iter("node"):
        if node.get("class") == "android.widget.ScrollView":
            fields = [child for child in node.iter("node") if child.get("class") == "android.widget.EditText"]
            if len(fields) >= 2:
                return fields
    screenshot("ui-failure")
    raise AssertionError("Expanded form fields are missing")


def screenshot(name):
    (OUT / f"release-{name}.png").write_bytes(adb("exec-out", "screencap", "-p"))


tap("Take a note...", contains=True)
screenshot("expanded-keyboard")
fields = form_fields()
assert fields[1].get("focused") == "true", "Body must initially have keyboard focus"
assert fields[0].get("text") == "" and fields[1].get("text") == "", "Draft must be empty"
tap_bounds(list(map(int, re.findall(r"\d+", fields[0].get("bounds", "")))))
# A Title tap with an empty body must leave the draft open.
assert form_fields()[0].get("focused") == "true", "Title must receive focus without closing"
screenshot("title-keyboard")
adb("shell", "input", "keyevent", "KEYCODE_BACK")
time.sleep(1)
find("Select color #f28b82", contains=True)
find("Create")
screenshot("create")
tap("Set date & time")
# These are actual Android dialogs reached from the release Flutter UI.
tap("OK")
screenshot("native-time-picker")
tap("CANCEL")
find("Set date & time")
tap("Close")
find("No notes found")
print("Release form: Title/keyboard, palette/reminder controls, native date/time picker, empty close OK")
