from dataclasses import dataclass
from fastapi import HTTPException
from app.config import settings

@dataclass(frozen=True)
class Principal:
    subject: str = "demo-operator"
    tenant: str = "demo-workspace"
    groups: tuple[str, ...] = ("workspace",)
    admin: bool = True

def principal() -> Principal:
    if not settings().demo_mode:
        raise HTTPException(401, "Authentication is not configured. Set DEMO_MODE=true for local demos only.")
    return Principal()
