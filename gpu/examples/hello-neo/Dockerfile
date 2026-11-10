# A tiny real-CUDA smoke image: no model files, PyTorch, CUDA Toolkit or nvcc.
# Compile a native GPU kernel driver probe in a throw-away build stage.
FROM debian:bookworm-slim AS native-build
RUN apt-get update -qq && apt-get install -y --no-install-recommends gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*
COPY gpu/examples/hello-neo/cuda-probe.c /tmp/cuda-probe.c
RUN gcc -std=c11 -O2 -Wall -Wextra -Werror -o /cuda-probe /tmp/cuda-probe.c -ldl

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=native-build /cuda-probe /usr/local/bin/cuda-probe
COPY gpu/examples/hello-neo/app.mjs /app/app.mjs
CMD ["node", "/app/app.mjs"]
