FROM jekyll/jekyll:3.10

WORKDIR /srv/jekyll

CMD ["serve", "--host", "0.0.0.0", "--port", "4000", "--livereload"]
