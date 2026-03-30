IMAGE ?= michaelzg.github.io
PORT ?= 4000
PREVIEW_PORT ?= 4010

.PHONY: help image serve build build-run stop-preview

help:
	@printf "Targets:\n"
	@printf "  make serve  - build image and run local site\n"
	@printf "  make build  - build static site into _site/, open local preview\n"
	@printf "  make stop-preview - stop the local preview server started by make build\n"

image:
	docker build --platform linux/amd64 -t $(IMAGE) .

serve: image
	docker run --rm --platform linux/amd64 -p $(PORT):4000 -v "$(PWD):/srv/jekyll" $(IMAGE)

build: image
	docker run --rm -v "$(PWD):/srv/jekyll" $(IMAGE) build
	./scripts/open_local_preview.sh "$(PREVIEW_PORT)"

build-run: serve

stop-preview:
	@if [ -f .preview-server.pid ]; then \
		kill "$$(cat .preview-server.pid)" 2>/dev/null || true; \
		rm -f .preview-server.pid; \
		echo "Stopped local preview server."; \
	else \
		echo "No local preview server is running."; \
	fi
