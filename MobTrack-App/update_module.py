import re

def update_module():
    path = 'modules/fake-shutdown/android/src/main/java/expo/modules/fakeshutdown/FakeShutdownModule.kt'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    new_imports = '''import android.content.IntentFilter
import android.content.BroadcastReceiver
import android.content.Context
'''

    if 'android.content.BroadcastReceiver' not in content:
        content = content.replace('import android.content.Intent\\n', 'import android.content.Intent\\n' + new_imports)

    class_start = content.find('class FakeShutdownModule : Module() {')
    if class_start == -1:
        print('Could not find class FakeShutdownModule')
        return

    sim_monitor_code = '''
    private var simMonitorReceiver: BroadcastReceiver? = null

'''
    if 'private var simMonitorReceiver' not in content:
        content = content[:class_start + 37] + sim_monitor_code + content[class_start + 37:]

    # Add the functions inside definition()
    functions_code = '''
        // -- SIM Monitor -------------------------------------------------------
        AsyncFunction("startSimMonitor") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                if (simMonitorReceiver == null) {
                    simMonitorReceiver = object : BroadcastReceiver() {
                        override fun onReceive(context: Context, intent: Intent) {
                            if (intent.action == "android.intent.action.SIM_STATE_CHANGED") {
                                val state = intent.getStringExtra("ss")
                                if (state == "ABSENT") {
                                    val broadcast = Intent(FakeShutdownAccessibilityService.ACTION_START_ALARM).apply {
                                        setPackage(context.packageName)
                                    }
                                    context.sendBroadcast(broadcast)
                                }
                            }
                        }
                    }
                    val filter = IntentFilter("android.intent.action.SIM_STATE_CHANGED")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        ctx.registerReceiver(simMonitorReceiver, filter, Context.RECEIVER_EXPORTED)
                    } else {
                        @Suppress("UnspecifiedRegisterReceiverFlag")
                        ctx.registerReceiver(simMonitorReceiver, filter)
                    }
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_SIM_START", e.message ?: "Failed", e)
            }
        }

        AsyncFunction("stopSimMonitor") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                simMonitorReceiver?.let {
                    ctx.unregisterReceiver(it)
                    simMonitorReceiver = null
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_SIM_STOP", e.message ?: "Failed", e)
            }
        }

        AsyncFunction("startAlarm") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                val broadcast = Intent(FakeShutdownAccessibilityService.ACTION_START_ALARM).apply {
                    setPackage(ctx.packageName)
                }
                ctx.sendBroadcast(broadcast)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_ALARM_START", e.message ?: "Failed", e)
            }
        }

        AsyncFunction("stopAlarm") { promise: Promise ->
            try {
                val ctx = appContext.reactContext ?: throw Exception("React context unavailable")
                val broadcast = Intent(FakeShutdownAccessibilityService.ACTION_STOP_ALARM).apply {
                    setPackage(ctx.packageName)
                }
                ctx.sendBroadcast(broadcast)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERR_ALARM_STOP", e.message ?: "Failed", e)
            }
        }
'''
    if 'startSimMonitor' not in content:
        content = content.rstrip()
        if content.endswith('}'):
            content = content[:-1]
            content = content.rstrip()
            if content.endswith('}'):
                content = content[:-1] + functions_code + '\\n    }\\n}'

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Updated FakeShutdownModule.kt')

update_module()
