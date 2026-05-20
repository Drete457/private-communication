FROM node:alpine

WORKDIR /app
COPY docker/docker-socket-proxy/proxy.js /app/proxy.js

EXPOSE 2375
CMD ["node", "/app/proxy.js"]