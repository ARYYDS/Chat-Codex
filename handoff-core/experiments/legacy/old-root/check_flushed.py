import sqlite3

db = r"C:\code\Chat-Codex\cloned-profile-slim\Default\Network\Cookies"
conn = sqlite3.connect(db)
cursor = conn.cursor()
cursor.execute("SELECT name, substr(encrypted_value, 1, 3) FROM cookies")
rows = cursor.fetchall()
print(f"Total cookies flushed to disk on graceful close: {len(rows)}")
for r in rows:
    print(r)
