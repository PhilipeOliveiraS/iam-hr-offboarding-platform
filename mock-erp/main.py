"""
Enterprise ERP Mock
--------------------
Simula um sistema legado corporativo (estilo Totvs/SAP/Flash) que controla
assentos de licença interna. Não representa nenhuma empresa real — é um
stand-in genérico para "o sistema on-prem que ninguém lembra de desligar
no offboarding".

Propositalmente simples (KISS): estado em JSON local, sem banco próprio.
Isso é um mock de demonstração, não um serviço de produção.
"""
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import json
import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(
    title="Enterprise ERP Mock",
    version="1.0.0",
    description="Simulador de licenciamento corporativo legado (3º conector do IAM-HR).",
)

SEED_PATH = Path(os.getenv("MOCK_ERP_SEED", "./seed.json"))


def _load_state() -> dict:
    if not SEED_PATH.exists():
        raise RuntimeError(f"Seed file not found at {SEED_PATH}")
    with open(SEED_PATH, encoding="utf-8") as f:
        return json.load(f)


def _save_state(state: dict) -> None:
    with open(SEED_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def _find(state: dict, email: str) -> Optional[dict]:
    email_lower = email.strip().lower()
    return next((r for r in state["licenses"] if r["email"].lower() == email_lower), None)


class LicenseRecord(BaseModel):
    email: str
    full_name: str
    license_type: str
    license_status: str
    revoked_at: Optional[str] = None


@app.get("/health")
def health():
    return {"status": "ok", "service": "enterprise-erp-mock"}


@app.get("/licenses/{email}", response_model=LicenseRecord)
def get_license(email: str):
    state = _load_state()
    record = _find(state, email)
    if not record:
        raise HTTPException(status_code=404, detail=f"No license record for {email}")
    return record


@app.post("/licenses/{email}/revoke", response_model=LicenseRecord)
def revoke_license(email: str):
    state = _load_state()
    record = _find(state, email)
    if not record:
        raise HTTPException(status_code=404, detail=f"No license record for {email}")

    record["license_status"] = "REVOKED"
    record["revoked_at"] = datetime.now(timezone.utc).isoformat()
    _save_state(state)
    return record


@app.post("/reset")
def reset_all():
    """Usado pelo workflow de reset agendado do n8n, junto com o reset do Postgres."""
    state = _load_state()
    for record in state["licenses"]:
        record["license_status"] = "ACTIVE"
        record["revoked_at"] = None
    _save_state(state)
    return {"reset": True, "count": len(state["licenses"])}


@app.get("/state")
def get_reset_state():
    records = _load_state()["licenses"]
    return {"reset_baseline": bool(records) and all(r["license_status"] == "ACTIVE" and r.get("revoked_at") is None for r in records)}
