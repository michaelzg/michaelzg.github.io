# Blog by michaelzg

[michaelzg.com](https://michaelzg.com/). Uses [Jekyll](https://jekyllrb.com/).

## Local development

Prereq: [Docker](https://www.docker.com/).

```bash
make serve
```

Then open http://localhost:4000/.

## Build static site

`make build` uses Docker for the Jekyll build and host `python3` for the local preview server.

```bash
make build
```

Generated files are written to `_site/`, then a lightweight local preview opens at `http://127.0.0.1:4010/`.

To stop that preview server later:

```bash
make stop-preview
```
