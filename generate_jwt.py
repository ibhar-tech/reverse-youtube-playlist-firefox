import os, time, hmac, hashlib, base64, json, secrets

key = None
secret = None
with open(".env", "r") as f:
    for line in f:
        if "=" in line:
            k, v = line.strip().split("=", 1)
            if k == "AMO_JWT_ISSUER": key = v
            elif k == "AMO_JWT_SECRET": secret = v

now = int(time.time())
header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
payload = base64.urlsafe_b64encode(json.dumps({"iss": key, "jti": secrets.token_hex(16), "iat": now, "exp": now + 300}).encode()).rstrip(b"=").decode()
signing_input = f"{header}.{payload}".encode()
sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
print(f"{header}.{payload}.{sig_b64}")
