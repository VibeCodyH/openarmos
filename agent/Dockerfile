# Armos agent — small Node image, runs TS directly via tsx.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src

EXPOSE 8099
CMD ["npx", "tsx", "src/index.ts"]
