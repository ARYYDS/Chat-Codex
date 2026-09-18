import sqlite3

db = r"C:\code\Chat-Codex\inspect_live\Cookies"
conn = sqlite3.connect(db)
cursor = conn.cursor()
cursor.execute("SELECT DISTINCT host_key FROM cookies")
all_hosts = cursor.fetchall()
print(f"Total distinct hosts in LIVE Chrome: {len(all_hosts)}")
for h in all_hosts:
    print(h[0])

cursor.execute("SELECT host_key, name, length(encrypted_value) FROM cookies WHERE host_key LIKE '%chatgpt%' OR host_key LIKE '%openai%' OR host_key LIKE '%claude%'")
for r in cursor.fetchall():
    print(r)
