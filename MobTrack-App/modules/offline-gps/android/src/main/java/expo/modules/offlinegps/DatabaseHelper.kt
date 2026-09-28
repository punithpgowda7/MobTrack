package expo.modules.offlinegps

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class Breadcrumb(val id: Long, val deviceId: String?, val latitude: Double, val longitude: Double, val timestamp: Long)

class DatabaseHelper(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    companion object {
        private const val DATABASE_VERSION = 4
        private const val DATABASE_NAME = "OfflineGps.db"
        private const val TABLE_NAME = "breadcrumbs"
        private const val COLUMN_ID = "id"
        private const val COLUMN_DEVICE_ID = "device_id"
        private const val COLUMN_LAT = "latitude"
        private const val COLUMN_LNG = "longitude"
        private const val COLUMN_TIME = "timestamp"
    }

    override fun onCreate(db: SQLiteDatabase) {
        val createTable = ("CREATE TABLE " + TABLE_NAME + "("
                + COLUMN_ID + " INTEGER PRIMARY KEY AUTOINCREMENT,"
                + COLUMN_DEVICE_ID + " TEXT,"
                + COLUMN_LAT + " REAL,"
                + COLUMN_LNG + " REAL,"
        + COLUMN_TIME + " INTEGER NOT NULL" + ")")
        db.execSQL(createTable)
        db.execSQL("CREATE TABLE sync_metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // This feature has no destructive schema migrations; retain breadcrumbs.
        if (oldVersion < 2) db.execSQL("UPDATE $TABLE_NAME SET $COLUMN_TIME = 0 WHERE $COLUMN_TIME IS NULL")
        if (oldVersion < 3) db.execSQL("ALTER TABLE $TABLE_NAME ADD COLUMN $COLUMN_DEVICE_ID TEXT")
        if (oldVersion < 4) db.execSQL("CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL)")
    }

    fun addBreadcrumb(deviceId: String?, lat: Double, lng: Double, timestamp: Long) {
        val db = this.writableDatabase
        // Location callbacks can occasionally arrive faster than requested. Keep
        // one point per approximately 15-minute interval in the local queue.
        // Rows are removed after a successful upload, so the queue alone cannot
        // prevent a second callback a few seconds later from being inserted.
        // Keep the last accepted GPS timestamp in durable local metadata.
        var latest = db.rawQuery("SELECT value FROM sync_metadata WHERE key = 'last_recorded_at'", null).use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
        }
        // Preserve the guard for an upgraded install that still has queued rows
        // from the previous database version.
        if (latest == null) {
            latest = db.rawQuery("SELECT MAX($COLUMN_TIME) FROM $TABLE_NAME", null).use { cursor ->
                if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
            }
        }
        if (timestamp <= 0L || (latest != null && (timestamp <= latest || timestamp - latest < 4 * 60 * 1000L + 30 * 1000L))) {
            db.close()
            return
        }
        val values = ContentValues().apply {
            put(COLUMN_DEVICE_ID, deviceId)
            put(COLUMN_LAT, lat)
            put(COLUMN_LNG, lng)
            put(COLUMN_TIME, timestamp)
        }
        val inserted = db.insert(TABLE_NAME, null, values)
        if (inserted != -1L) {
            db.execSQL("INSERT OR REPLACE INTO sync_metadata(key, value) VALUES('last_recorded_at', ?)", arrayOf(timestamp))
        }
        db.close()
    }

    fun getAllBreadcrumbs(): List<Breadcrumb> {
        val breadcrumbs = mutableListOf<Breadcrumb>()
        val db = this.readableDatabase
        val cursor = db.rawQuery("SELECT * FROM $TABLE_NAME ORDER BY $COLUMN_TIME ASC, $COLUMN_ID ASC", null)
        if (cursor.moveToFirst()) {
            do {
                breadcrumbs.add(
                        Breadcrumb(
                        cursor.getLong(cursor.getColumnIndexOrThrow(COLUMN_ID)),
                        cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_DEVICE_ID)),
                        cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_LAT)),
                        cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_LNG)),
                        cursor.getLong(cursor.getColumnIndexOrThrow(COLUMN_TIME))
                    )
                )
            } while (cursor.moveToNext())
        }
        cursor.close()
        db.close()
        return breadcrumbs
    }

    fun deleteBreadcrumbs(ids: List<Long>) {
        if (ids.isEmpty()) return
        val db = this.writableDatabase
        val args = ids.joinToString(",")
        db.execSQL("DELETE FROM $TABLE_NAME WHERE $COLUMN_ID IN ($args)")
        db.close()
    }

    fun getRecentBreadcrumbs(limit: Int = 3): List<Breadcrumb> {
        val breadcrumbs = mutableListOf<Breadcrumb>()
        val db = this.readableDatabase
        val cursor = db.rawQuery("SELECT * FROM $TABLE_NAME ORDER BY $COLUMN_TIME DESC LIMIT ?", arrayOf(limit.toString()))
        if (cursor.moveToFirst()) {
            do {
                breadcrumbs.add(
                    Breadcrumb(
                        cursor.getLong(cursor.getColumnIndexOrThrow(COLUMN_ID)),
                        cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_DEVICE_ID)),
                        cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_LAT)),
                        cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_LNG)),
                        cursor.getLong(cursor.getColumnIndexOrThrow(COLUMN_TIME))
                    )
                )
            } while (cursor.moveToNext())
        }
        cursor.close()
        db.close()
        return breadcrumbs.reversed()
    }
}
