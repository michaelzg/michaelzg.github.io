FROM jekyll/jekyll:pages

RUN apk add --no-cache build-base

WORKDIR /srv/jekyll

CMD ["jekyll", "serve", "--host", "0.0.0.0", "--port", "4000", "--livereload"]
