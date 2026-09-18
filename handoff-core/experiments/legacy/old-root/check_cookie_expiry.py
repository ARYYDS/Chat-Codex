import sqlite3
from datetime import datetime, timezone

db = r"C:\code\Chat-Codex\inspect_live\Cookies"
conn = sqlite3.connect(db)
cursor = conn.cursor()
cursor.execute("SELECT host_key, name, expires_utc FROM cookies WHERE host_key LIKE '%chatgpt.com%' AND name LIKE '%session-token%'")
for r in cursor.fetchall():
    host, name, exp = r
    # Chromium epoch is 1601-01-01
    # Unix epoch is 1970-01-01 (11644473600 seconds difference)
    unix_ts = (exp / 1_000_000) - 11644473600
    exp_dt = datetime.fromtimestamp(unix_ts, tz=timezone.utc)
    print(f"{host} {name}: expires at {exp_dt} UTC (Current time: {datetime.now(timezone.utc)})")
