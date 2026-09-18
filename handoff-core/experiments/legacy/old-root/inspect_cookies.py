import sqlite3

db = r"C:\code\Chat-Codex\cloned-profile\Default\Network\Cookies"
conn = sqlite3.connect(db)
cursor = conn.cursor()
cursor.execute('SELECT host_key, name, path, is_secure, is_httponly FROM cookies WHERE host_key LIKE "%openai%" OR host_key LIKE "%chatgpt%"')
rows = cursor.fetchall()
print(f"Total openai/chatgpt cookies in cloned-profile: {len(rows)}")
for r in rows:
    print(r)

cursor.execute("SELECT DISTINCT host_key FROM cookies")
all_hosts = cursor.fetchall()
print(f"\nTotal distinct hosts: {len(all_hosts)}")
for h in all_hosts:
    print(h[0])
