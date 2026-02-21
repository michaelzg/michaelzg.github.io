IMAGE ?= michaelzg.github.io
PORT ?= 4000

.PHONY: help image serve build build-run

help:
	@printf "Targets:\n"
	@printf "  make serve  - build image and run local site\n"
	@printf "  make build  - build static site into _site/\n"

image:
	docker build --platform linux/amd64 -t $(IMAGE) .

serve: image
	docker run --rm --platform linux/amd64 -p $(PORT):4000 -v "$(PWD):/srv/jekyll" $(IMAGE)

build: image
	docker run --rm -v "$(PWD):/srv/jekyll" $(IMAGE) build

build-run: serve
