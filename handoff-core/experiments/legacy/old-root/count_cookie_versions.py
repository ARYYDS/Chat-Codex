import sqlite3
db = r"C:\code\Chat-Codex\inspect_live\Cookies"
conn = sqlite3.connect(db)
cursor = conn.cursor()
cursor.execute("SELECT substr(encrypted_value, 1, 3), count(*) FROM cookies GROUP BY substr(encrypted_value, 1, 3)")
for r in cursor.fetchall():
    print(r)
