# Build stage
FROM node:18-alpine AS build
WORKDIR /app

# Install deps
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Build
COPY . .
RUN npm run build

# Runtime stage
FROM nginx:alpine

# Nginx config for SPA routing
COPY nginx.conf /etc/nginx/nginx.conf

# Static files
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]


