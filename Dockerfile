FROM node:24-bookworm-slim

WORKDIR /app
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production

EXPOSE 8080
CMD ["npm", "start"]
