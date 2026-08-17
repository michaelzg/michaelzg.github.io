FROM jekyll/jekyll:pages

RUN apk add --no-cache build-base

WORKDIR /tmp/jekyll-deps
COPY Gemfile Gemfile.lock ./
RUN chmod a+w Gemfile.lock && bundle install

# `bundle install` above re-resolves the lock against this image's Ruby, so the
# copy here is the one matching the gems actually installed. The site is bind
# mounted over /srv/jekyll at run time, which would otherwise shadow it with the
# host's lock and leave bundler hunting for gems the image does not have.
ENV BUNDLE_GEMFILE=/tmp/jekyll-deps/Gemfile

WORKDIR /srv/jekyll

ENTRYPOINT ["bundle", "exec", "jekyll"]
CMD ["serve", "--host", "0.0.0.0", "--port", "4000", "--livereload"]
