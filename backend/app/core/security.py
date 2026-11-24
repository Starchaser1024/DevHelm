from cryptography.fernet import Fernet, InvalidToken


def _derive_fernet_key(secret: str) -> bytes:
    # 将任意长度的应用密钥确定性派生为 Fernet 所需的 32 字节 URL-safe Base64 密钥。
    import base64
    import hashlib

    return base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())


def encrypt_token(token: str, secret: str) -> str:
    return Fernet(_derive_fernet_key(secret)).encrypt(token.encode("utf-8")).decode("utf-8")


def decrypt_token(encrypted: str, secret: str) -> str | None:
    try:
        return Fernet(_derive_fernet_key(secret)).decrypt(encrypted.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None
