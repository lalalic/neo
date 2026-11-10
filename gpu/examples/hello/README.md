# Example Neo GPU service

The Dockerfile declares a command. It reads `/neo/input/message.txt` and writes
`/neo/output/result.txt`. Neo supplies the Node HTTP runtime when building the
service image; the project does not implement an HTTP server.

    neo compute build --dockerfile gpu/examples/hello/Dockerfile --dry-run
    neo compute run --image ghcr.io/OWNER/IMAGE:TAG --provider hf \
      --input message.txt=message.txt --output result.txt=result.txt --allow-spend --allow-upload

Input/output option names map to literal basenames; to preserve extensions use
`message.txt=...` and `result.txt=...`. Example images can be CPU-only, but
GPU Providers will still charge for the selected machine. Testing via the
local HTTP runtime is free.
