import json

with open(r"C:\code\Chat-Codex\inspect_live\Local State", "r", encoding="utf-8") as f:
    live_ls = json.load(f)

with open(r"C:\code\Chat-Codex\cloned-profile-slim\Local State", "r", encoding="utf-8") as f:
    slim_ls = json.load(f)

live_app_key = live_ls.get("os_crypt", {}).get("app_bound_encrypted_key")
slim_app_key = slim_ls.get("os_crypt", {}).get("app_bound_encrypted_key")

print("Live app_bound_encrypted_key:", live_app_key[:30], "...")
print("Slim app_bound_encrypted_key:", slim_app_key[:30], "...")
print("Equal?:", live_app_key == slim_app_key)
