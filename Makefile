export JEKYLL_VERSION=3.8
# TODO: takes a bit long, need to clean up the build images to utilize resolved dependencies.

build:
	# https://github.com/envygeeks/jekyll-docker
	docker run --volume="${PWD}:/srv/jekyll" -it jekyll/jekyll:${JEKYLL_VERSION} jekyll build
run:
	# https://github.com/BretFisher/jekyll-serve 
	docker run -p 4000:4000 -v "${PWD}:/site" bretfisher/jekyll-serve
build-run: build run