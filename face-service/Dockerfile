FROM python:3.11-slim

WORKDIR /app

# Install system packages required by OpenCV and Python C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt-get/lists/*

# Optimize C++ and PyTorch CPU thread pools for restricted Render CPU instances
ENV PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    VECLIB_MAXIMUM_THREADS=2 \
    NUMEXPR_NUM_THREADS=2

COPY requirements.txt .

# Upgrade pip and install CPU-only PyTorch to reduce build size and RAM usage on Render
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch torchvision --extra-index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir facenet-pytorch==2.6.0 --no-deps

COPY . .

# Ensure data directory exists
RUN mkdir -p /app/data

# Pre-download FaceNet (vggface2) model weights into the image layer.
# This means the container reads weights from disk at startup instead of
# downloading 107MB over the network, preventing a RAM spike on Render.
RUN python -c "from facenet_pytorch import InceptionResnetV1; InceptionResnetV1(pretrained='vggface2'); print('FaceNet weights cached.')"

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
