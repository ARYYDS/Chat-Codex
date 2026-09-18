import json
import base64
import sqlite3
import ctypes
from ctypes import wintypes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# DPAPI decryption
class DATA_BLOB(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_byte))]

def dpapi_decrypt(encrypted_bytes):
    blob_in = DATA_BLOB(len(encrypted_bytes), ctypes.cast(ctypes.create_string_buffer(encrypted_bytes), ctypes.POINTER(ctypes.c_byte)))
    blob_out = DATA_BLOB()
    if ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
        cb = blob_out.cbData
        pb = blob_out.pbData
        buffer = ctypes.string_at(pb, cb)
        ctypes.windll.kernel32.LocalFree(pb)
        return buffer
    else:
        raise Exception("CryptUnprotectData failed")

# 1. Read Local State
with open(r"C:\code\Chat-Codex\inspect_live\Local State", "r", encoding="utf-8") as f:
    local_state = json.load(f)

encrypted_key_b64 = local_state["os_crypt"]["encrypted_key"]
encrypted_key = base64.b64decode(encrypted_key_b64)
# Strip DPAPI prefix (first 5 bytes 'DPAPI')
master_key = dpapi_decrypt(encrypted_key[5:])
print(f"Master key recovered: {len(master_key)} bytes")

# 2. Decrypt ChatGPT cookie
db = r"C:\code\Chat-Codex\inspect_live\Cookies"
conn = sqlite3.connect(db)
cursor = conn.cursor()
cursor.execute("SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%chatgpt.com%' AND name LIKE '%session-token%'")
row = cursor.fetchone()
if row:
    name, enc_val = row
    print(f"Cookie: {name}, encrypted length: {len(enc_val)}, prefix: {enc_val[:3]}")
    if enc_val[:3] == b'v10':
        nonce = enc_val[3:15]
        ciphertext = enc_val[15:]
        aesgcm = AESGCM(master_key)
        decrypted = aesgcm.decrypt(nonce, ciphertext, None)
        print(f"SUCCESS! Decrypted {name}: {decrypted[:50]}... (Total {len(decrypted)} chars)")
    elif enc_val[:3] == b'v20':
        print("Detected v20 (App-Bound Encryption). Testing v20 decryption...")
    else:
        print(f"Unknown prefix: {enc_val[:3]}")
else:
    print("Cookie not found")
