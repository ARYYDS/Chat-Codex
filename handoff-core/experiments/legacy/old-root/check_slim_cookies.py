import sqlite3
db = r"C:\code\Chat-Codex\cloned-profile-slim\Default\Network\Cookies"
conn = sqlite3.connect(db)
cursor = conn.cursor()
cursor.execute("SELECT host_key, name FROM cookies WHERE host_key LIKE '%chatgpt%' OR host_key LIKE '%openai%'")
print("Cookies in slim profile:", cursor.fetchall())
