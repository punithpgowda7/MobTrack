path = 'modules/fake-shutdown/android/src/main/java/expo/modules/fakeshutdown/FakeShutdownModule.kt'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

imports = '''
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
'''

if 'import android.content.BroadcastReceiver' not in content:
    content = content.replace('import android.content.Intent', 'import android.content.Intent' + imports)

# Remove the trailing literal '\n    }\n}'
content = content.replace('\\n    }\\n}', '\\n    }\\n}')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
