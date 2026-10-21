# The CADence server: docker build -f server/Dockerfile -t cadence-server . (from the repository)
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.server.json ./
COPY tools/server tools/server
COPY server server
COPY src/core/contracts src/core/contracts
RUN node tools/server/build.mjs

FROM node:24-alpine
# Projects are git repositories, served with git's own http-backend.
RUN apk add --no-cache git
WORKDIR /app
COPY --from=build /app/dist/server/server.mjs ./server.mjs
ENV CADENCE_DATA=/data PORT=8787
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "server.mjs"]
