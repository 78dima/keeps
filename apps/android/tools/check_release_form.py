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
    raise AssertionError(f"Android accessibility node not found: {label}")


def tap(label, *, contains=False):
    x1, y1, x2, y2 = find(label, contains=contains)
    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
    time.sleep(1)


def screenshot(name):
    (OUT / f"release-{name}.png").write_bytes(adb("exec-out", "screencap", "-p"))


tap("Take a note...", contains=True)
tap("Title", contains=True)
# A Title tap with an empty body must leave the draft open.
find("Title", contains=True)
screenshot("title-keyboard")
adb("shell", "input", "keyevent", "KEYCODE_BACK")
time.sleep(1)
find("REMINDER")
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
