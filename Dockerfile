FROM jekyll/jekyll:pages

RUN apk add --no-cache build-base

COPY Gemfile Gemfile.lock* /tmp/bundle-setup/
RUN cd /tmp/bundle-setup && bundle install && rm -rf /tmp/bundle-setup

WORKDIR /srv/jekyll

CMD ["bundle", "exec", "jekyll", "serve", "--host", "0.0.0.0", "--port", "4000", "--livereload", "--drafts"]
