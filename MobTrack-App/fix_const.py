import re

path = 'modules/fake-shutdown/android/src/main/java/expo/modules/fakeshutdown/FakeShutdownAccessibilityService.kt'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add constants if missing
if 'ACTION_START_ALARM' not in content[:2000]:
    content = content.replace(
        'const val ACTION_HIDE            = "\.HIDE"',
        'const val ACTION_HIDE            = "\.HIDE"\n        const val ACTION_START_ALARM     = "\.START_ALARM"\n        const val ACTION_STOP_ALARM      = "\.STOP_ALARM"'
    )

# Fix trailing syntax error
content = content.rstrip()
if content.endswith('}'):
    pass
if '}\n}' not in content[-10:]:
    content += '\n}'

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
