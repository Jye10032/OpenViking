FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The demo marker is public. No real credentials are accepted as build args.
RUN VITE_OV_PUBLIC_DEMO=true npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node script/public-demo-server.mjs ./script/public-demo-server.mjs
USER node
EXPOSE 8080
CMD ["node", "script/public-demo-server.mjs"]
