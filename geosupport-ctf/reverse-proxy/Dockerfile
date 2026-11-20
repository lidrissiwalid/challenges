FROM nginx:1.27-alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/nginx.conf

# Pre-create writable directories owned by nginx user
RUN mkdir -p \
    /var/cache/nginx/client_temp \
    /var/cache/nginx/proxy_temp \
    /var/cache/nginx/fastcgi_temp \
    /var/cache/nginx/uwsgi_temp \
    /var/cache/nginx/scgi_temp \
    /var/log/nginx \
  && chown -R nginx:nginx \
    /var/cache/nginx \
    /var/log/nginx \
    /etc/nginx

# nginx 1.27-alpine writes pid to /tmp/nginx.pid as configured
# Run as the nginx user
USER nginx

EXPOSE 8080
