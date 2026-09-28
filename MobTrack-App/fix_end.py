path = 'modules/fake-shutdown/android/src/main/java/expo/modules/fakeshutdown/FakeShutdownAccessibilityService.kt'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(r'\n}', '\n}')
import re
# Ensure exactly one closing brace at the very end
content = re.sub(r'}\s*}\s*$', '}', content.strip())
content += '\n}'

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
