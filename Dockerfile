# ---- BUILD STAGE ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install

COPY . .
RUN yarn build

# ---- PRODUCTION STAGE ----
FROM node:22-alpine

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --production

COPY --from=builder /app/dist ./dist

CMD ["node", "dist/main.js"]