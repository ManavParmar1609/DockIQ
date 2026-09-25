# DockIQ API — built by Render (render.yaml) or any container host, from this directory.
# Boot sequence: migrate to head → seed if empty → serve.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app
COPY migrations ./migrations

FROM python:3.12-slim-bookworm
RUN useradd --create-home --uid 10001 dockiq
WORKDIR /app
COPY --from=build --chown=dockiq:dockiq /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production
USER dockiq
EXPOSE 8000
CMD ["sh", "-c", "python -m app.seed && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
