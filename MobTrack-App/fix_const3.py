import re

path = 'modules/fake-shutdown/android/src/main/java/expo/modules/fakeshutdown/FakeShutdownAccessibilityService.kt'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# I clearly broke the constants in an earlier pass. Let's fix them manually.
if 'val ACTION_START_ALARM' not in content:
    content = content.replace(
        'const val ACTION_HIDE            = ".HIDE"',
        'const val ACTION_HIDE            = ".HIDE"\n        const val ACTION_START_ALARM     = ".START_ALARM"\n        const val ACTION_STOP_ALARM      = ".STOP_ALARM"'
    )

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
