"""REST de droidbot-push, montado por Hermes en ``/api/plugins/droidbot-push/``.

La auth del dashboard se hereda automáticamente (middleware de sesión antes
del router). El web server importa este archivo por path (no como paquete),
así que arreglamos sys.path y usamos nombres de módulo estables.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Optional

_plugin_parent = str(Path(__file__).resolve().parents[2])
if _plugin_parent not in sys.path:
    sys.path.insert(0, _plugin_parent)

from fastapi import APIRouter, Header, HTTPException  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from droidbot_push import memory, storage, webpush  # noqa: E402

router = APIRouter()


class SubscribeBody(BaseModel):
    endpoint: str
    p256dh: str
    auth: str
    device_id: Optional[str] = None
    device_label: Optional[str] = None
    locale: Optional[str] = None


class PrefsBody(BaseModel):
    profile: str
    termina: Optional[bool] = None
    necesita: Optional[bool] = None


class DeleteBody(BaseModel):
    endpoint: Optional[str] = None
    device_id: Optional[str] = None


class TestBody(BaseModel):
    device_id: Optional[str] = None


def _device_id(x_device_id: Optional[str], fallback: Optional[str] = None) -> Optional[str]:
    value = (x_device_id or "").strip() or (fallback or "").strip()
    return value or None


def _locale(raw: Optional[str]) -> Optional[str]:
    """La suscripción guarda solo 'en' | 'es'; ausente o inválido → 'en'."""
    return raw if raw in ("en", "es") else "en"


@router.get("/vapid-public-key")
def get_vapid_public_key() -> dict[str, str]:
    """Llave pública VAPID (base64url sin padding) para el PushManager."""
    try:
        key = webpush.vapid_public_key()
    except Exception as exc:  # pragma: no cover - la llave se autogenera
        raise HTTPException(status_code=500, detail=f"VAPID no disponible: {exc}") from exc
    if not key:
        raise HTTPException(status_code=503, detail="plugin no inicializado")
    return {"key": key}


@router.post("/subscribe")
def subscribe(body: SubscribeBody, x_device_id: Optional[str] = Header(default=None)) -> dict[str, Any]:
    try:
        storage.upsert_subscription({
            "endpoint": body.endpoint,
            "p256dh": body.p256dh,
            "auth": body.auth,
            "device_id": _device_id(x_device_id, body.device_id),
            "device_label": body.device_label,
            "locale": _locale(body.locale),
        })
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@router.delete("/subscribe")
def unsubscribe(body: DeleteBody, x_device_id: Optional[str] = Header(default=None)) -> dict[str, Any]:
    device = _device_id(x_device_id, body.device_id)
    removed = 0
    for subscription in list(storage.list_subscriptions()):
        if body.endpoint and subscription["endpoint"] == body.endpoint:
            storage.delete_subscription(subscription["endpoint"])
            removed += 1
        elif not body.endpoint and device and subscription.get("device_id") == device:
            storage.delete_subscription(subscription["endpoint"])
            removed += 1
    return {"ok": True, "removed": removed}


@router.get("/prefs")
def get_prefs() -> dict[str, Any]:
    """Todas las preferencias guardadas; el cliente aplica los defaults."""
    return {"prefs": storage.all_prefs()}


@router.put("/prefs")
def put_prefs(body: PrefsBody) -> dict[str, Any]:
    current = storage.get_prefs(body.profile)
    if body.termina is not None:
        current["termina"] = body.termina
    if body.necesita is not None:
        current["necesita"] = body.necesita
    return {"prefs": {body.profile: storage.set_prefs(body.profile, current)}}


@router.post("/test")
def test_push(body: TestBody, x_device_id: Optional[str] = Header(default=None)) -> dict[str, Any]:
    result = webpush.send_test(_device_id(x_device_id, body.device_id))
    if result["sent"] == 0:
        raise HTTPException(status_code=404, detail="no hay suscripciones para este dispositivo")
    return result


# ── memoria por bot (memories/MEMORY.md + USER.md del perfil) ────────────────

class MemoryDeleteBody(BaseModel):
    profile: str
    target: str  # "memory" | "user"
    id: str


@router.get("/memory")
def get_memory(profile: str) -> dict[str, Any]:
    """Entradas de memoria del perfil con ids estables para el borrado."""
    try:
        return memory.read_memory(profile)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"memory read failed: {exc}") from exc


@router.delete("/memory")
def delete_memory(body: MemoryDeleteBody) -> dict[str, Any]:
    """Borra UNA entrada (id = sha1 del texto). Id viejo → 409, no borra nada."""
    try:
        result = memory.delete_entry(body.profile, body.target, body.id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"memory delete failed: {exc}") from exc
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("message", "delete failed"))
    return result
