# Blog by michaelzg

[michaelzg.com](https://michaelzg.com/). Uses [Jekyll](https://jekyllrb.com/).

#### Develop locally

First setup a [Vagrant](https://www.vagrantup.com/) box:

```
vagrant up
vagrant ssh
```

and once in, install dependencies:

```
cd /vagrant && ./setup.sh
```

Afterwards, one can build and serve the blog with:

```
bundle exec jekyll serve --host 0.0.0.0 -P 8081
```

and see it at `localhost:8081`.
