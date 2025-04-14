clean:
	rm -Rf build

build:
	yarn rollup -c rollup.config.js

.DEFAULT_GOAL := build
