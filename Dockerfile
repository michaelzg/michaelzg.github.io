FROM jekyll/jekyll:pages

RUN apk add --no-cache build-base

WORKDIR /tmp/jekyll-deps
COPY Gemfile Gemfile.lock ./
RUN chmod a+w Gemfile.lock && bundle install

WORKDIR /srv/jekyll

ENTRYPOINT ["bundle", "exec", "jekyll"]
CMD ["serve", "--host", "0.0.0.0", "--port", "4000", "--livereload"]
