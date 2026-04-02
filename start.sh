#!/bin/sh
PORT=${PORT:-80}
export PORT
envsubst '${PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf
exec supervisord -c /etc/supervisor/conf.d/supervisord.conf
