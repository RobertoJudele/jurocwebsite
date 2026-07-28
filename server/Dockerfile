# ---- Contact form mail service ----
# Plain JS, so there is no build stage to mirror from the trainee API.
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js verify-smtp.js ./

# Run as the unprivileged node user
USER node

EXPOSE 3001

# Compose healthcheck hits /api/health; see docker-compose.juroc-site.yml
CMD ["node", "server.js"]
