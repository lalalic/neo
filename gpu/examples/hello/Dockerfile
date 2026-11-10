FROM debian:bookworm-slim
RUN apt-get update -qq && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
CMD ["sh", "-c", "cat \"$NEO_GPU_INPUT_DIR/message.txt\" > \"$NEO_GPU_OUTPUT_DIR/result.txt\""]
