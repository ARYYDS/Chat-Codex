import sqlite3
conn = sqlite3.connect(r"C:\code\Chat-Codex\cloned-profile-slim\Default\Network\Cookies")
c = conn.cursor()
c.execute("SELECT count(*) FROM cookies")
print("Total cookies in Cookies db right now:", c.fetchone()[0])
c.execute("SELECT name, host_key FROM cookies")
for r in c.fetchall():
    print(r)
