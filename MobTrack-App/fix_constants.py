import re

path = 'modules/fake-shutdown/android/src/main/java/expo/modules/fakeshutdown/FakeShutdownAccessibilityService.kt'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace block
content = content.replace(
    'const val ACTION_UPDATE_SEQUENCE = "$PKG.UPDATE_SEQUENCE"',
    'const val ACTION_UPDATE_SEQUENCE = "$PKG.UPDATE_SEQUENCE"\n        const val ACTION_START_ALARM     = "$PKG.START_ALARM"\n        const val ACTION_STOP_ALARM      = "$PKG.STOP_ALARM"'
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
