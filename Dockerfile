FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src
COPY scripts ./scripts
COPY config ./config
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

ENV HF_HUB_CACHE=/app/models
ENV PYTHONUNBUFFERED=1

EXPOSE 10000

CMD ["./entrypoint.sh"]
