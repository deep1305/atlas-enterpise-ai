# ---------- Stage 1: install dependencies with uv (exact versions from uv.lock) ----------
FROM python:3.13-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.7.8 /uv /bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /srv
COPY pyproject.toml uv.lock ./
# --locked fails the build if uv.lock is out of date with pyproject.toml
RUN uv sync --locked --no-dev --no-install-project


# ---------- Stage 2: small runtime image ----------
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

RUN useradd --system --uid 10001 --no-create-home atlas

WORKDIR /srv
COPY --from=builder /opt/venv /opt/venv
COPY --chown=atlas:atlas app ./app
COPY --chown=atlas:atlas worker ./worker

USER atlas
EXPOSE 8000

# Liveness only (no DB call), so the container isn't marked unhealthy during a DB blip
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/live', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
