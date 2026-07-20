# --- сборка SPA ---
# --platform=$BUILDPLATFORM: собираем нативно на архитектуре раннера (без QEMU).
# Результат — статика, она архитектуро-независима.
FROM --platform=$BUILDPLATFORM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# --- отдача через nginx ---
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
