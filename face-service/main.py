"""
PQ-ZKVote Face Recognition Service
FastAPI microservice for FaceNet-based face enrollment and recognition.
Runs on port 8000, communicates with Registrar and Client.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import enroll
from core.facenet_model import get_model, warmup_models
from core.detection import warmup_detection

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger("face-service")


# ---------------------------------------------------------------------------
# Lifespan: warm up FaceNet model on startup (MTCNN lazy-loads on first request)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🔄 Loading FaceNet model (quantized)…")
    warmup_models()
    logger.info("✅ Face service ready")
    yield
    logger.info("👋 Face service shutting down")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="PQ-ZKVote Face Service",
    description="FaceNet-based face enrollment and recognition for PQ-ZKVote",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow requests from Registrar backend, Admin/Voter client servers
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",   # Voter / Client frontend
        "http://localhost:4000",   # Registrar backend
        "http://localhost:5000",   # Node.js backend
        "http://localhost:5173",   # Vite dev server
        "http://localhost:4173",   # Vite preview
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import os
from fastapi import Request, HTTPException, status, Depends
from fastapi.security import APIKeyHeader

INTERNAL_SERVICE_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "pqzkvote_face_service_secret_2026")
api_key_header = APIKeyHeader(name="X-Internal-Secret", auto_error=False)


async def verify_internal_secret(request: Request, key: str = Depends(api_key_header)):
    if request.url.path in ["/", "/health", "/docs", "/openapi.json"]:
        return key
    if INTERNAL_SERVICE_SECRET == "off":
        return key
    if not key or key != INTERNAL_SERVICE_SECRET:
        logger.warning(f"Unauthorized service attempt to {request.url.path}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized service-to-service request. Invalid or missing X-Internal-Secret header.",
        )
    return key


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
from routers import enroll, verify

app.include_router(enroll.router, prefix="/face", tags=["enrollment"], dependencies=[Depends(verify_internal_secret)])
app.include_router(verify.router, prefix="/face", tags=["verification"], dependencies=[Depends(verify_internal_secret)])


@app.get("/", tags=["Health"])
def health():
    return {"status": "ok", "service": "PQ-ZKVote Face Service", "version": "1.0.0"}


@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=True)
