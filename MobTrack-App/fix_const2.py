import re

path = 'modules/fake-shutdown/android/src/main/java/expo/modules/fakeshutdown/FakeShutdownAccessibilityService.kt'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace any escaped constants
content = content.replace('"\.START_ALARM"', '"\.START_ALARM"')
content = content.replace('"\.STOP_ALARM"', '"\.STOP_ALARM"')
# Remove extra brackets at end
content = re.sub(r'}\s*}\s*$', '}', content.strip())

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
