FROM nginx:alpine

COPY dashboard/index.html /usr/share/nginx/html/index.html
COPY dashboard/styles.css /usr/share/nginx/html/styles.css
COPY dashboard/app.js /usr/share/nginx/html/app.js

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1