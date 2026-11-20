# ==============================================================================
# Nya AI — Production Container Image
# Multi-stage optimized Dockerfile for FastAPI + PyTorch + Sentence-Transformers
# ==============================================================================

FROM python:3.12-slim AS base

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/app/backend" \
    PORT=8000

# Install minimal OS dependencies required for C-extensions, SQLite, and network fetches
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (cached across code changes)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend application code and config
COPY backend/ ./backend/
COPY config/ ./config/
COPY frontend/ ./frontend/

# Ensure persistent data directory exists for SQLite database and uploads
RUN mkdir -p /app/backend/data /app/backend/data/document_cache /app/backend/data/historical_cases

# Set default environment variables
ENV DATABASE_URL="sqlite:////app/backend/data/nya.db" \
    EMBEDDING_PROVIDER="sentence-transformers" \
    EMBEDDING_MODEL="sentence-transformers/all-MiniLM-L6-v2" \
    LLM_PROVIDER="mock" \
    APP_ENV="production"

# Pre-download/cache the embedding model and seed baseline precedents during build
RUN python -c "import sentence_transformers; sentence_transformers.SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')" && \
    cd /app/backend && python -m scripts.seed_historical_cases

# Expose HTTP port
EXPOSE 8000

# Health check to ensure FastAPI is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/ || exit 1

WORKDIR /app/backend

# Run production ASGI server with uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
