import sqlite3
db = r"C:\code\Chat-Codex\inspect_live\Cookies"
conn = sqlite3.connect(db)
cursor = conn.cursor()
cursor.execute("SELECT name, substr(encrypted_value, 1, 3) FROM cookies WHERE host_key LIKE '%chatgpt.com%' AND name LIKE '%session-token%'")
for r in cursor.fetchall():
    print(r)
