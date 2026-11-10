# One tiny application Dockerfile used to exercise both Neo GPU batch and web.
# No model downloads, CUDA libraries, or project-specific service wrapper.
FROM node:22-bookworm-slim
WORKDIR /app
COPY gpu/e2e/fixture.mjs /app/fixture.mjs
CMD ["node", "/app/fixture.mjs"]
