import sqlite3
db = r"C:\code\Chat-Codex\cloned-profile-full\Default\Network\Cookies"
conn = sqlite3.connect(db)
c = conn.cursor()
c.execute("SELECT count(*) FROM cookies")
print("Cookies count:", c.fetchone()[0])
c.execute("SELECT name FROM cookies WHERE host_key LIKE '%chatgpt%' AND name LIKE '%session-token%'")
print("Session tokens:", c.fetchall())
