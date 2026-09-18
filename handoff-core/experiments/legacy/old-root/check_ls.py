import json

with open(r"C:\code\Chat-Codex\inspect_live\Local State", "r", encoding="utf-8") as f:
    live_ls = json.load(f)

with open(r"C:\code\Chat-Codex\cloned-profile-slim\Local State", "r", encoding="utf-8") as f:
    slim_ls = json.load(f)

print("Live os_crypt keys:", list(live_ls.get("os_crypt", {}).keys()))
print("Slim os_crypt keys:", list(slim_ls.get("os_crypt", {}).keys()))

print("Live encrypted_key == Slim encrypted_key?", live_ls.get("os_crypt", {}).get("encrypted_key") == slim_ls.get("os_crypt", {}).get("encrypted_key"))
print("Live app_bound_encrypted_key == Slim app_bound_encrypted_key?", live_ls.get("os_crypt", {}).get("app_bound_encrypted_key") == slim_ls.get("os_crypt", {}).get("app_bound_encrypted_key"))
